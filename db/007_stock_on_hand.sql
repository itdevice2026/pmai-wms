DROP VIEW IF EXISTS v_stock_ageing;
DROP VIEW IF EXISTS v_stock_on_hand_by_pallet;
DROP VIEW IF EXISTS v_stock_on_hand_by_date;
DROP VIEW IF EXISTS v_stock_on_hand;

-- ============================================================================
-- 007 — Stock on Hand, matched to the real PMAI report.
--
-- The live screen defines it as:
--   "What's physically in the warehouse, per SKU and production date.
--    Includes basic-dressing crates (in storage/warehouse) and FPS finished
--    goods received back."
--
-- So on-hand = crate status IN (warehouse, storage, fps_processed, wh_received_cut).
-- 'picked' is deliberately EXCLUDED: the earlier guess in 002 counted it and
-- would have over-reported against your existing figures. 'production' (still
-- on the line), 'cutting' and 'issued_to_fps' (with FPS) are also excluded.
--
-- Columns match the report: CRATE / HEAD / WEIGHT, pivoted by production date
-- and labelled by age in days (Day 0 = today).
-- ============================================================================

CREATE OR REPLACE VIEW v_stock_on_hand AS
SELECT
  c.id                AS crate_id,
  c.crate_no,
  c.product_id,
  p.sku,
  p.name              AS product_name,
  p.stage,
  pc.code             AS class_code,
  p.band_code,
  p.band_min_kg,
  p.band_max_kg,
  c.production_date,
  (current_date - c.production_date)::int AS age_days,
  c.expiry_date,
  COALESCE(c.heads, 0) AS heads,
  c.net_weight_kg,
  c.status::text      AS status,
  c.pallet_id,
  pl.pallet_no,
  c.location_id,
  l.code              AS location_code,
  sr.id               AS storage_room_id,
  sr.name             AS storage_room,
  l.aisle_id,
  l.level_no,
  l.deep_no,
  CASE WHEN p.stage IN ('fps') THEN 'FURTHER PROCESSING'
       WHEN p.stage IN ('cut') THEN 'CUT-UPS'
       WHEN p.stage IN ('byproduct') THEN 'BYPRODUCTS'
       ELSE 'BASIC DRESSING' END AS section
FROM crates c
JOIN products p            ON p.id = c.product_id
LEFT JOIN product_classes pc ON pc.id = p.class_id
LEFT JOIN pallets pl       ON pl.id = c.pallet_id
LEFT JOIN locations l      ON l.id = c.location_id
LEFT JOIN storage_rooms sr ON sr.id = l.storage_room_id
WHERE NOT c.is_voided
  AND c.status IN ('warehouse','storage','fps_processed','wh_received_cut');

-- Aggregated per SKU x production date — the "By Date" tab
CREATE OR REPLACE VIEW v_stock_on_hand_by_date AS
SELECT
  section,
  sku,
  product_name,
  class_code,
  band_code,
  production_date,
  age_days,
  count(*)::int        AS crate_count,
  sum(heads)::bigint   AS head_count,
  sum(net_weight_kg)   AS total_weight_kg
FROM v_stock_on_hand
GROUP BY section, sku, product_name, class_code, band_code, production_date, age_days;

-- Aggregated per pallet — the "By Pallet" tab
CREATE OR REPLACE VIEW v_stock_on_hand_by_pallet AS
SELECT
  s.pallet_id,
  s.pallet_no,
  s.storage_room,
  s.location_code,
  s.section,
  s.sku,
  s.production_date,
  s.age_days,
  count(*)::int      AS crate_count,
  sum(s.heads)::bigint AS head_count,
  sum(s.net_weight_kg) AS total_weight_kg
FROM v_stock_on_hand s
GROUP BY s.pallet_id, s.pallet_no, s.storage_room, s.location_code,
         s.section, s.sku, s.production_date, s.age_days;

-- Ageing view rebuilt on the same status set so the two reports agree.
CREATE OR REPLACE VIEW v_stock_ageing AS
SELECT
  crate_id, crate_no, product_id, sku, product_name,
  production_date, expiry_date, age_days,
  CASE WHEN expiry_date IS NULL THEN NULL
       ELSE (expiry_date - current_date)::int END AS days_to_expiry,
  net_weight_kg, location_id, location_code, status
FROM v_stock_on_hand;
