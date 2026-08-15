-- ---------------------------------------------------------------------------
-- 014 — report views
--
-- Two jobs at once:
--
-- 1. The browser (SPA) build cannot run raw SQL, so each report in
--    src/lib/reports.ts is republished here as a view the SPA can select from
--    via PostgREST. Views take no parameters, so every view exposes its date
--    column and the client filters with .gte()/.lte().
--
-- 2. Locked records are excluded HERE, once, rather than in 13 places.
--    Live PMAI hides locked rows from "Stock on Hand, Pallets, reports,
--    everywhere" — 184,421 rows at the time of survey. The clone previously
--    checked is_locked() only on write paths, so every report leaked them.
--
-- `entity` values are table names, matching 002 and is_locked() callers.
-- ---------------------------------------------------------------------------

-- Basic Dressing Report ------------------------------------------------------
CREATE OR REPLACE VIEW v_rpt_basic_dressing AS
  SELECT c.production_date, p.sku, p.name AS product_name,
         count(*)::int AS crate_count,
         COALESCE(sum(c.heads),0)::bigint AS head_count,
         sum(c.net_weight_kg) AS total_weight_kg,
         CASE WHEN COALESCE(sum(c.heads),0) > 0
              THEN sum(c.net_weight_kg)/sum(c.heads) END AS ave_head_kg,
         avg(c.net_weight_kg) AS ave_crate_kg
    FROM crates c
    JOIN products p ON p.id = c.product_id
   WHERE NOT c.is_voided
     AND NOT is_locked('crates', NULL, c.production_date)
   GROUP BY c.production_date, p.sku, p.name;

-- Production Summary ---------------------------------------------------------
CREATE OR REPLACE VIEW v_rpt_production_summary AS
  SELECT c.production_date,
         count(DISTINCT c.product_id)::int AS sku_count,
         count(*)::int AS crate_count,
         COALESCE(sum(c.heads),0)::bigint AS head_count,
         sum(c.net_weight_kg) AS total_weight_kg,
         CASE WHEN COALESCE(sum(c.heads),0) > 0
              THEN sum(c.net_weight_kg)/sum(c.heads) END AS ave_head_kg
    FROM crates c
   WHERE NOT c.is_voided
     AND NOT is_locked('crates', NULL, c.production_date)
   GROUP BY c.production_date;

-- FPS Production Output ------------------------------------------------------
CREATE OR REPLACE VIEW v_rpt_fps_output AS
  SELECT f.fps_no, f.process_date, j.jo_no, s.name AS station,
         f.input_weight_kg, f.output_weight_kg,
         CASE WHEN f.input_weight_kg > 0
              THEN round(100 * f.output_weight_kg / f.input_weight_kg, 2) END AS yield_pct,
         f.status::text AS status, u.full_name AS operator
    FROM fps_processings f
    LEFT JOIN job_orders j ON j.id = f.job_order_id
    LEFT JOIN stations   s ON s.id = f.station_id
    LEFT JOIN users      u ON u.id = f.operator_id
   WHERE NOT is_locked('fps_processings', NULL, f.process_date);

-- Pallets --------------------------------------------------------------------
-- Storage Age drives the live 3-day review / 4-day decide alerts, measured by
-- production date, so it is exposed here rather than recomputed per caller.
CREATE OR REPLACE VIEW v_rpt_pallets AS
  SELECT pl.pallet_no, pl.kind, pl.status, sr.name AS storage_room,
         l.code AS slot_code, pl.crate_count, pl.total_weight_kg,
         pl.built_at, pl.built_at::date AS built_date,
         u.full_name AS built_by_name,
         pl.disposition,
         pl.crate_capacity, pl.over_capacity_reason,
         (pl.crate_count > pl.crate_capacity) AS is_over_capacity,
         (CURRENT_DATE - pl.built_at::date)::int AS storage_age_days
    FROM pallets pl
    LEFT JOIN locations     l  ON l.id  = pl.location_id
    LEFT JOIN storage_rooms sr ON sr.id = l.storage_room_id
    LEFT JOIN users         u  ON u.id  = pl.built_by
   WHERE NOT is_locked('pallets', NULL, pl.built_at::date);

-- Warehouse Records ----------------------------------------------------------
CREATE OR REPLACE VIEW v_rpt_warehouse_records AS
  SELECT m.occurred_at, m.occurred_at::date AS occurred_date,
         c.crate_no, p.sku, m.kind::text AS kind,
         m.from_status::text AS from_status, m.to_status::text AS to_status,
         lf.code AS from_location, lt.code AS to_location,
         m.weight_kg, u.full_name AS user_name
    FROM crate_movements m
    JOIN crates   c ON c.id = m.crate_id
    JOIN products p ON p.id = c.product_id
    LEFT JOIN locations lf ON lf.id = m.from_location_id
    LEFT JOIN locations lt ON lt.id = m.to_location_id
    LEFT JOIN users     u  ON u.id  = m.user_id
   WHERE NOT is_locked('crates', NULL, c.production_date);

-- Crate Audit ----------------------------------------------------------------
-- Live adds QR Created / QR Scanned / Wait Time; wait_seconds is generated on
-- crates by 013.
CREATE OR REPLACE VIEW v_rpt_crate_audit AS
  SELECT c.crate_no, p.sku, m.occurred_at, m.occurred_at::date AS occurred_date,
         m.kind::text AS kind,
         m.from_status::text AS from_status, m.to_status::text AS to_status,
         lt.code AS to_location, u.full_name AS user_name,
         c.qr_created_at, c.qr_scanned_at, c.wait_seconds
    FROM crate_movements m
    JOIN crates   c ON c.id = m.crate_id
    JOIN products p ON p.id = c.product_id
    LEFT JOIN locations lt ON lt.id = m.to_location_id
    LEFT JOIN users     u  ON u.id  = m.user_id
   WHERE NOT is_locked('crates', NULL, c.production_date);

-- Unscanned Crates -----------------------------------------------------------
CREATE OR REPLACE VIEW v_rpt_unscanned_crates AS
  SELECT c.crate_no, p.sku, c.production_date, c.heads, c.net_weight_kg,
         c.weighed_at,
         round(EXTRACT(EPOCH FROM (now() - c.weighed_at))/3600)::int AS hours_waiting,
         u.full_name AS weighed_by_name
    FROM crates c
    JOIN products p ON p.id = c.product_id
    LEFT JOIN users u ON u.id = c.weighed_by
   WHERE NOT c.is_voided
     AND c.status = 'production'
     AND NOT is_locked('crates', NULL, c.production_date);

-- Storage Rooms --------------------------------------------------------------
-- NOTE: live rooms 2 and 3 hold all real stock and define NO slots, so
-- total_slots is 0 for them and utilisation_pct is null. That is faithful to
-- live, not a bug — see the gap analysis, section A1.
CREATE OR REPLACE VIEW v_rpt_storage_rooms AS
  SELECT sr.name, sr.kind::text AS kind,
         COALESCE(sr.temp_min::text,'') || ' to ' || COALESCE(sr.temp_max::text,'') AS temp_range,
         CASE WHEN sr.is_available THEN 'ON' ELSE 'OFF' END AS is_available,
         count(l.id)::int AS total_slots,
         count(pl.id)::int AS occupied,
         count(l.id) FILTER (WHERE l.is_blocked)::int AS blocked,
         (count(l.id) - count(pl.id))::int AS available,
         CASE WHEN count(l.id) > 0
              THEN round(100.0 * count(pl.id) / count(l.id), 1) END AS utilisation_pct,
         COALESCE(sum(pl.crate_count),0)::bigint AS crates,
         COALESCE(sum(pl.total_weight_kg),0) AS weight_kg,
         sr.sort_order
    FROM storage_rooms sr
    LEFT JOIN locations l  ON l.storage_room_id = sr.id AND l.is_slot
    LEFT JOIN pallets   pl ON pl.location_id = l.id
                          AND pl.status <> 'dispatched'
                          AND NOT is_locked('pallets', NULL, pl.built_at::date)
   WHERE sr.is_active
   GROUP BY sr.id, sr.name, sr.kind, sr.temp_min, sr.temp_max,
            sr.is_available, sr.sort_order;

-- Issuance Summary -----------------------------------------------------------
CREATE OR REPLACE VIEW v_rpt_issuance_summary AS
  SELECT i.issuance_no, i.issue_date, i.purpose,
         COALESCE(cu.name, j.jo_no) AS customer,
         i.crate_count, i.total_weight_kg, i.status::text AS status,
         u.full_name AS issued_by_name
    FROM issuances i
    LEFT JOIN customers  cu ON cu.id = i.customer_id
    LEFT JOIN job_orders j  ON j.id  = i.job_order_id
    LEFT JOIN users      u  ON u.id  = i.issued_by;

-- Dispatch Summary -----------------------------------------------------------
-- Live locks dispatches by CREATED date, not dispatch date (Locked Records:
-- "picklists / dispatches by created date <= cutoff").
CREATE OR REPLACE VIEW v_rpt_dispatch_summary AS
  SELECT d.dispatch_no, d.dispatch_date, cu.name AS customer, d.dr_no, d.plate_no,
         d.truck_temp_c, d.total_weight_kg, d.status::text AS status,
         (SELECT count(*) FROM dispatch_lines dl WHERE dl.dispatch_id = d.id)::int AS crate_lines
    FROM dispatches d
    LEFT JOIN customers cu ON cu.id = d.customer_id
   WHERE NOT is_locked('dispatches', NULL, d.created_at::date);

-- Job Order List -------------------------------------------------------------
CREATE OR REPLACE VIEW v_rpt_job_orders AS
  SELECT j.jo_no,
         COALESCE(j.scheduled_date, j.created_at::date) AS scheduled_date,
         b.bjo_no, p.sku, j.target_qty_kg,
         j.status::text AS status,
         cu.full_name AS created_by_name, au.full_name AS approved_by_name
    FROM job_orders j
    LEFT JOIN blanket_job_orders b  ON b.id  = j.blanket_job_order_id
    LEFT JOIN products           p  ON p.id  = j.product_id
    LEFT JOIN users              cu ON cu.id = j.created_by
    LEFT JOIN users              au ON au.id = j.approved_by
   WHERE NOT is_locked('job_orders', NULL,
                       COALESCE(j.scheduled_date, j.created_at::date));

-- User Activity Log ----------------------------------------------------------
-- Live adds a Segment dimension; module is the closest existing analogue.
CREATE OR REPLACE VIEW v_rpt_activity_log AS
  SELECT a.created_at, a.created_at::date AS created_date,
         u.full_name AS user_name, a.module, a.module AS segment,
         a.action, a.entity, a.description, a.ip_address
    FROM activity_logs a
    LEFT JOIN users u ON u.id = a.user_id;

-- ---------------------------------------------------------------------------
-- Grants. Views inherit the RLS of their base tables only when created with
-- security_invoker; without it a view runs as its owner and bypasses RLS.
-- These are read-only reports and every one is gated by has_permission() in
-- the app, but we still want per-user RLS to apply.
-- ---------------------------------------------------------------------------
ALTER VIEW v_rpt_basic_dressing      SET (security_invoker = true);
ALTER VIEW v_rpt_production_summary  SET (security_invoker = true);
ALTER VIEW v_rpt_fps_output          SET (security_invoker = true);
ALTER VIEW v_rpt_pallets             SET (security_invoker = true);
ALTER VIEW v_rpt_warehouse_records   SET (security_invoker = true);
ALTER VIEW v_rpt_crate_audit         SET (security_invoker = true);
ALTER VIEW v_rpt_unscanned_crates    SET (security_invoker = true);
ALTER VIEW v_rpt_storage_rooms       SET (security_invoker = true);
ALTER VIEW v_rpt_issuance_summary    SET (security_invoker = true);
ALTER VIEW v_rpt_dispatch_summary    SET (security_invoker = true);
ALTER VIEW v_rpt_job_orders          SET (security_invoker = true);
ALTER VIEW v_rpt_activity_log        SET (security_invoker = true);

GRANT SELECT ON
  v_rpt_basic_dressing, v_rpt_production_summary, v_rpt_fps_output,
  v_rpt_pallets, v_rpt_warehouse_records, v_rpt_crate_audit,
  v_rpt_unscanned_crates, v_rpt_storage_rooms, v_rpt_issuance_summary,
  v_rpt_dispatch_summary, v_rpt_job_orders, v_rpt_activity_log
TO authenticated;
