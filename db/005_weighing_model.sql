-- ============================================================================
-- 005 — Rework the weighing model to match the real BD Weighing Entry screen.
--
-- Observed from the live PMAI screen:
--   Production Date (lockable, "can set up to tomorrow", "Unlock operators")
--   Class / Band          -> Class A
--   SKU (band)            -> "A04 · 0.40-0.49"   (SKU *is* the weight band)
--   Weight (kg)           -> single scale reading
--   Crate Type            -> "Full crate"
--   Heads                 -> 15
--   Label size / Fill space / Auto-print
--
-- ASSUMPTIONS (documented so they are cheap to reverse):
--   * band_min_kg/band_max_kg are PER HEAD, the standard dressed-poultry
--     grading basis. Flip `products.band_basis` to 'per_crate' if not.
--   * crate_types.tare_kg defaults to 0, so net == scale reading until real
--     tare weights are entered. No behaviour change if operators pre-tare.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- PRODUCT CLASSES (Class A, Class B, ...) and band columns on products
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS product_classes (
  id         serial PRIMARY KEY,
  code       text UNIQUE NOT NULL,          -- 'A'
  name       text NOT NULL,                 -- 'Class A'
  sort_order int NOT NULL DEFAULT 0,
  is_active  boolean NOT NULL DEFAULT true
);

ALTER TABLE products ADD COLUMN IF NOT EXISTS class_id    int REFERENCES product_classes(id);
ALTER TABLE products ADD COLUMN IF NOT EXISTS band_code   text;              -- 'A04'
ALTER TABLE products ADD COLUMN IF NOT EXISTS band_min_kg numeric(10,3);
ALTER TABLE products ADD COLUMN IF NOT EXISTS band_max_kg numeric(10,3);
ALTER TABLE products ADD COLUMN IF NOT EXISTS band_basis  text NOT NULL DEFAULT 'per_head';
ALTER TABLE products ADD COLUMN IF NOT EXISTS sort_order  int NOT NULL DEFAULT 0;

ALTER TABLE products DROP CONSTRAINT IF EXISTS products_band_basis_chk;
ALTER TABLE products ADD CONSTRAINT products_band_basis_chk
  CHECK (band_basis IN ('per_head','per_crate','per_piece'));

ALTER TABLE products DROP CONSTRAINT IF EXISTS products_band_range_chk;
ALTER TABLE products ADD CONSTRAINT products_band_range_chk
  CHECK (band_min_kg IS NULL OR band_max_kg IS NULL OR band_max_kg >= band_min_kg);

CREATE INDEX IF NOT EXISTS products_class_idx ON products(class_id, sort_order);

-- ---------------------------------------------------------------------------
-- CRATE TYPES (Full crate, Partial crate, ...) with tare
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crate_types (
  id            serial PRIMARY KEY,
  code          text UNIQUE NOT NULL,
  name          text NOT NULL,              -- 'Full crate'
  tare_kg       numeric(10,3) NOT NULL DEFAULT 0,
  default_heads int,
  is_partial    boolean NOT NULL DEFAULT false,
  sort_order    int NOT NULL DEFAULT 0,
  is_active     boolean NOT NULL DEFAULT true
);

ALTER TABLE crates            ADD COLUMN IF NOT EXISTS crate_type_id int REFERENCES crate_types(id);
ALTER TABLE weighing_records  ADD COLUMN IF NOT EXISTS crate_type_id int REFERENCES crate_types(id);
ALTER TABLE weighing_records  ADD COLUMN IF NOT EXISTS production_date date;
ALTER TABLE weighing_records  ADD COLUMN IF NOT EXISTS label_printed_at timestamptz;
ALTER TABLE weighing_records  ADD COLUMN IF NOT EXISTS is_deleted boolean NOT NULL DEFAULT false;
ALTER TABLE weighing_records  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES users(id);
ALTER TABLE weighing_records  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE INDEX IF NOT EXISTS wr_proddate_idx ON weighing_records(production_date DESC)
  WHERE NOT is_deleted;

-- ---------------------------------------------------------------------------
-- APPLICATION SETTINGS (label size, auto-print, production-date window)
-- Scoped: global (user_id/station_id NULL), per station, or per user.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_settings (
  id         bigserial PRIMARY KEY,
  scope      text NOT NULL DEFAULT 'global',   -- global | station | user
  user_id    uuid REFERENCES users(id) ON DELETE CASCADE,
  station_id int  REFERENCES stations(id) ON DELETE CASCADE,
  key        text NOT NULL,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (scope IN ('global','station','user'))
);

CREATE UNIQUE INDEX IF NOT EXISTS app_settings_global_idx ON app_settings(key)
  WHERE scope = 'global';
CREATE UNIQUE INDEX IF NOT EXISTS app_settings_user_idx ON app_settings(user_id, key)
  WHERE scope = 'user';
CREATE UNIQUE INDEX IF NOT EXISTS app_settings_station_idx ON app_settings(station_id, key)
  WHERE scope = 'station';

INSERT INTO app_settings (scope, key, value) VALUES
  ('global', 'label.size',          '"5x3"'::jsonb),
  ('global', 'label.fill_space',    'false'::jsonb),
  ('global', 'label.auto_print',    'true'::jsonb),
  -- How far ahead of today a production date may be set. The screen says
  -- "can set up to tomorrow", i.e. 1 day.
  ('global', 'weighing.future_days','1'::jsonb),
  -- Whether ordinary operators may change the production date at all.
  ('global', 'weighing.operators_can_edit_date', 'false'::jsonb)
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Permission for the "Unlock operators" control
-- ---------------------------------------------------------------------------
INSERT INTO permissions (code, module, action, label) VALUES
  ('bd.weighing.unlock_date','Basic Dressing','approve','Unlock production date for operators'),
  ('bd.weighing.delete','Basic Dressing','delete','Delete weighing records')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
  ON p.code IN ('bd.weighing.unlock_date','bd.weighing.delete')
WHERE r.code IN ('admin','manager')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- SEED: classes, bands-as-SKUs, crate types
-- ---------------------------------------------------------------------------
INSERT INTO product_classes (code, name, sort_order) VALUES
  ('A','Class A',1),
  ('B','Class B',2),
  ('C','Class C',3)
ON CONFLICT (code) DO NOTHING;

INSERT INTO crate_types (code, name, tare_kg, default_heads, is_partial, sort_order) VALUES
  ('FULL','Full crate',    0, 15, false, 1),
  ('PART','Partial crate', 0, NULL, true, 2)
ON CONFLICT (code) DO NOTHING;

-- Class A bands in 0.10 kg steps from 0.10 to 2.49 kg per head.
-- A01 = 0.10-0.19 ... A04 = 0.40-0.49 ... matching the observed screen.
INSERT INTO products (sku, name, class_id, band_code, band_min_kg, band_max_kg,
                      band_basis, stage, uom, sort_order, category_id, shelf_life_days,
                      storage_temp_min, storage_temp_max)
SELECT
  cls.code || lpad(n::text, 2, '0'),
  'Class ' || cls.code || ' · ' || to_char(lo,'FM0.00') || '-' || to_char(lo + 0.09,'FM0.00') || ' kg',
  cls.id,
  cls.code || lpad(n::text, 2, '0'),
  lo,
  lo + 0.09,
  'per_head',
  'bd',
  'KG',
  n,
  (SELECT id FROM product_categories WHERE code = 'WD'),
  5, 0.0, 4.0
FROM product_classes cls
CROSS JOIN LATERAL (
  SELECT n, (n * 0.10)::numeric(10,3) AS lo FROM generate_series(1, 24) n
) b
WHERE cls.code IN ('A','B','C')
ON CONFLICT (sku) DO NOTHING;

-- Backfill: existing crates default to the full crate type
UPDATE crates SET crate_type_id = (SELECT id FROM crate_types WHERE code='FULL')
 WHERE crate_type_id IS NULL;

-- Backfill production_date onto historical weighing records
UPDATE weighing_records wr
   SET production_date = c.production_date
  FROM crates c
 WHERE c.id = wr.crate_id AND wr.production_date IS NULL;
