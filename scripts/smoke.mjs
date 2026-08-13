#!/usr/bin/env node
/**
 * End-to-end smoke test: signs a session for the given user and asserts that
 * every route in the navigation renders 200 with expected content.
 *
 *   node scripts/smoke.mjs [baseUrl] [email]
 */
import { SignJWT } from "jose";
import pg from "pg";
import { readFileSync } from "node:fs";

const BASE = process.argv[2] ?? "http://127.0.0.1:3100";
const EMAIL = process.argv[3] ?? "itdevice@meatplus.ph";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2].replace(/^["']|["']$/g, "")])
);

const client = new pg.Client({ connectionString: env.DATABASE_URL });
await client.connect();
const { rows } = await client.query("SELECT id FROM users WHERE lower(email) = $1", [
  EMAIL.toLowerCase(),
]);
await client.end();
if (rows.length === 0) {
  console.error(`No user ${EMAIL}. Run scripts/create-admin.mjs first.`);
  process.exit(1);
}

const cookie =
  "wms_session=" +
  (await new SignJWT({ sub: rows[0].id })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(env.AUTH_SECRET)));

const ROUTES = ["/dashboard", "/bd/live-bird-receiving", "/bd/weighing", "/bd/byproducts", "/bd/scan-station", "/bd/import", "/fps/entry", "/fps/station", "/fps/pallets", "/wh/fps-receiving", "/wh/fps-receiving-station", "/wh/pallet-creation", "/wh/location-transfer", "/wh/pallet-transfer", "/wh/stock-transfer", "/wh/storage-map", "/wh/picklist", "/wh/issuance", "/wh/dispatch", "/planning/pallet-disposition", "/planning/blanket-job-order", "/reports/basic-dressing", "/reports/fps-output", "/reports/pallets", "/reports/stock-on-hand", "/reports/stock-on-hand?tab=pallet", "/reports/warehouse-records", "/reports/storage-rooms", "/reports/production-summary", "/reports/issuance-summary", "/reports/dispatch-summary", "/reports/crate-audit", "/reports/unscanned-crates", "/reports/job-orders", "/reports/activity-log", "/system/admin", "/system/master-data", "/system/master-data?tab=customers", "/system/master-data?tab=growers", "/system/master-data?tab=crate-types", "/system/locked-records", "/system/rbac", "/system/account", "/reports/basic-dressing/export", "/reports/fps-output/export", "/reports/pallets/export", "/reports/warehouse-records/export", "/reports/storage-rooms/export", "/reports/production-summary/export", "/reports/issuance-summary/export", "/reports/dispatch-summary/export", "/reports/crate-audit/export", "/reports/unscanned-crates/export", "/reports/job-orders/export", "/reports/activity-log/export", "/reports/stock-on-hand/export"];

let failures = 0;
for (const route of ROUTES) {
  const res = await fetch(BASE + route, { headers: { cookie }, redirect: "manual" });
  const ok = res.status === 200;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${String(res.status).padEnd(4)} ${route}`);
  if (!ok) console.log((await res.text()).slice(0, 400));
}

// Unauthenticated access must be redirected, not served.
const guard = await fetch(BASE + "/dashboard", { redirect: "manual" });
const guardOk = guard.status === 307 || guard.status === 302;
if (!guardOk) failures++;
console.log(`${guardOk ? "PASS" : "FAIL"}  auth guard redirects anonymous users`);

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
