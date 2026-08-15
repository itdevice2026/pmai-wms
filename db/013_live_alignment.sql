-- ---------------------------------------------------------------------------
-- 013 — align the clone with the live PMAI system
--
-- Derived from a full 36-module sweep of http://pmaiwarehouse.meatplus.ph on
-- 15 Aug 2026. Everything here is additive or reversible: no table is dropped
-- and no row deleted, because users.role_id and crates.product_id reference
-- rows the clone generated.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. ROLES — live has 8: IT, Admin, Warehouse, Production, Viewer, FPS,
--    Sales, Planner. The clone shipped `manager` and `qa`, which do not exist.
-- ---------------------------------------------------------------------------
ALTER TABLE roles ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

INSERT INTO roles (code, name, description, is_system)
SELECT v.code, v.name, v.description, false
FROM (VALUES
  ('it',     'IT',      'Full system access — IT administrators'),
  ('sales',  'Sales',   'Sales team — order and dispatch visibility'),
  ('planner','Planner', 'Production planning and pallet disposition')
) AS v(code, name, description)
WHERE NOT EXISTS (SELECT 1 FROM roles r WHERE r.code = v.code);

-- Retired, not dropped: users.role_id still references them.
UPDATE roles SET is_active = false WHERE code IN ('manager', 'qa');

-- ---------------------------------------------------------------------------
-- 2. PER-USER PERMISSION OVERRIDES
--    Live /rbac carries an OVERRIDES column holding a COUNT per user
--    (most warehouse operators show 11) and a distinct `full access` state.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_permission_overrides (
  id            bigserial PRIMARY KEY,
  user_id       uuid    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission_id integer NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  effect        text    NOT NULL DEFAULT 'grant' CHECK (effect IN ('grant','deny')),
  granted_by    uuid    REFERENCES users(id),
  granted_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, permission_id)
);
CREATE INDEX IF NOT EXISTS idx_upo_user ON user_permission_overrides(user_id);
CREATE INDEX IF NOT EXISTS idx_upo_perm ON user_permission_overrides(permission_id);

ALTER TABLE users ADD COLUMN IF NOT EXISTS has_full_access boolean NOT NULL DEFAULT false;

-- Effective permission = (role grant OR user grant) AND NOT user deny,
-- short-circuited by full access. Replaces the 010 definition.
CREATE OR REPLACE FUNCTION has_permission(p_code text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1
      FROM users u
      JOIN roles r ON r.id = u.role_id
     WHERE u.auth_user_id = auth.uid()
       AND u.is_active
       AND (
         u.has_full_access
         OR r.code IN ('admin', 'it')
         OR (
           (
             EXISTS (SELECT 1 FROM role_permissions rp
                       JOIN permissions p ON p.id = rp.permission_id
                      WHERE rp.role_id = r.id AND p.code = p_code)
             OR
             EXISTS (SELECT 1 FROM user_permission_overrides o
                       JOIN permissions p ON p.id = o.permission_id
                      WHERE o.user_id = u.id AND o.effect = 'grant' AND p.code = p_code)
           )
           AND NOT EXISTS (
             SELECT 1 FROM user_permission_overrides o
               JOIN permissions p ON p.id = o.permission_id
              WHERE o.user_id = u.id AND o.effect = 'deny' AND p.code = p_code)
         )
       )
  );
$$;

GRANT EXECUTE ON FUNCTION has_permission(text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. SKU MODEL
--    Live BD weighing exposes 6 groups; FPS entry exposes 7 (incl. -NL).
--    Live bands run A04..A20, NOT A01..A24, and the printed labels are
--    inconsistently formatted with overlapping upper bounds.
-- ---------------------------------------------------------------------------
INSERT INTO product_classes (code, name, sort_order, is_active)
SELECT v.code, v.name, v.sort_order, true
FROM (VALUES
  ('FG',  'FG',           4),
  ('PBP', 'Primary BP',   5),
  ('SBP', 'Secondary BP', 6),
  ('ANL', 'Class A-NL',   7),
  ('BNL', 'Class B-NL',   8)
) AS v(code, name, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM product_classes p WHERE p.code = v.code);

ALTER TABLE products ADD COLUMN IF NOT EXISTS band_label   text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS is_live_band boolean NOT NULL DEFAULT false;

UPDATE products
   SET is_live_band = true
 WHERE band_code IS NOT NULL
   AND substring(band_code FROM 2 FOR 2)::int BETWEEN 4 AND 20;

-- Reproduce the live dropdown text verbatim, inconsistency included:
--   A04..A06 print two decimals (0.40-0.49) and do not overlap
--   A07..A20 print one decimal  (0.7-0.8)  and DO overlap the next band
UPDATE products
   SET band_label = band_code || ' · ' ||
       CASE WHEN substring(band_code FROM 2 FOR 2)::int <= 6
            THEN to_char(band_min_kg, 'FM0.00') || '-' || to_char(band_max_kg, 'FM0.00') || ' kg'
            ELSE to_char(band_min_kg, 'FM0.0')  || '-' || to_char(band_min_kg + 0.1, 'FM0.0') || ' kg'
       END
 WHERE band_code IS NOT NULL AND is_live_band;

-- Live defines bands PER CUSTOMER (System > Customers & SKUs), not globally.
CREATE TABLE IF NOT EXISTS customer_sku_bands (
  id          bigserial PRIMARY KEY,
  customer_id integer NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  band_code   text    NOT NULL,
  min_kg      numeric(8,3),
  max_kg      numeric(8,3),
  sort_order  integer NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_id, band_code)
);
CREATE INDEX IF NOT EXISTS idx_csb_customer ON customer_sku_bands(customer_id);

-- ---------------------------------------------------------------------------
-- 4. BUSINESS RULES observed live
-- ---------------------------------------------------------------------------

-- Pallets cap at 24 crates. Exceeding is allowed but the scan station demands
-- a typed reason ("Why did this pallet exceed 24 crates?"). Live pallet 3702
-- holds 25, so the override is genuinely in use.
ALTER TABLE pallets ADD COLUMN IF NOT EXISTS crate_capacity       integer NOT NULL DEFAULT 24;
ALTER TABLE pallets ADD COLUMN IF NOT EXISTS over_capacity_reason text;
ALTER TABLE pallets ADD COLUMN IF NOT EXISTS over_capacity_by     uuid REFERENCES users(id);
ALTER TABLE pallets ADD COLUMN IF NOT EXISTS over_capacity_at     timestamptz;

ALTER TABLE pallets DROP CONSTRAINT IF EXISTS pallets_over_capacity_needs_reason;
ALTER TABLE pallets ADD CONSTRAINT pallets_over_capacity_needs_reason
  CHECK (crate_count IS NULL OR crate_count <= crate_capacity OR over_capacity_reason IS NOT NULL)
  NOT VALID;

-- Crate Audit shows QR Created / QR Scanned / Wait Time.
ALTER TABLE crates ADD COLUMN IF NOT EXISTS qr_created_at timestamptz;
ALTER TABLE crates ADD COLUMN IF NOT EXISTS qr_scanned_at timestamptz;
ALTER TABLE crates ADD COLUMN IF NOT EXISTS wait_seconds integer
  GENERATED ALWAYS AS (
    CASE WHEN qr_scanned_at IS NOT NULL AND qr_created_at IS NOT NULL
         THEN extract(epoch FROM (qr_scanned_at - qr_created_at))::integer END
  ) STORED;

-- BD Pallet Creation lists Crate Code AND Warehouse Code as separate columns.
ALTER TABLE crates ADD COLUMN IF NOT EXISTS warehouse_code text;
CREATE INDEX IF NOT EXISTS idx_crates_warehouse_code ON crates(warehouse_code);

-- Warehouse Records reports Used / Free / Blocked / % Full per room.
ALTER TABLE locations ADD COLUMN IF NOT EXISTS is_blocked     boolean NOT NULL DEFAULT false;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS blocked_reason text;

-- Pallets screen actions: -> FPS, -> Direct Issuance, Lock, Undo (for Dispatch).
-- `direct_issuance` means the pallet stays in the warehouse.
ALTER TABLE pallets ADD COLUMN IF NOT EXISTS disposition text;
ALTER TABLE pallets DROP CONSTRAINT IF EXISTS pallets_disposition_chk;
ALTER TABLE pallets ADD CONSTRAINT pallets_disposition_chk
  CHECK (disposition IS NULL OR disposition IN
    ('fps','direct_issuance','locked','dispatch','cutting','split','merged'));

-- ---------------------------------------------------------------------------
-- 5. ISSUANCE DESTINATIONS
--    Live issuance targets are FPS process queues, not customers. Kept
--    verbatim — including the ADDITONAL typo and the duplicated marination
--    entries — because normalising them is PMAI's decision, not ours.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS issuance_destinations (
  id         serial PRIMARY KEY,
  name       text NOT NULL UNIQUE,
  is_active  boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0
);

INSERT INTO issuance_destinations (name, sort_order)
SELECT v.name, v.ord FROM (VALUES
  ('FPS',1),('FPS - FOR MARINATION',2),('FPS - SORTING',3),
  ('FPS (RM OF BONCHON)',4),('FPS ADDITONAL RM OF KR',5),('FPS ADDITONAL RM TO KR',6),
  ('FPS FOR INBAGS',7),('FPS FOR KR',8),('FPS FOR MARINATION',9),
  ('FPS FOR SORTING',10),('FPS FOR SORTING-RE STICKER',11)
) AS v(name, ord)
WHERE NOT EXISTS (SELECT 1 FROM issuance_destinations d WHERE d.name = v.name);

-- ---------------------------------------------------------------------------
-- 6. RECORD LOCKING
--    Live hides 184,421 rows across 8 entity types. Two different date fields
--    drive one cutoff: stock by production date, picklists/dispatches by
--    created date. Unlock accepts a locked-on cutoff, so the lock timestamp
--    must be retained.
-- ---------------------------------------------------------------------------
ALTER TABLE locked_records
  ADD COLUMN IF NOT EXISTS lock_basis text NOT NULL DEFAULT 'production_date';

-- entity holds the TABLE name, per 002's own comment and the is_locked()
-- calls already in src/lib/crate-flow.ts. The 8 live entity types map 1:1.
ALTER TABLE locked_records DROP CONSTRAINT IF EXISTS locked_records_entity_chk;
ALTER TABLE locked_records ADD CONSTRAINT locked_records_entity_chk
  CHECK (entity IN (
    'weighing_records',   -- live: Weighing records
    'crates',             -- live: BD crates
    'fps_processings',    -- live: FPS records
    'pallets',            -- live: Pallets
    'picklists',          -- live: Picklists
    'dispatches',         -- live: Dispatches
    'live_bird_receipts', -- live: Live bird trucks
    'job_orders'          -- live: Job orders
  ))
  NOT VALID;

ALTER TABLE locked_records DROP CONSTRAINT IF EXISTS locked_records_basis_chk;
ALTER TABLE locked_records ADD CONSTRAINT locked_records_basis_chk
  CHECK (lock_basis IN ('production_date','created_date'));

/**
 * Read-side predicate. Locked rows are hidden from "Stock on Hand, Pallets,
 * reports, everywhere" — so every read path must filter on this, not just the
 * write paths that already call is_locked().
 */
CREATE OR REPLACE FUNCTION is_visible(p_entity text, p_id text, p_date date)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT NOT is_locked(p_entity, p_id, p_date);
$$;

-- ---------------------------------------------------------------------------
-- 7. AGEING THRESHOLDS
--    Warehouse Dashboard: 3 days = review, 4 days = decide (Lock or Send to
--    FPS), measured by production date.
-- ---------------------------------------------------------------------------
INSERT INTO app_settings (key, value)
SELECT v.k, to_jsonb(v.v) FROM (VALUES
  ('pallet_age_review_days','3'),
  ('pallet_age_decide_days','4'),
  ('pallet_crate_capacity','24')
) AS v(k, v)
WHERE NOT EXISTS (SELECT 1 FROM app_settings s WHERE s.key = v.k);

-- ---------------------------------------------------------------------------
-- 8. REFERENCE DATA
-- ---------------------------------------------------------------------------
INSERT INTO customers (code, name, is_active)
SELECT v.code, v.name, true FROM (VALUES
  ('ANDOKS','Andoks'),('CUTUPS','Cut-ups'),('DALI8','Dali 8'),('DALI9','Dali 9'),
  ('DON','Don'),('HAPCHAN','Hapchan'),('KRC','Kenny Rogers Classic'),
  ('MANGINASAL','Mang Inasal'),('SUNFLAVORS','Sunflavors'),('TMG','TMG'),
  ('GENERIC','Generic')
) AS v(code, name)
WHERE NOT EXISTS (SELECT 1 FROM customers c WHERE c.code = v.code);

-- Live has 8 storage rooms. Note rooms 2 and 3 hold all real stock and carry
-- NO column/row/level addressing — the generated slot grid in 006 models a
-- layout the live warehouse does not use.
INSERT INTO storage_rooms (plant_id, code, name, room_no, is_active)
SELECT (SELECT id FROM plants ORDER BY id LIMIT 1), 'RM' || g, 'Room ' || g, g, true
FROM generate_series(5, 8) g
WHERE NOT EXISTS (SELECT 1 FROM storage_rooms s WHERE s.room_no = g);

-- ---------------------------------------------------------------------------
-- 9. RLS — match the existing pattern: authenticated read, writes via rpc_*
-- ---------------------------------------------------------------------------
ALTER TABLE user_permission_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_sku_bands        ENABLE ROW LEVEL SECURITY;
ALTER TABLE issuance_destinations     ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wms_read_ref ON user_permission_overrides;
CREATE POLICY wms_read_ref ON user_permission_overrides
  FOR SELECT TO authenticated USING (is_signed_in());

DROP POLICY IF EXISTS wms_read_ref ON customer_sku_bands;
CREATE POLICY wms_read_ref ON customer_sku_bands
  FOR SELECT TO authenticated USING (is_signed_in());

DROP POLICY IF EXISTS wms_read_ref ON issuance_destinations;
CREATE POLICY wms_read_ref ON issuance_destinations
  FOR SELECT TO authenticated USING (is_signed_in());

COMMENT ON TABLE user_permission_overrides IS
  'Per-user grants/denies layered on role_permissions. Mirrors the OVERRIDES column on live PMAI /rbac.';
COMMENT ON COLUMN products.band_label IS
  'Verbatim live dropdown label. Live labels are inconsistently formatted and upper bounds overlap.';
COMMENT ON COLUMN locked_records.lock_basis IS
  'Live rule: stock locks by production date <= cutoff; picklists/dispatches by created date <= cutoff.';
