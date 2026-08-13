#!/usr/bin/env node
/**
 * Generate realistic demo production data so the screens have something to show.
 * Mirrors the shape of the live PMAI figures: ~1,700 crates on hand across two
 * production dates, 10-15 heads per crate, weights consistent with each SKU band.
 *
 *   node scripts/seed-demo.mjs [crateCount]
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

const TARGET = Number(process.argv[2] ?? 1775);
const c = new pg.Client({ connectionString: env.DATABASE_URL });
await c.connect();

const plant = (await c.query("SELECT id, code FROM plants ORDER BY id LIMIT 1")).rows[0];
const user = (await c.query("SELECT id FROM users ORDER BY created_at LIMIT 1")).rows[0];
const fullCrate = (await c.query("SELECT id FROM crate_types WHERE code='FULL'")).rows[0];
const station = (await c.query("SELECT id FROM stations WHERE kind='bd_weighing' ORDER BY id LIMIT 1")).rows[0];

// SKUs actually seen in the live report, plus a spread of others.
const skus = (
  await c.query(
    `SELECT id, sku, band_min_kg, band_max_kg FROM products
      WHERE band_code IS NOT NULL AND stage='bd'
        AND sku = ANY($1) ORDER BY sku`,
    [["A07","A08","A15","A16","A18","B06","B07","B08","B09","B10","B11","B12",
      "A05","A06","A09","A10","A11","A12","A13","A14","A17","A19","A20",
      "B05","B13","B14","B15","C08","C09","C10"]]
  )
).rows;

if (skus.length === 0) {
  console.error("No banded SKUs found. Run db/005_weighing_model.sql first.");
  process.exit(1);
}

const today = new Date();
const iso = (d) => d.toISOString().slice(0, 10);
const yesterday = new Date(today.getTime() - 86400000);
const dates = [iso(yesterday), iso(today)];

// Wipe previous demo rows so the script is repeatable.
await c.query("DELETE FROM crates WHERE crate_no LIKE $1", [`${plant.code}-%`]);
await c.query("DELETE FROM pallets WHERE pallet_no LIKE 'PLT-%'");

// Build pallets in Room 1 / Room 2 slots
const slots = (
  await c.query(
    `SELECT l.id FROM locations l
       JOIN storage_aisles a ON a.id = l.aisle_id
       JOIN storage_rooms sr ON sr.id = a.storage_room_id
      WHERE l.is_slot ORDER BY sr.sort_order, a.row_index, a.side, l.level_no, l.deep_no`
  )
).rows;

const palletIds = [];
for (let i = 0; i < Math.min(slots.length, Math.ceil(TARGET / 30)); i++) {
  const r = await c.query(
    `INSERT INTO pallets (pallet_no, plant_id, kind, location_id, status, built_by)
     VALUES ($1,$2,'bd',$3,'stored',$4) RETURNING id`,
    [`PLT-${String(i + 1).padStart(5, "0")}`, plant.id, slots[i].id, user.id]
  );
  palletIds.push(r.rows[0].id);
}

let made = 0;
let seq = 0;
const rand = (n) => Math.floor(Math.random() * n);

for (const date of dates) {
  const share = date === dates[0] ? 0.43 : 0.57; // matches 760 / 1,015 split
  const want = Math.round(TARGET * share);
  const stamp = date.replace(/-/g, "");

  for (let i = 0; i < want; i++) {
    const p = skus[rand(skus.length)];
    const heads = Math.random() < 0.5 ? 15 : 10;
    const lo = Number(p.band_min_kg);
    const hi = Number(p.band_max_kg);
    const perHead = lo + Math.random() * (hi - lo);
    const net = Number((perHead * heads).toFixed(2));
    seq++;
    const crateNo = `${plant.code}-${stamp}-${String(seq).padStart(4, "0")}-P1`;
    const pallet = palletIds[rand(palletIds.length)];

    const cr = await c.query(
      `INSERT INTO crates
         (crate_no, plant_id, product_id, crate_type_id, production_date, expiry_date,
          heads, gross_weight_kg, tare_weight_kg, net_weight_kg, status, pallet_id,
          location_id, weighed_at, weighed_by, station_id)
       SELECT $1,$2,$3,$4,$5::date,$5::date + 5, $6,$7,0,$7,'storage',$8,
              (SELECT location_id FROM pallets WHERE id=$8), $5::date + time '08:00', $9, $10
       RETURNING id`,
      [crateNo, plant.id, p.id, fullCrate.id, date, heads, net, pallet, user.id, station?.id ?? null]
    );

    await c.query(
      `INSERT INTO weighing_records
         (crate_id, station_id, product_id, crate_type_id, production_date, heads,
          gross_weight_kg, tare_weight_kg, net_weight_kg, weighed_at, weighed_by)
       VALUES ($1,$2,$3,$4,$5::date,$6,$7,0,$7,$5::date + time '08:00',$8)`,
      [cr.rows[0].id, station?.id ?? null, p.id, fullCrate.id, date, heads, net, user.id]
    );
    made++;
  }
}

const summary = (
  await c.query(
    `SELECT count(*)::int crates, sum(heads)::bigint heads,
            round(sum(net_weight_kg),2) wt, count(DISTINCT sku)::int skus,
            count(DISTINCT production_date)::int dates
       FROM v_stock_on_hand`
  )
).rows[0];

await c.end();
console.log(`\n  Seeded ${made} crates across ${dates.length} production dates.`);
console.log(`  Stock on hand: ${summary.crates} crates · ${summary.heads} heads · ${summary.wt} kg`);
console.log(`  ${summary.skus} SKUs · ${summary.dates} production dates\n`);
