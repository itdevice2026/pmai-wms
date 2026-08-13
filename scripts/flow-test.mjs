#!/usr/bin/env node
/**
 * End-to-end workflow test against the database.
 *
 * Drives a crate through the whole plant — weighed, received, palletised,
 * put away, picked, dispatched — and asserts that stock, the movement ledger
 * and the reports all agree at each step. This is what catches logic errors
 * that a 200-response smoke test cannot.
 */
import pg from "pg";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2].replace(/^["']|["']$/g, "")])
);

const c = new pg.Client({ connectionString: env.DATABASE_URL });
await c.connect();

let pass = 0;
let fail = 0;
function check(label, cond, detail = "") {
  if (cond) { pass++; console.log(`PASS  ${label}`); }
  else { fail++; console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ""}`); }
}

const one = async (sql, params = []) => (await c.query(sql, params)).rows[0];

const user = await one("SELECT id FROM users ORDER BY created_at LIMIT 1");
const plant = await one("SELECT id, code FROM plants ORDER BY id LIMIT 1");
const product = await one("SELECT id, sku FROM products WHERE sku='A11'");
const crateType = await one("SELECT id, tare_kg FROM crate_types WHERE code='FULL'");

// Clean up any prior run
await c.query("DELETE FROM crates WHERE crate_no LIKE 'FLOW-%'");
await c.query("DELETE FROM pallets WHERE pallet_no LIKE 'FLOWPLT-%'");

const before = await one("SELECT count(*)::int n, COALESCE(sum(net_weight_kg),0)::numeric w FROM v_stock_on_hand");

// ---------------------------------------------------------------- 1. weigh
const crate = await one(
  `INSERT INTO crates (crate_no, plant_id, product_id, crate_type_id, production_date,
                       heads, gross_weight_kg, tare_weight_kg, net_weight_kg, status,
                       weighed_at, weighed_by)
   VALUES ('FLOW-0001',$1,$2,$3,current_date,15,17.25,0,17.25,'production',now(),$4)
   RETURNING id, net_weight_kg`,
  [plant.id, product.id, crateType.id, user.id]
);
check("crate created in production status", !!crate.id);

const inStockAfterWeigh = await one(
  "SELECT count(*)::int n FROM v_stock_on_hand WHERE crate_id = $1", [crate.id]
);
check("a crate still on the line is NOT counted as stock on hand", inStockAfterWeigh.n === 0);

const unscanned = await one(
  "SELECT count(*)::int n FROM crates WHERE id=$1 AND status='production'", [crate.id]
);
check("crate appears as unscanned/production", unscanned.n === 1);

// ------------------------------------------------------------- 2. receive
await c.query("UPDATE crates SET status='warehouse' WHERE id=$1", [crate.id]);
const mv1 = await one(
  "SELECT kind::text, from_status::text f, to_status::text t FROM crate_movements WHERE crate_id=$1 ORDER BY id DESC LIMIT 1",
  [crate.id]
);
check("receiving logs a wh_receive movement", mv1?.kind === "wh_receive" && mv1.f === "production" && mv1.t === "warehouse",
  JSON.stringify(mv1));

const soh1 = await one("SELECT count(*)::int n FROM v_stock_on_hand WHERE crate_id=$1", [crate.id]);
check("received crate IS counted as stock on hand", soh1.n === 1);

// ----------------------------------------------------- 3. palletise + putaway
const slot = await one(
  `SELECT l.id, l.code FROM locations l
     JOIN storage_aisles a ON a.id = l.aisle_id
     JOIN storage_rooms sr ON sr.id = a.storage_room_id
    WHERE l.is_slot AND sr.is_available
      AND NOT EXISTS (SELECT 1 FROM pallets p WHERE p.location_id = l.id AND p.status <> 'dispatched')
    LIMIT 1`
);
check("an empty slot is available in an ON room", !!slot);

const pallet = await one(
  `INSERT INTO pallets (pallet_no, plant_id, kind, status, built_by)
   VALUES ('FLOWPLT-1',$1,'bd','open',$2) RETURNING id`, [plant.id, user.id]
);
await c.query("UPDATE crates SET pallet_id=$2 WHERE id=$1", [crate.id, pallet.id]);

const rollup = await one("SELECT crate_count, total_weight_kg FROM pallets WHERE id=$1", [pallet.id]);
check("pallet rollup updates on attach", rollup.crate_count === 1 && Number(rollup.total_weight_kg) === 17.25,
  JSON.stringify(rollup));

await c.query("UPDATE pallets SET status='stored', location_id=$2 WHERE id=$1", [pallet.id, slot.id]);
await c.query("UPDATE crates SET status='storage', location_id=$2 WHERE id=$1", [crate.id, slot.id]);

const mapRow = await one("SELECT is_occupied, pallet_no FROM v_storage_map WHERE location_id=$1", [slot.id]);
check("storage map shows the slot as occupied", mapRow?.is_occupied === true, JSON.stringify(mapRow));

// --------------------------------------------------------- 4. FEFO ordering
const fefo = await c.query(
  `SELECT crate_no, age_days FROM v_stock_ageing
    WHERE product_id=$1 ORDER BY production_date LIMIT 3`, [product.id]
);
const ages = fefo.rows.map((r) => r.age_days);
check("ageing view returns oldest-first ordering",
  ages.every((v, i, a) => i === 0 || a[i - 1] >= v), JSON.stringify(ages));

// ------------------------------------------------------------ 5. pick + dispatch
await c.query("UPDATE crates SET status='picked' WHERE id=$1", [crate.id]);
const soh2 = await one("SELECT count(*)::int n FROM v_stock_on_hand WHERE crate_id=$1", [crate.id]);
check("picked crate is EXCLUDED from stock on hand (matches PMAI's definition)", soh2.n === 0);

await c.query("UPDATE crates SET status='dispatched' WHERE id=$1", [crate.id]);
const soh3 = await one("SELECT count(*)::int n FROM v_stock_on_hand WHERE crate_id=$1", [crate.id]);
check("dispatched crate is excluded from stock on hand", soh3.n === 0);

const trail = await c.query(
  "SELECT kind::text k, to_status::text t FROM crate_movements WHERE crate_id=$1 ORDER BY id", [crate.id]
);
const path = trail.rows.map((r) => r.t).join(" → ");
check("full audit trail recorded",
  path === "warehouse → warehouse → storage → picked → dispatched", path);

// The pallet attachment is a real event, but it must not be mislabelled as a
// second warehouse receipt (regression guard for db/008).
const kinds = trail.rows.map((r) => r.k);
check("pallet attachment is not logged as a second wh_receive",
  kinds.filter((k) => k === "wh_receive").length === 1, kinds.join(", "));

// --------------------------------------------------------- 6. invariants
const after = await one("SELECT count(*)::int n, COALESCE(sum(net_weight_kg),0)::numeric w FROM v_stock_on_hand");
check("stock returns to its starting level after full cycle",
  after.n === before.n && Number(after.w) === Number(before.w),
  `before ${before.n}/${before.w}, after ${after.n}/${after.w}`);

const orphan = await one(
  `SELECT count(*)::int n FROM crates c
    WHERE NOT c.is_voided AND c.pallet_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM pallets p WHERE p.id = c.pallet_id)`
);
check("no crates reference a missing pallet", orphan.n === 0);

const badRollup = await one(
  `SELECT count(*)::int n FROM pallets p
    WHERE p.crate_count <> (SELECT count(*) FROM crates c WHERE c.pallet_id = p.id AND NOT c.is_voided)`
);
check("every pallet rollup matches its crates", badRollup.n === 0, `${badRollup.n} mismatched`);

const doubleBooked = await one(
  `SELECT count(*)::int n FROM (
     SELECT location_id FROM pallets
      WHERE location_id IS NOT NULL AND status <> 'dispatched'
      GROUP BY location_id HAVING count(*) > 1) x`
);
check("no slot holds more than one pallet", doubleBooked.n === 0, `${doubleBooked.n} double-booked`);

const totalsAgree = await one(
  `SELECT (SELECT COALESCE(sum(total_weight_kg),0) FROM v_stock_on_hand_by_date)::numeric a,
          (SELECT COALESCE(sum(net_weight_kg),0) FROM v_stock_on_hand)::numeric b`
);
check("By-Date report total equals stock-on-hand total",
  Number(totalsAgree.a) === Number(totalsAgree.b), `${totalsAgree.a} vs ${totalsAgree.b}`);

// cleanup
await c.query("DELETE FROM crates WHERE crate_no LIKE 'FLOW-%'");
await c.query("DELETE FROM pallets WHERE pallet_no LIKE 'FLOWPLT-%'");
await c.end();

console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail === 0 ? 0 : 1);
