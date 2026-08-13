#!/usr/bin/env node
/**
 * Create (or reset) an administrator account.
 *
 *   node scripts/create-admin.mjs "admin@meatplus.ph" "Full Name" [password]
 *
 * If no password is given a strong one is generated and printed once.
 * Reads DATABASE_URL from the environment (or .env.local).
 */
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import pg from "pg";
import bcrypt from "bcryptjs";

// Minimal .env.local loader so this works without extra dependencies.
try {
  for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {
  /* no .env.local — rely on the real environment */
}

const [email, fullName, passwordArg] = process.argv.slice(2);
if (!email || !fullName) {
  console.error('Usage: node scripts/create-admin.mjs "email" "Full Name" [password]');
  process.exit(1);
}

const password = passwordArg ?? randomBytes(12).toString("base64url");
const connectionString =
  process.env.DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:5432/wms";

const client = new pg.Client({
  connectionString,
  ssl: connectionString.includes("supabase.co") ? { rejectUnauthorized: false } : undefined,
});

await client.connect();

const { rows: roleRows } = await client.query("SELECT id FROM roles WHERE code = 'admin'");
if (roleRows.length === 0) {
  console.error("No 'admin' role found. Run db/003_seed.sql first.");
  process.exit(1);
}

const { rows: plantRows } = await client.query("SELECT id FROM plants ORDER BY id LIMIT 1");
const hash = await bcrypt.hash(password, 10);

const { rows } = await client.query(
  `INSERT INTO users (email, password_hash, full_name, role_id, department, plant_id, is_active)
   VALUES ($1, $2, $3, $4, 'Admin', $5, true)
   ON CONFLICT (email) DO UPDATE
     SET password_hash = EXCLUDED.password_hash,
         full_name     = EXCLUDED.full_name,
         role_id       = EXCLUDED.role_id,
         is_active     = true
   RETURNING id, email`,
  [email.toLowerCase(), hash, fullName, roleRows[0].id, plantRows[0]?.id ?? null]
);

await client.end();

console.log("\n  Administrator ready\n");
console.log(`  Email:    ${rows[0].email}`);
console.log(`  Password: ${password}`);
console.log(`  User ID:  ${rows[0].id}\n`);
if (!passwordArg) console.log("  Save this password now — it is not stored anywhere else.\n");
