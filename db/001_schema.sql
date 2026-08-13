-- ============================================================================
-- PMAI Warehouse Management System — Core Schema
-- Poultry processing: Basic Dressing -> Further Processing -> Warehouse
-- Postgres 15+
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------------
-- ENUMS
-- ---------------------------------------------------------------------------
CREATE TYPE crate_status AS ENUM (
  'production',        -- just weighed at BD line
  'warehouse',         -- received into warehouse
  'storage',           -- put away into a storage location
  'cutting',           -- pulled for cutting
  'issued_to_fps',     -- issued to further processing
  'fps_processed',     -- returned from FPS as processed output
  'wh_received_cut',   -- warehouse received the cut output
  'picked',            -- on a picklist
  'dispatched',        -- shipped out
  'voided'
);

CREATE TYPE doc_status AS ENUM ('draft','pending','approved','in_progress','completed','cancelled');

CREATE TYPE location_kind AS ENUM ('production','staging','storage','blast_freezer','freezer','chiller','dry','cutting','fps','dispatch');

CREATE TYPE movement_kind AS ENUM (
  'bd_weighing','bd_pallet_create','wh_receive','putaway',
  'location_transfer','pallet_transfer','stock_transfer',
  'issue_to_fps','fps_receive','cutting_issue','cutting_receive',
  'pick','dispatch','adjustment','byproduct'
);

-- ---------------------------------------------------------------------------
-- RBAC / USERS
-- ---------------------------------------------------------------------------
CREATE TABLE roles (
  id          serial PRIMARY KEY,
  code        text UNIQUE NOT NULL,
  name        text NOT NULL,
  description text,
  is_system   boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE permissions (
  id       serial PRIMARY KEY,
  code     text UNIQUE NOT NULL,   -- e.g. 'bd.weighing.create'
  module   text NOT NULL,          -- e.g. 'Basic Dressing'
  action   text NOT NULL,          -- view | create | edit | delete | approve | export
  label    text NOT NULL
);

CREATE TABLE role_permissions (
  role_id       int NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id int NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_no   text UNIQUE,
  email         text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  full_name     text NOT NULL,
  role_id       int REFERENCES roles(id),
  department    text,                       -- Admin | Production | Warehouse | FPS | QA
  plant_id      int,
  is_active     boolean NOT NULL DEFAULT true,
  last_login_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX users_role_idx ON users(role_id);
CREATE INDEX users_active_idx ON users(is_active);

-- ---------------------------------------------------------------------------
-- REFERENCE / MASTER DATA
-- ---------------------------------------------------------------------------
CREATE TABLE plants (
  id         serial PRIMARY KEY,
  code       text UNIQUE NOT NULL,
  name       text NOT NULL,
  address    text,
  is_active  boolean NOT NULL DEFAULT true
);

ALTER TABLE users ADD CONSTRAINT users_plant_fk FOREIGN KEY (plant_id) REFERENCES plants(id);

CREATE TABLE growers (            -- live bird suppliers / contract growers
  id           serial PRIMARY KEY,
  code         text UNIQUE NOT NULL,
  name         text NOT NULL,
  farm_address text,
  contact_person text,
  contact_no   text,
  accreditation_no text,
  is_active    boolean NOT NULL DEFAULT true
);

CREATE TABLE customers (
  id           serial PRIMARY KEY,
  code         text UNIQUE NOT NULL,
  name         text NOT NULL,
  address      text,
  contact_person text,
  contact_no   text,
  terms_days   int DEFAULT 0,
  price_tier   text,
  is_active    boolean NOT NULL DEFAULT true
);

CREATE TABLE product_categories (
  id        serial PRIMARY KEY,
  code      text UNIQUE NOT NULL,
  name      text NOT NULL,
  stage     text NOT NULL DEFAULT 'bd'   -- bd | fps | byproduct | cut
);

CREATE TABLE products (
  id             serial PRIMARY KEY,
  sku            text UNIQUE NOT NULL,
  barcode        text,
  name           text NOT NULL,
  category_id    int REFERENCES product_categories(id),
  stage          text NOT NULL DEFAULT 'bd',   -- bd | fps | byproduct | cut
  uom            text NOT NULL DEFAULT 'KG',
  is_catch_weight boolean NOT NULL DEFAULT true, -- weight-driven, not piece-driven
  shelf_life_days int,
  storage_temp_min numeric(5,2),
  storage_temp_max numeric(5,2),
  standard_cost  numeric(14,4),
  selling_price  numeric(14,4),
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX products_stage_idx ON products(stage);
CREATE INDEX products_active_idx ON products(is_active);

-- Size classification used on the dressing line (e.g. S / M / L / XL, or gram bands)
CREATE TABLE size_classes (
  id         serial PRIMARY KEY,
  code       text UNIQUE NOT NULL,
  name       text NOT NULL,
  min_weight numeric(10,3),
  max_weight numeric(10,3),
  sort_order int NOT NULL DEFAULT 0,
  is_active  boolean NOT NULL DEFAULT true
);

-- Storage map: zone -> rack -> position
CREATE TABLE locations (
  id          serial PRIMARY KEY,
  plant_id    int NOT NULL REFERENCES plants(id),
  code        text NOT NULL,
  name        text NOT NULL,
  kind        location_kind NOT NULL DEFAULT 'storage',
  zone        text,
  rack        text,
  level       text,
  position    text,
  capacity_pallets int,
  temp_min    numeric(5,2),
  temp_max    numeric(5,2),
  is_active   boolean NOT NULL DEFAULT true,
  UNIQUE (plant_id, code)
);

CREATE INDEX locations_kind_idx ON locations(kind);

CREATE TABLE stations (
  id        serial PRIMARY KEY,
  plant_id  int NOT NULL REFERENCES plants(id),
  code      text NOT NULL,
  name      text NOT NULL,
  kind      text NOT NULL,     -- bd_weighing | bd_scan | fps_entry | fps_station | wh_receiving | cutting
  location_id int REFERENCES locations(id),
  is_active boolean NOT NULL DEFAULT true,
  UNIQUE (plant_id, code)
);

-- ---------------------------------------------------------------------------
-- BASIC DRESSING — Live bird receiving
-- ---------------------------------------------------------------------------
CREATE TABLE live_bird_receipts (
  id               serial PRIMARY KEY,
  receipt_no       text UNIQUE NOT NULL,
  plant_id         int NOT NULL REFERENCES plants(id),
  grower_id        int NOT NULL REFERENCES growers(id),
  receipt_date     date NOT NULL,
  arrival_time     timestamptz,
  batch_no         text,                    -- traceability lot for the whole flock
  plate_no         text,
  driver_name      text,
  heads_loaded     int NOT NULL DEFAULT 0,
  heads_received   int NOT NULL DEFAULT 0,
  heads_doa        int NOT NULL DEFAULT 0,  -- dead on arrival
  heads_condemned  int NOT NULL DEFAULT 0,
  gross_weight_kg  numeric(12,3) NOT NULL DEFAULT 0,
  tare_weight_kg   numeric(12,3) NOT NULL DEFAULT 0,
  net_weight_kg    numeric(12,3) GENERATED ALWAYS AS (gross_weight_kg - tare_weight_kg) STORED,
  ave_weight_kg    numeric(10,4),
  status           doc_status NOT NULL DEFAULT 'draft',
  received_by      uuid REFERENCES users(id),
  checked_by       uuid REFERENCES users(id),
  remarks          text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX lbr_date_idx ON live_bird_receipts(receipt_date DESC);
CREATE INDEX lbr_grower_idx ON live_bird_receipts(grower_id);
CREATE INDEX lbr_batch_idx ON live_bird_receipts(batch_no);

-- ---------------------------------------------------------------------------
-- CRATES — the unit that moves through the whole plant
-- ---------------------------------------------------------------------------
CREATE TABLE crates (
  id               bigserial PRIMARY KEY,
  crate_no         text UNIQUE NOT NULL,       -- barcode / QR printed on the crate tag
  plant_id         int NOT NULL REFERENCES plants(id),
  product_id       int NOT NULL REFERENCES products(id),
  size_class_id    int REFERENCES size_classes(id),
  live_bird_receipt_id int REFERENCES live_bird_receipts(id),
  batch_no         text,
  production_date  date NOT NULL,
  expiry_date      date,
  heads            int,
  gross_weight_kg  numeric(10,3) NOT NULL DEFAULT 0,
  tare_weight_kg   numeric(10,3) NOT NULL DEFAULT 0,
  net_weight_kg    numeric(10,3) NOT NULL DEFAULT 0,
  status           crate_status NOT NULL DEFAULT 'production',
  location_id      int REFERENCES locations(id),
  pallet_id        bigint,
  parent_crate_id  bigint REFERENCES crates(id),   -- set when produced from cutting/FPS
  weighed_at       timestamptz,
  weighed_by       uuid REFERENCES users(id),
  station_id       int REFERENCES stations(id),
  is_voided        boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX crates_status_idx    ON crates(status);
CREATE INDEX crates_product_idx   ON crates(product_id);
CREATE INDEX crates_location_idx  ON crates(location_id);
CREATE INDEX crates_pallet_idx    ON crates(pallet_id);
CREATE INDEX crates_proddate_idx  ON crates(production_date DESC);
CREATE INDEX crates_batch_idx     ON crates(batch_no);
CREATE INDEX crates_lbr_idx       ON crates(live_bird_receipt_id);

-- Immutable weighing log (a crate may be re-weighed; every weighing is recorded)
CREATE TABLE weighing_records (
  id              bigserial PRIMARY KEY,
  crate_id        bigint NOT NULL REFERENCES crates(id) ON DELETE CASCADE,
  station_id      int REFERENCES stations(id),
  product_id      int NOT NULL REFERENCES products(id),
  size_class_id   int REFERENCES size_classes(id),
  heads           int,
  gross_weight_kg numeric(10,3) NOT NULL,
  tare_weight_kg  numeric(10,3) NOT NULL DEFAULT 0,
  net_weight_kg   numeric(10,3) NOT NULL,
  weighed_at      timestamptz NOT NULL DEFAULT now(),
  weighed_by      uuid REFERENCES users(id),
  is_reweigh      boolean NOT NULL DEFAULT false,
  remarks         text
);

CREATE INDEX wr_crate_idx ON weighing_records(crate_id);
CREATE INDEX wr_date_idx  ON weighing_records(weighed_at DESC);

-- ---------------------------------------------------------------------------
-- PALLETS
-- ---------------------------------------------------------------------------
CREATE TABLE pallets (
  id            bigserial PRIMARY KEY,
  pallet_no     text UNIQUE NOT NULL,
  plant_id      int NOT NULL REFERENCES plants(id),
  kind          text NOT NULL DEFAULT 'bd',   -- bd | fps | cut
  location_id   int REFERENCES locations(id),
  status        text NOT NULL DEFAULT 'open', -- open | closed | stored | picked | dispatched
  crate_count   int NOT NULL DEFAULT 0,
  total_weight_kg numeric(12,3) NOT NULL DEFAULT 0,
  built_by      uuid REFERENCES users(id),
  built_at      timestamptz NOT NULL DEFAULT now(),
  closed_at     timestamptz,
  remarks       text
);

ALTER TABLE crates ADD CONSTRAINT crates_pallet_fk FOREIGN KEY (pallet_id) REFERENCES pallets(id) ON DELETE SET NULL;

CREATE INDEX pallets_status_idx ON pallets(status);
CREATE INDEX pallets_location_idx ON pallets(location_id);

-- ---------------------------------------------------------------------------
-- BYPRODUCTS (feet, head, gizzard, liver, intestine ...)
-- ---------------------------------------------------------------------------
CREATE TABLE byproduct_entries (
  id              bigserial PRIMARY KEY,
  entry_no        text UNIQUE NOT NULL,
  plant_id        int NOT NULL REFERENCES plants(id),
  product_id      int NOT NULL REFERENCES products(id),
  live_bird_receipt_id int REFERENCES live_bird_receipts(id),
  batch_no        text,
  production_date date NOT NULL,
  quantity        numeric(12,3) NOT NULL DEFAULT 0,
  uom             text NOT NULL DEFAULT 'KG',
  crate_id        bigint REFERENCES crates(id),
  location_id     int REFERENCES locations(id),
  recorded_by     uuid REFERENCES users(id),
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  remarks         text
);

CREATE INDEX bpe_date_idx ON byproduct_entries(production_date DESC);

-- ---------------------------------------------------------------------------
-- FURTHER PROCESSING (FPS)
-- ---------------------------------------------------------------------------
CREATE TABLE job_orders (
  id            serial PRIMARY KEY,
  jo_no         text UNIQUE NOT NULL,
  plant_id      int NOT NULL REFERENCES plants(id),
  product_id    int REFERENCES products(id),      -- target output product
  target_qty_kg numeric(12,3),
  scheduled_date date,
  status        doc_status NOT NULL DEFAULT 'pending',
  created_by    uuid REFERENCES users(id),
  approved_by   uuid REFERENCES users(id),
  approved_at   timestamptz,
  remarks       text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE fps_processings (
  id             serial PRIMARY KEY,
  fps_no         text UNIQUE NOT NULL,
  job_order_id   int REFERENCES job_orders(id),
  plant_id       int NOT NULL REFERENCES plants(id),
  station_id     int REFERENCES stations(id),
  process_date   date NOT NULL,
  started_at     timestamptz,
  ended_at       timestamptz,
  input_weight_kg  numeric(12,3) NOT NULL DEFAULT 0,
  output_weight_kg numeric(12,3) NOT NULL DEFAULT 0,
  yield_pct      numeric(6,3),
  status         doc_status NOT NULL DEFAULT 'in_progress',
  operator_id    uuid REFERENCES users(id),
  remarks        text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE fps_inputs (
  id            bigserial PRIMARY KEY,
  fps_id        int NOT NULL REFERENCES fps_processings(id) ON DELETE CASCADE,
  crate_id      bigint REFERENCES crates(id),
  product_id    int NOT NULL REFERENCES products(id),
  weight_kg     numeric(10,3) NOT NULL,
  issued_at     timestamptz NOT NULL DEFAULT now(),
  issued_by     uuid REFERENCES users(id)
);

CREATE TABLE fps_outputs (
  id            bigserial PRIMARY KEY,
  fps_id        int NOT NULL REFERENCES fps_processings(id) ON DELETE CASCADE,
  crate_id      bigint REFERENCES crates(id),
  product_id    int NOT NULL REFERENCES products(id),
  weight_kg     numeric(10,3) NOT NULL,
  produced_at   timestamptz NOT NULL DEFAULT now(),
  produced_by   uuid REFERENCES users(id)
);

CREATE INDEX fps_date_idx ON fps_processings(process_date DESC);

-- ---------------------------------------------------------------------------
-- CUTTING
-- ---------------------------------------------------------------------------
CREATE TABLE cutting_runs (
  id             serial PRIMARY KEY,
  run_no         text UNIQUE NOT NULL,
  plant_id       int NOT NULL REFERENCES plants(id),
  run_date       date NOT NULL,
  input_weight_kg  numeric(12,3) NOT NULL DEFAULT 0,
  output_weight_kg numeric(12,3) NOT NULL DEFAULT 0,
  yield_pct      numeric(6,3),
  status         doc_status NOT NULL DEFAULT 'in_progress',
  operator_id    uuid REFERENCES users(id),
  remarks        text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE cutting_inputs (
  id          bigserial PRIMARY KEY,
  run_id      int NOT NULL REFERENCES cutting_runs(id) ON DELETE CASCADE,
  crate_id    bigint REFERENCES crates(id),
  product_id  int NOT NULL REFERENCES products(id),
  weight_kg   numeric(10,3) NOT NULL
);

CREATE TABLE cutting_outputs (
  id          bigserial PRIMARY KEY,
  run_id      int NOT NULL REFERENCES cutting_runs(id) ON DELETE CASCADE,
  crate_id    bigint REFERENCES crates(id),
  product_id  int NOT NULL REFERENCES products(id),
  weight_kg   numeric(10,3) NOT NULL
);

-- ---------------------------------------------------------------------------
-- WAREHOUSE TRANSFERS
-- ---------------------------------------------------------------------------
CREATE TABLE transfers (
  id                serial PRIMARY KEY,
  transfer_no       text UNIQUE NOT NULL,
  kind              text NOT NULL,       -- location | pallet | stock
  plant_id          int NOT NULL REFERENCES plants(id),
  from_location_id  int REFERENCES locations(id),
  to_location_id    int REFERENCES locations(id),
  transfer_date     date NOT NULL DEFAULT current_date,
  status            doc_status NOT NULL DEFAULT 'draft',
  crate_count       int NOT NULL DEFAULT 0,
  total_weight_kg   numeric(12,3) NOT NULL DEFAULT 0,
  requested_by      uuid REFERENCES users(id),
  approved_by       uuid REFERENCES users(id),
  approved_at       timestamptz,
  completed_at      timestamptz,
  remarks           text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE transfer_lines (
  id           bigserial PRIMARY KEY,
  transfer_id  int NOT NULL REFERENCES transfers(id) ON DELETE CASCADE,
  crate_id     bigint REFERENCES crates(id),
  pallet_id    bigint REFERENCES pallets(id),
  product_id   int REFERENCES products(id),
  weight_kg    numeric(10,3) NOT NULL DEFAULT 0,
  from_location_id int REFERENCES locations(id),
  to_location_id   int REFERENCES locations(id),
  scanned_at   timestamptz,
  scanned_by   uuid REFERENCES users(id)
);

CREATE INDEX tl_transfer_idx ON transfer_lines(transfer_id);
CREATE INDEX transfers_date_idx ON transfers(transfer_date DESC);
CREATE INDEX transfers_kind_idx ON transfers(kind);

-- ---------------------------------------------------------------------------
-- PICKLIST / DISPATCH
-- ---------------------------------------------------------------------------
CREATE TABLE picklists (
  id            serial PRIMARY KEY,
  picklist_no   text UNIQUE NOT NULL,
  plant_id      int NOT NULL REFERENCES plants(id),
  customer_id   int REFERENCES customers(id),
  pick_date     date NOT NULL DEFAULT current_date,
  required_at   timestamptz,
  status        doc_status NOT NULL DEFAULT 'draft',
  strategy      text NOT NULL DEFAULT 'fefo',  -- fefo | fifo | manual
  total_weight_kg numeric(12,3) NOT NULL DEFAULT 0,
  picked_weight_kg numeric(12,3) NOT NULL DEFAULT 0,
  created_by    uuid REFERENCES users(id),
  picked_by     uuid REFERENCES users(id),
  checked_by    uuid REFERENCES users(id),
  remarks       text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE picklist_lines (
  id            bigserial PRIMARY KEY,
  picklist_id   int NOT NULL REFERENCES picklists(id) ON DELETE CASCADE,
  product_id    int NOT NULL REFERENCES products(id),
  size_class_id int REFERENCES size_classes(id),
  required_weight_kg numeric(12,3) NOT NULL DEFAULT 0,
  picked_weight_kg   numeric(12,3) NOT NULL DEFAULT 0,
  remarks       text
);

CREATE TABLE picklist_picks (
  id               bigserial PRIMARY KEY,
  picklist_line_id bigint NOT NULL REFERENCES picklist_lines(id) ON DELETE CASCADE,
  crate_id         bigint NOT NULL REFERENCES crates(id),
  weight_kg        numeric(10,3) NOT NULL,
  picked_at        timestamptz NOT NULL DEFAULT now(),
  picked_by        uuid REFERENCES users(id)
);

CREATE TABLE dispatches (
  id            serial PRIMARY KEY,
  dispatch_no   text UNIQUE NOT NULL,
  picklist_id   int REFERENCES picklists(id),
  plant_id      int NOT NULL REFERENCES plants(id),
  customer_id   int REFERENCES customers(id),
  dispatch_date date NOT NULL DEFAULT current_date,
  dr_no         text,
  plate_no      text,
  driver_name   text,
  truck_temp_c  numeric(5,2),
  seal_no       text,
  total_weight_kg numeric(12,3) NOT NULL DEFAULT 0,
  status        doc_status NOT NULL DEFAULT 'draft',
  released_by   uuid REFERENCES users(id),
  checked_by    uuid REFERENCES users(id),
  departed_at   timestamptz,
  remarks       text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE dispatch_lines (
  id           bigserial PRIMARY KEY,
  dispatch_id  int NOT NULL REFERENCES dispatches(id) ON DELETE CASCADE,
  crate_id     bigint REFERENCES crates(id),
  pallet_id    bigint REFERENCES pallets(id),
  product_id   int NOT NULL REFERENCES products(id),
  weight_kg    numeric(10,3) NOT NULL DEFAULT 0
);

CREATE INDEX dispatch_date_idx ON dispatches(dispatch_date DESC);

-- ---------------------------------------------------------------------------
-- ADJUSTMENTS / COUNTS
-- ---------------------------------------------------------------------------
CREATE TABLE stock_adjustments (
  id           serial PRIMARY KEY,
  adj_no       text UNIQUE NOT NULL,
  plant_id     int NOT NULL REFERENCES plants(id),
  adj_date     date NOT NULL DEFAULT current_date,
  reason       text NOT NULL,     -- spoilage | condemned | count_variance | reweigh | other
  status       doc_status NOT NULL DEFAULT 'draft',
  created_by   uuid REFERENCES users(id),
  approved_by  uuid REFERENCES users(id),
  approved_at  timestamptz,
  remarks      text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE stock_adjustment_lines (
  id            bigserial PRIMARY KEY,
  adj_id        int NOT NULL REFERENCES stock_adjustments(id) ON DELETE CASCADE,
  crate_id      bigint REFERENCES crates(id),
  product_id    int REFERENCES products(id),
  location_id   int REFERENCES locations(id),
  system_weight_kg  numeric(10,3) NOT NULL DEFAULT 0,
  actual_weight_kg  numeric(10,3) NOT NULL DEFAULT 0,
  variance_kg   numeric(10,3) GENERATED ALWAYS AS (actual_weight_kg - system_weight_kg) STORED,
  remarks       text
);

-- ---------------------------------------------------------------------------
-- COLD CHAIN
-- ---------------------------------------------------------------------------
CREATE TABLE temperature_logs (
  id           bigserial PRIMARY KEY,
  plant_id     int NOT NULL REFERENCES plants(id),
  location_id  int REFERENCES locations(id),
  recorded_at  timestamptz NOT NULL DEFAULT now(),
  temp_c       numeric(5,2) NOT NULL,
  humidity_pct numeric(5,2),
  is_alert     boolean NOT NULL DEFAULT false,
  recorded_by  uuid REFERENCES users(id),
  device       text,
  remarks      text
);

CREATE INDEX templog_loc_time_idx ON temperature_logs(location_id, recorded_at DESC);

-- ---------------------------------------------------------------------------
-- MOVEMENT LEDGER — every crate state change lands here (audit + traceability)
-- ---------------------------------------------------------------------------
CREATE TABLE crate_movements (
  id             bigserial PRIMARY KEY,
  crate_id       bigint NOT NULL REFERENCES crates(id) ON DELETE CASCADE,
  kind           movement_kind NOT NULL,
  from_status    crate_status,
  to_status      crate_status,
  from_location_id int REFERENCES locations(id),
  to_location_id   int REFERENCES locations(id),
  from_pallet_id bigint REFERENCES pallets(id),
  to_pallet_id   bigint REFERENCES pallets(id),
  weight_kg      numeric(10,3),
  ref_table      text,
  ref_id         bigint,
  ref_no         text,
  user_id        uuid REFERENCES users(id),
  station_id     int REFERENCES stations(id),
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  remarks        text
);

CREATE INDEX cm_crate_idx ON crate_movements(crate_id, occurred_at DESC);
CREATE INDEX cm_time_idx  ON crate_movements(occurred_at DESC);
CREATE INDEX cm_kind_idx  ON crate_movements(kind);

-- ---------------------------------------------------------------------------
-- ACTIVITY LOG (application-level audit trail)
-- ---------------------------------------------------------------------------
CREATE TABLE activity_logs (
  id          bigserial PRIMARY KEY,
  user_id     uuid REFERENCES users(id),
  module      text NOT NULL,
  action      text NOT NULL,
  entity      text,
  entity_id   text,
  description text,
  before_data jsonb,
  after_data  jsonb,
  ip_address  text,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX al_time_idx ON activity_logs(created_at DESC);
CREATE INDEX al_user_idx ON activity_logs(user_id);

-- ---------------------------------------------------------------------------
-- IMPORT BATCHES (the "Import" screen under Basic Dressing)
-- ---------------------------------------------------------------------------
CREATE TABLE import_batches (
  id           serial PRIMARY KEY,
  filename     text NOT NULL,
  target       text NOT NULL,      -- weighing | live_bird | products | crates
  row_count    int NOT NULL DEFAULT 0,
  success_count int NOT NULL DEFAULT 0,
  error_count  int NOT NULL DEFAULT 0,
  errors       jsonb,
  imported_by  uuid REFERENCES users(id),
  imported_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- DOCUMENT NUMBER SEQUENCES
-- ---------------------------------------------------------------------------
CREATE TABLE doc_sequences (
  key        text PRIMARY KEY,     -- e.g. 'GRN-2026-08'
  prefix     text NOT NULL,
  last_value bigint NOT NULL DEFAULT 0
);

CREATE OR REPLACE FUNCTION next_doc_no(p_prefix text, p_width int DEFAULT 5)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_key text;
  v_val bigint;
BEGIN
  v_key := p_prefix || '-' || to_char(now(), 'YYYYMM');
  INSERT INTO doc_sequences(key, prefix, last_value)
  VALUES (v_key, p_prefix, 1)
  ON CONFLICT (key) DO UPDATE SET last_value = doc_sequences.last_value + 1
  RETURNING last_value INTO v_val;
  RETURN v_key || '-' || lpad(v_val::text, p_width, '0');
END $$;

-- ---------------------------------------------------------------------------
-- TRIGGERS
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

CREATE TRIGGER t_users_touch   BEFORE UPDATE ON users   FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER t_crates_touch  BEFORE UPDATE ON crates  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER t_lbr_touch     BEFORE UPDATE ON live_bird_receipts FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Log every crate status/location change into crate_movements automatically.
CREATE OR REPLACE FUNCTION log_crate_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.status IS DISTINCT FROM OLD.status)
     OR (NEW.location_id IS DISTINCT FROM OLD.location_id)
     OR (NEW.pallet_id IS DISTINCT FROM OLD.pallet_id) THEN
    INSERT INTO crate_movements(
      crate_id, kind, from_status, to_status,
      from_location_id, to_location_id, from_pallet_id, to_pallet_id, weight_kg)
    VALUES (
      NEW.id,
      CASE
        WHEN NEW.status = 'warehouse'      THEN 'wh_receive'::movement_kind
        WHEN NEW.status = 'storage'        THEN 'putaway'::movement_kind
        WHEN NEW.status = 'issued_to_fps'  THEN 'issue_to_fps'::movement_kind
        WHEN NEW.status = 'fps_processed'  THEN 'fps_receive'::movement_kind
        WHEN NEW.status = 'cutting'        THEN 'cutting_issue'::movement_kind
        WHEN NEW.status = 'wh_received_cut' THEN 'cutting_receive'::movement_kind
        WHEN NEW.status = 'picked'         THEN 'pick'::movement_kind
        WHEN NEW.status = 'dispatched'     THEN 'dispatch'::movement_kind
        WHEN NEW.pallet_id IS DISTINCT FROM OLD.pallet_id THEN 'pallet_transfer'::movement_kind
        ELSE 'location_transfer'::movement_kind
      END,
      OLD.status, NEW.status,
      OLD.location_id, NEW.location_id, OLD.pallet_id, NEW.pallet_id,
      NEW.net_weight_kg);
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER t_crates_movement AFTER UPDATE ON crates
  FOR EACH ROW EXECUTE FUNCTION log_crate_change();

-- Keep pallet rollups in sync
CREATE OR REPLACE FUNCTION refresh_pallet_totals() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_ids bigint[];
BEGIN
  v_ids := ARRAY(SELECT DISTINCT x FROM unnest(ARRAY[OLD.pallet_id, NEW.pallet_id]) x WHERE x IS NOT NULL);
  IF array_length(v_ids,1) IS NULL THEN RETURN NULL; END IF;
  UPDATE pallets p SET
    crate_count = COALESCE(s.cnt,0),
    total_weight_kg = COALESCE(s.wt,0)
  FROM (
    SELECT pallet_id, count(*) cnt, sum(net_weight_kg) wt
    FROM crates WHERE pallet_id = ANY(v_ids) AND NOT is_voided
    GROUP BY pallet_id
  ) s
  WHERE p.id = s.pallet_id;
  UPDATE pallets SET crate_count = 0, total_weight_kg = 0
   WHERE id = ANY(v_ids)
     AND NOT EXISTS (SELECT 1 FROM crates c WHERE c.pallet_id = pallets.id AND NOT c.is_voided);
  RETURN NULL;
END $$;

CREATE TRIGGER t_pallet_totals AFTER INSERT OR UPDATE OF pallet_id, net_weight_kg OR DELETE ON crates
  FOR EACH ROW EXECUTE FUNCTION refresh_pallet_totals();
