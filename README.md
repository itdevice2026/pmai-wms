# PMAI Warehouse Management System

A rebuild of the existing PMAI warehouse system (pmaiwarehouse.meatplus.ph),
modelled on crate-level traceability through Basic Dressing → Further
Processing → Warehouse.

## Stack

- Next.js 16 (App Router, React 19, Tailwind v4)
- PostgreSQL — runs on Supabase or any Postgres
- Auth: bcrypt + JWT in an httpOnly cookie; role-based permissions

## Deploying

See **DEPLOY.md** — push to GitHub, connect Vercel, set two environment
variables. The Supabase database is already provisioned and seeded.

## Local setup

```bash
npm install
cp .env.example .env.local     # then fill in DATABASE_URL and AUTH_SECRET
```

Apply the schema in order:

```bash
for f in db/00*.sql; do psql "$DATABASE_URL" -f "$f"; done
```

Create an administrator:

```bash
node scripts/create-admin.mjs "you@meatplus.ph" "Your Name"
```

Optional demo data (~1,775 crates over two production dates):

```bash
node scripts/seed-demo.mjs
```

Run:

```bash
npm run dev          # development
npm run build && npm start
```

Verify:

```bash
node scripts/smoke.mjs http://127.0.0.1:3000
```

## Scale integration

`src/lib/scale.ts` is the single interface the weighing screen talks to.
Set `NEXT_PUBLIC_SCALE_MODE`:

- `manual` (default) — operator keys the weight
- `bridge` — a local agent pushes `{"weightKg":12.34,"stable":true}` frames
  over a websocket at `NEXT_PUBLIC_SCALE_URL`

Nothing else changes when the real indicator is wired up.

## Documented assumptions

Recorded in `db/005_weighing_model.sql` and `db/006_storage_map_model.sql`:

- Weight bands (`A04 · 0.40-0.49`) are **per head**. Confirmed against the live
  Stock on Hand figures. Flip `products.band_basis` if that ever changes.
- `crate_types.tare_kg` defaults to 0, so net equals the scale reading until
  real tare weights are entered.
- Storage is Room → Aisle → Level → Deep, one pallet per slot.
- Stock on Hand counts crate status in
  (`warehouse`, `storage`, `fps_processed`, `wh_received_cut`).
