-- 018 — Byproducts catalog (live screen: Primary & Secondary byproduct SKUs
-- that fill the weighing-station dropdowns). Applied to Supabase as
-- migration `byproducts_catalog`; see that migration for the full definition
-- of rpc_save_byproduct / rpc_delete_byproduct and the seeded live names.
-- This file mirrors it for the repo's schema record.
CREATE TABLE IF NOT EXISTS byproducts (
  id         serial PRIMARY KEY,
  category   text NOT NULL CHECK (category IN ('primary','secondary')),
  name       text NOT NULL,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (category, name)
);
