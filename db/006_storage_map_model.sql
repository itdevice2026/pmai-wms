-- ============================================================================
-- 006 — Rework storage locations to the real Storage Map model.
--
-- Observed from the live PMAI Storage Map:
--   Room selector (Room 1 ...) with prev/next, room kind (Freezer),
--   per-room ON/OFF: "This room is OFF — not available for putting pallets away"
--   "Available 132 / 132   Occupied 0"
--   Aisles A..L, each "12 free · 3 deep", drawn in two facing columns
--     (A|L, B|K, ...) around a central AISLE, with an EVAPORATOR marker.
--   Grid rows    = LEVEL (L01..L04, L04 = highest)
--   Grid columns = DEEP  (1 = front where the forklift loads, higher = deeper)
--
-- A slot holds ONE PALLET. Replaces the grid_row/grid_col guess from 002.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- ROOMS
-- ---------------------------------------------------------------------------
ALTER TABLE storage_rooms ADD COLUMN IF NOT EXISTS room_no       int;
ALTER TABLE storage_rooms ADD COLUMN IF NOT EXISTS is_available  boolean NOT NULL DEFAULT true;
ALTER TABLE storage_rooms ADD COLUMN IF NOT EXISTS unavailable_reason text;
ALTER TABLE storage_rooms ADD COLUMN IF NOT EXISTS levels_count  int NOT NULL DEFAULT 4;
ALTER TABLE storage_rooms ADD COLUMN IF NOT EXISTS deep_count    int NOT NULL DEFAULT 3;
ALTER TABLE storage_rooms ADD COLUMN IF NOT EXISTS evaporator_position text DEFAULT 'top';
ALTER TABLE storage_rooms ADD COLUMN IF NOT EXISTS sort_order    int NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- AISLES — drawn as two facing columns around the central walkway
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS storage_aisles (
  id              serial PRIMARY KEY,
  storage_room_id int NOT NULL REFERENCES storage_rooms(id) ON DELETE CASCADE,
  code            text NOT NULL,                 -- 'A'
  side            text NOT NULL DEFAULT 'left',  -- left | right of the central aisle
  row_index       int  NOT NULL DEFAULT 1,       -- pairs A|L on row 1, B|K on row 2 ...
  levels_count    int  NOT NULL DEFAULT 4,
  deep_count      int  NOT NULL DEFAULT 3,
  is_available    boolean NOT NULL DEFAULT true,
  UNIQUE (storage_room_id, code),
  CHECK (side IN ('left','right'))
);

CREATE INDEX IF NOT EXISTS aisles_room_idx ON storage_aisles(storage_room_id, row_index, side);

-- ---------------------------------------------------------------------------
-- SLOTS on locations: aisle / level / deep
-- ---------------------------------------------------------------------------
ALTER TABLE locations ADD COLUMN IF NOT EXISTS aisle_id int REFERENCES storage_aisles(id) ON DELETE CASCADE;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS level_no int;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS deep_no  int;

-- grid_row/grid_col were a guess in 002 and are superseded by level_no/deep_no.
ALTER TABLE locations DROP COLUMN IF EXISTS grid_row;
ALTER TABLE locations DROP COLUMN IF EXISTS grid_col;

CREATE UNIQUE INDEX IF NOT EXISTS locations_slot_idx
  ON locations(aisle_id, level_no, deep_no) WHERE aisle_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS locations_aisle_idx ON locations(aisle_id);

-- A storage slot holds at most one pallet.
ALTER TABLE locations ADD COLUMN IF NOT EXISTS is_slot boolean NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- Rebuild the seeded storage map to the real shape.
-- Room 1: 11 aisles x 4 levels x 3 deep = 132 slots (matches the live screen).
-- ---------------------------------------------------------------------------
DELETE FROM locations WHERE storage_room_id IS NOT NULL AND aisle_id IS NULL;
DELETE FROM storage_rooms WHERE code IN ('CH1','CH2','BF1','FZ1','STG');

INSERT INTO storage_rooms
  (plant_id, code, name, kind, room_no, temp_min, temp_max,
   levels_count, deep_count, capacity_pallets, is_available, sort_order,
   rows_count, cols_count)
SELECT p.id, v.code, v.name, v.kind::location_kind, v.room_no, v.tmin, v.tmax,
       v.levels, v.deep, 0, v.avail, v.ord, 1, 1
FROM plants p, (VALUES
  ('RM1','Room 1','freezer',       1, -20.0, -15.0, 4, 3, false, 1),
  ('RM2','Room 2','freezer',       2, -20.0, -15.0, 4, 3, true,  2),
  ('RM3','Room 3','chiller',       3,   0.0,   4.0, 4, 3, true,  3),
  ('RM4','Blast Freezer','blast_freezer', 4, -35.0, -25.0, 3, 2, true, 4)
) AS v(code,name,kind,room_no,tmin,tmax,levels,deep,avail,ord)
WHERE p.code = 'PMAI'
ON CONFLICT (plant_id, code) DO NOTHING;

-- Aisles: 11 per freezer/chiller room, paired left/right around the walkway.
-- Left column A..F top-to-bottom, right column L..G mirrored, so row 1 = A|L.
WITH letters AS (
  SELECT * FROM (VALUES
    ('A',1,'left'),  ('L',1,'right'),
    ('B',2,'left'),  ('K',2,'right'),
    ('C',3,'left'),  ('J',3,'right'),
    ('D',4,'left'),  ('H',4,'right'),
    ('E',5,'left'),  ('G',5,'right'),
    ('F',6,'left')
  ) AS t(code, row_index, side)
)
INSERT INTO storage_aisles (storage_room_id, code, side, row_index, levels_count, deep_count)
SELECT sr.id, l.code, l.side, l.row_index, sr.levels_count, sr.deep_count
FROM storage_rooms sr CROSS JOIN letters l
WHERE sr.code IN ('RM1','RM2','RM3')
ON CONFLICT (storage_room_id, code) DO NOTHING;

-- Blast freezer: 4 aisles, 3 levels, 2 deep
INSERT INTO storage_aisles (storage_room_id, code, side, row_index, levels_count, deep_count)
SELECT sr.id, l.code, l.side, l.row_index, sr.levels_count, sr.deep_count
FROM storage_rooms sr
CROSS JOIN (VALUES ('A',1,'left'),('D',1,'right'),('B',2,'left'),('C',2,'right')) AS l(code,row_index,side)
WHERE sr.code = 'RM4'
ON CONFLICT (storage_room_id, code) DO NOTHING;

-- One location row per slot: code like RM1-A-L04-D3
INSERT INTO locations
  (plant_id, storage_room_id, aisle_id, code, name, kind,
   zone, level_no, deep_no, is_slot, capacity_pallets, temp_min, temp_max)
SELECT
  sr.plant_id, sr.id, a.id,
  sr.code || '-' || a.code || '-L' || lpad(lv::text,2,'0') || '-D' || dp,
  'Room ' || COALESCE(sr.room_no::text, sr.code) || ' · Aisle ' || a.code
    || ' · Level ' || lpad(lv::text,2,'0') || ' · Deep ' || dp,
  sr.kind, a.code, lv, dp, true, 1, sr.temp_min, sr.temp_max
FROM storage_aisles a
JOIN storage_rooms sr ON sr.id = a.storage_room_id
CROSS JOIN LATERAL generate_series(1, a.levels_count) lv
CROSS JOIN LATERAL generate_series(1, a.deep_count) dp
ON CONFLICT (plant_id, code) DO NOTHING;

-- Capacity = number of slots
UPDATE storage_rooms sr
   SET capacity_pallets = s.cnt
  FROM (SELECT storage_room_id, count(*) cnt FROM locations
         WHERE is_slot GROUP BY storage_room_id) s
 WHERE s.storage_room_id = sr.id;

-- ---------------------------------------------------------------------------
-- Storage map view: one row per slot with its occupying pallet, if any.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_storage_map AS
SELECT
  sr.id             AS room_id,
  sr.code           AS room_code,
  sr.name           AS room_name,
  sr.kind::text     AS room_kind,
  sr.is_available   AS room_available,
  a.id              AS aisle_id,
  a.code            AS aisle_code,
  a.side            AS aisle_side,
  a.row_index       AS aisle_row,
  l.id              AS location_id,
  l.code            AS slot_code,
  l.level_no,
  l.deep_no,
  p.id              AS pallet_id,
  p.pallet_no,
  p.crate_count,
  p.total_weight_kg,
  (p.id IS NOT NULL) AS is_occupied
FROM locations l
JOIN storage_aisles a ON a.id = l.aisle_id
JOIN storage_rooms sr ON sr.id = a.storage_room_id
LEFT JOIN pallets p ON p.location_id = l.id AND p.status <> 'dispatched'
WHERE l.is_slot AND l.is_active;
