-- ============================================================================
-- 002 — Issuance, Planning (blanket JO, pallet disposition), Locked Records
-- ============================================================================

-- ---------------------------------------------------------------------------
-- ISSUANCE — releasing crates out of the warehouse to FPS / cutting / customer
-- ---------------------------------------------------------------------------
CREATE TABLE issuances (
  id             serial PRIMARY KEY,
  issuance_no    text UNIQUE NOT NULL,
  plant_id       int NOT NULL REFERENCES plants(id),
  purpose        text NOT NULL,      -- fps | cutting | customer | sample | disposal
  job_order_id   int REFERENCES job_orders(id),
  customer_id    int REFERENCES customers(id),
  from_location_id int REFERENCES locations(id),
  to_location_id   int REFERENCES locations(id),
  issue_date     date NOT NULL DEFAULT current_date,
  status         doc_status NOT NULL DEFAULT 'draft',
  crate_count    int NOT NULL DEFAULT 0,
  total_weight_kg numeric(12,3) NOT NULL DEFAULT 0,
  requested_by   uuid REFERENCES users(id),
  issued_by      uuid REFERENCES users(id),
  received_by    uuid REFERENCES users(id),
  approved_by    uuid REFERENCES users(id),
  approved_at    timestamptz,
  completed_at   timestamptz,
  remarks        text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE issuance_lines (
  id           bigserial PRIMARY KEY,
  issuance_id  int NOT NULL REFERENCES issuances(id) ON DELETE CASCADE,
  crate_id     bigint REFERENCES crates(id),
  pallet_id    bigint REFERENCES pallets(id),
  product_id   int REFERENCES products(id),
  weight_kg    numeric(10,3) NOT NULL DEFAULT 0,
  scanned_at   timestamptz,
  scanned_by   uuid REFERENCES users(id)
);

CREATE INDEX iss_date_idx ON issuances(issue_date DESC);
CREATE INDEX iss_purpose_idx ON issuances(purpose);
CREATE INDEX issl_iss_idx ON issuance_lines(issuance_id);

-- ---------------------------------------------------------------------------
-- PLANNING — blanket job orders and pallet disposition
-- ---------------------------------------------------------------------------
CREATE TABLE blanket_job_orders (
  id            serial PRIMARY KEY,
  bjo_no        text UNIQUE NOT NULL,
  plant_id      int NOT NULL REFERENCES plants(id),
  customer_id   int REFERENCES customers(id),
  product_id    int REFERENCES products(id),
  valid_from    date NOT NULL,
  valid_to      date NOT NULL,
  total_qty_kg  numeric(14,3) NOT NULL DEFAULT 0,
  released_qty_kg numeric(14,3) NOT NULL DEFAULT 0,
  status        doc_status NOT NULL DEFAULT 'pending',
  created_by    uuid REFERENCES users(id),
  approved_by   uuid REFERENCES users(id),
  approved_at   timestamptz,
  remarks       text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_to >= valid_from)
);

ALTER TABLE job_orders ADD COLUMN blanket_job_order_id int REFERENCES blanket_job_orders(id);

CREATE TABLE pallet_dispositions (
  id            serial PRIMARY KEY,
  disposition_no text UNIQUE NOT NULL,
  plant_id      int NOT NULL REFERENCES plants(id),
  pallet_id     bigint REFERENCES pallets(id),
  plan_date     date NOT NULL DEFAULT current_date,
  disposition   text NOT NULL,   -- dispatch | cutting | fps | hold | rework | disposal
  target_customer_id int REFERENCES customers(id),
  target_location_id int REFERENCES locations(id),
  status        doc_status NOT NULL DEFAULT 'pending',
  planned_by    uuid REFERENCES users(id),
  approved_by   uuid REFERENCES users(id),
  executed_at   timestamptz,
  remarks       text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX pd_status_idx ON pallet_dispositions(status);

-- ---------------------------------------------------------------------------
-- LOCKED RECORDS — freeze a document/period so it can no longer be edited
-- ---------------------------------------------------------------------------
CREATE TABLE locked_records (
  id          bigserial PRIMARY KEY,
  entity      text NOT NULL,      -- table name, e.g. 'weighing_records'
  entity_id   text,               -- null = whole-period lock
  period_from date,
  period_to   date,
  reason      text,
  locked_by   uuid REFERENCES users(id),
  locked_at   timestamptz NOT NULL DEFAULT now(),
  unlocked_by uuid REFERENCES users(id),
  unlocked_at timestamptz,
  is_active   boolean NOT NULL DEFAULT true
);

CREATE INDEX lr_entity_idx ON locked_records(entity, is_active);

CREATE OR REPLACE FUNCTION is_locked(p_entity text, p_entity_id text, p_date date)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM locked_records
     WHERE is_active
       AND entity = p_entity
       AND (entity_id IS NULL OR entity_id = p_entity_id)
       AND (period_from IS NULL OR p_date >= period_from)
       AND (period_to   IS NULL OR p_date <= period_to)
  );
$$;

-- ---------------------------------------------------------------------------
-- STORAGE ROOMS — a grouping above locations, used by the Storage Map screen
-- ---------------------------------------------------------------------------
CREATE TABLE storage_rooms (
  id          serial PRIMARY KEY,
  plant_id    int NOT NULL REFERENCES plants(id),
  code        text NOT NULL,
  name        text NOT NULL,
  kind        location_kind NOT NULL DEFAULT 'freezer',
  temp_min    numeric(5,2),
  temp_max    numeric(5,2),
  capacity_pallets int,
  rows_count  int NOT NULL DEFAULT 1,
  cols_count  int NOT NULL DEFAULT 1,
  is_active   boolean NOT NULL DEFAULT true,
  UNIQUE (plant_id, code)
);

ALTER TABLE locations ADD COLUMN storage_room_id int REFERENCES storage_rooms(id);
ALTER TABLE locations ADD COLUMN grid_row int;
ALTER TABLE locations ADD COLUMN grid_col int;

-- ---------------------------------------------------------------------------
-- REPORTING VIEWS
-- ---------------------------------------------------------------------------

-- Stock on hand: crates physically held by the warehouse
CREATE OR REPLACE VIEW v_stock_on_hand AS
SELECT
  c.product_id,
  p.sku,
  p.name              AS product_name,
  p.stage,
  c.size_class_id,
  sc.code             AS size_code,
  c.location_id,
  l.code              AS location_code,
  l.name              AS location_name,
  sr.id               AS storage_room_id,
  sr.name             AS storage_room,
  count(*)::int       AS crate_count,
  sum(c.net_weight_kg) AS total_weight_kg,
  min(c.production_date) AS oldest_production_date,
  min(c.expiry_date)     AS nearest_expiry
FROM crates c
JOIN products p        ON p.id = c.product_id
LEFT JOIN size_classes sc ON sc.id = c.size_class_id
LEFT JOIN locations l  ON l.id = c.location_id
LEFT JOIN storage_rooms sr ON sr.id = l.storage_room_id
WHERE NOT c.is_voided
  AND c.status IN ('warehouse','storage','wh_received_cut','fps_processed','picked')
GROUP BY c.product_id, p.sku, p.name, p.stage, c.size_class_id, sc.code,
         c.location_id, l.code, l.name, sr.id, sr.name;

-- Ageing / FEFO view
CREATE OR REPLACE VIEW v_stock_ageing AS
SELECT
  c.id            AS crate_id,
  c.crate_no,
  c.product_id,
  p.sku,
  p.name          AS product_name,
  c.batch_no,
  c.production_date,
  c.expiry_date,
  (current_date - c.production_date)::int AS age_days,
  CASE WHEN c.expiry_date IS NULL THEN NULL
       ELSE (c.expiry_date - current_date)::int END AS days_to_expiry,
  c.net_weight_kg,
  c.location_id,
  l.code          AS location_code,
  c.status
FROM crates c
JOIN products p ON p.id = c.product_id
LEFT JOIN locations l ON l.id = c.location_id
WHERE NOT c.is_voided
  AND c.status IN ('warehouse','storage','wh_received_cut','fps_processed');

-- Daily production summary (Basic Dressing)
CREATE OR REPLACE VIEW v_production_summary AS
SELECT
  c.production_date,
  c.product_id,
  p.sku,
  p.name           AS product_name,
  count(*)::int    AS crate_count,
  sum(c.heads)     AS total_heads,
  sum(c.net_weight_kg) AS total_weight_kg,
  avg(c.net_weight_kg) AS ave_crate_weight_kg
FROM crates c
JOIN products p ON p.id = c.product_id
WHERE NOT c.is_voided
GROUP BY c.production_date, c.product_id, p.sku, p.name;

-- Crates weighed but never scanned into the warehouse
CREATE OR REPLACE VIEW v_unscanned_crates AS
SELECT c.id, c.crate_no, c.production_date, c.product_id, p.name AS product_name,
       c.net_weight_kg, c.status, c.weighed_at,
       (now() - c.weighed_at) AS age
FROM crates c
JOIN products p ON p.id = c.product_id
WHERE NOT c.is_voided
  AND c.status = 'production'
  AND c.weighed_at < now() - interval '2 hours';
