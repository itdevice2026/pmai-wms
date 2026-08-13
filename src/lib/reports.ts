/**
 * Report registry.
 *
 * Every entry in the Report section of the navigation is defined here as a
 * query plus column metadata, so each route file stays a three-line shim and
 * the CSV export, filters and rendering are shared.
 */

export type ColumnDef = {
  key: string;
  header: string;
  align?: "left" | "right" | "center";
  format?: "kg" | "num" | "date" | "datetime" | "badge" | "status" | "pct" | "text";
};

export type FilterDef =
  | { kind: "date"; name: string; label: string; defaultDaysAgo?: number }
  | { kind: "select"; name: string; label: string; optionsSql: string; allLabel?: string }
  | { kind: "text"; name: string; label: string; placeholder?: string };

export type ReportDef = {
  id: string;
  title: string;
  description: string;
  permission: string;
  /** $1 = from date, $2 = to date, $3.. = filters in declared order */
  sql: string;
  columns: ColumnDef[];
  filters?: FilterDef[];
  /** Columns to sum into a totals row */
  totals?: string[];
  defaultRangeDays?: number;
};

const DATE_RANGE: FilterDef[] = [
  { kind: "date", name: "from", label: "From", defaultDaysAgo: 7 },
  { kind: "date", name: "to", label: "To", defaultDaysAgo: 0 },
];

export const REPORTS: Record<string, ReportDef> = {
  "basic-dressing": {
    id: "basic-dressing",
    title: "Basic Dressing Report",
    description: "Crates weighed on the dressing line, by production date and SKU.",
    permission: "report.view",
    filters: DATE_RANGE,
    totals: ["crate_count", "head_count", "total_weight_kg"],
    columns: [
      { key: "production_date", header: "Prod. Date", format: "date" },
      { key: "sku", header: "SKU" },
      { key: "product_name", header: "Product" },
      { key: "crate_count", header: "Crates", align: "right", format: "num" },
      { key: "head_count", header: "Heads", align: "right", format: "num" },
      { key: "total_weight_kg", header: "Weight (kg)", align: "right", format: "kg" },
      { key: "ave_head_kg", header: "Ave/Head", align: "right", format: "kg" },
      { key: "ave_crate_kg", header: "Ave/Crate", align: "right", format: "kg" },
    ],
    sql: `
      SELECT c.production_date, p.sku, p.name AS product_name,
             count(*)::int AS crate_count,
             COALESCE(sum(c.heads),0)::bigint AS head_count,
             sum(c.net_weight_kg) AS total_weight_kg,
             CASE WHEN COALESCE(sum(c.heads),0) > 0
                  THEN sum(c.net_weight_kg)/sum(c.heads) END AS ave_head_kg,
             avg(c.net_weight_kg) AS ave_crate_kg
        FROM crates c JOIN products p ON p.id = c.product_id
       WHERE NOT c.is_voided AND c.production_date BETWEEN $1 AND $2
       GROUP BY c.production_date, p.sku, p.name
       ORDER BY c.production_date DESC, p.sku`,
  },

  "fps-output": {
    id: "fps-output",
    title: "FPS Production Output",
    description: "Further-processing runs with input, output and yield.",
    permission: "report.view",
    filters: DATE_RANGE,
    totals: ["input_weight_kg", "output_weight_kg"],
    columns: [
      { key: "fps_no", header: "FPS No." },
      { key: "process_date", header: "Date", format: "date" },
      { key: "jo_no", header: "Job Order" },
      { key: "station", header: "Station" },
      { key: "input_weight_kg", header: "Input (kg)", align: "right", format: "kg" },
      { key: "output_weight_kg", header: "Output (kg)", align: "right", format: "kg" },
      { key: "yield_pct", header: "Yield", align: "right", format: "pct" },
      { key: "status", header: "Status", format: "status" },
      { key: "operator", header: "Operator" },
    ],
    sql: `
      SELECT f.fps_no, f.process_date, j.jo_no, s.name AS station,
             f.input_weight_kg, f.output_weight_kg,
             CASE WHEN f.input_weight_kg > 0
                  THEN round(100 * f.output_weight_kg / f.input_weight_kg, 2) END AS yield_pct,
             f.status::text AS status, u.full_name AS operator
        FROM fps_processings f
        LEFT JOIN job_orders j ON j.id = f.job_order_id
        LEFT JOIN stations s ON s.id = f.station_id
        LEFT JOIN users u ON u.id = f.operator_id
       WHERE f.process_date BETWEEN $1 AND $2
       ORDER BY f.process_date DESC, f.fps_no DESC`,
  },

  pallets: {
    id: "pallets",
    title: "Pallets",
    description: "All pallets with their contents and current location.",
    permission: "report.view",
    totals: ["crate_count", "total_weight_kg"],
    columns: [
      { key: "pallet_no", header: "Pallet" },
      { key: "kind", header: "Type", format: "badge" },
      { key: "status", header: "Status", format: "badge" },
      { key: "storage_room", header: "Room" },
      { key: "slot_code", header: "Slot" },
      { key: "crate_count", header: "Crates", align: "right", format: "num" },
      { key: "total_weight_kg", header: "Weight (kg)", align: "right", format: "kg" },
      { key: "built_at", header: "Built", format: "datetime" },
      { key: "built_by_name", header: "Built by" },
    ],
    sql: `
      SELECT pl.pallet_no, pl.kind, pl.status, sr.name AS storage_room,
             l.code AS slot_code, pl.crate_count, pl.total_weight_kg,
             pl.built_at, u.full_name AS built_by_name
        FROM pallets pl
        LEFT JOIN locations l ON l.id = pl.location_id
        LEFT JOIN storage_rooms sr ON sr.id = l.storage_room_id
        LEFT JOIN users u ON u.id = pl.built_by
       WHERE pl.built_at::date BETWEEN $1 AND $2
       ORDER BY pl.built_at DESC`,
    filters: [
      { kind: "date", name: "from", label: "From", defaultDaysAgo: 30 },
      { kind: "date", name: "to", label: "To", defaultDaysAgo: 0 },
    ],
  },

  "warehouse-records": {
    id: "warehouse-records",
    title: "Warehouse Records",
    description: "Every crate movement recorded in the warehouse.",
    permission: "report.view",
    filters: DATE_RANGE,
    columns: [
      { key: "occurred_at", header: "When", format: "datetime" },
      { key: "crate_no", header: "Crate" },
      { key: "sku", header: "SKU" },
      { key: "kind", header: "Movement", format: "badge" },
      { key: "from_status", header: "From", format: "status" },
      { key: "to_status", header: "To", format: "status" },
      { key: "from_location", header: "From Slot" },
      { key: "to_location", header: "To Slot" },
      { key: "weight_kg", header: "Weight (kg)", align: "right", format: "kg" },
      { key: "user_name", header: "By" },
    ],
    sql: `
      SELECT m.occurred_at, c.crate_no, p.sku, m.kind::text AS kind,
             m.from_status::text AS from_status, m.to_status::text AS to_status,
             lf.code AS from_location, lt.code AS to_location,
             m.weight_kg, u.full_name AS user_name
        FROM crate_movements m
        JOIN crates c ON c.id = m.crate_id
        JOIN products p ON p.id = c.product_id
        LEFT JOIN locations lf ON lf.id = m.from_location_id
        LEFT JOIN locations lt ON lt.id = m.to_location_id
        LEFT JOIN users u ON u.id = m.user_id
       WHERE m.occurred_at::date BETWEEN $1 AND $2
       ORDER BY m.occurred_at DESC
       LIMIT 2000`,
  },

  "storage-rooms": {
    id: "storage-rooms",
    title: "Storage Rooms",
    description: "Capacity and utilisation per storage room.",
    permission: "report.view",
    columns: [
      { key: "name", header: "Room" },
      { key: "kind", header: "Type", format: "badge" },
      { key: "temp_range", header: "Temp (°C)" },
      { key: "is_available", header: "Status", format: "badge" },
      { key: "total_slots", header: "Slots", align: "right", format: "num" },
      { key: "occupied", header: "Occupied", align: "right", format: "num" },
      { key: "available", header: "Available", align: "right", format: "num" },
      { key: "utilisation_pct", header: "Utilisation", align: "right", format: "pct" },
      { key: "crates", header: "Crates", align: "right", format: "num" },
      { key: "weight_kg", header: "Weight (kg)", align: "right", format: "kg" },
    ],
    sql: `
      SELECT sr.name, sr.kind::text AS kind,
             COALESCE(sr.temp_min::text,'') || ' to ' || COALESCE(sr.temp_max::text,'') AS temp_range,
             CASE WHEN sr.is_available THEN 'ON' ELSE 'OFF' END AS is_available,
             count(l.id)::int AS total_slots,
             count(pl.id)::int AS occupied,
             (count(l.id) - count(pl.id))::int AS available,
             CASE WHEN count(l.id) > 0
                  THEN round(100.0 * count(pl.id) / count(l.id), 1) END AS utilisation_pct,
             COALESCE(sum(pl.crate_count),0)::bigint AS crates,
             COALESCE(sum(pl.total_weight_kg),0) AS weight_kg
        FROM storage_rooms sr
        LEFT JOIN locations l ON l.storage_room_id = sr.id AND l.is_slot
        LEFT JOIN pallets pl ON pl.location_id = l.id AND pl.status <> 'dispatched'
       -- This report is not date-scoped, but the shared runner always binds
       -- $1/$2. They must be cast, or Postgres cannot infer a type and fails
       -- with "could not determine data type of parameter $1".
       WHERE sr.is_active AND $1::date IS NOT NULL AND $2::date IS NOT NULL
       GROUP BY sr.id, sr.name, sr.kind, sr.temp_min, sr.temp_max, sr.is_available, sr.sort_order
       ORDER BY sr.sort_order`,
  },

  "production-summary": {
    id: "production-summary",
    title: "Production Summary",
    description: "Daily dressing output: heads, crates and weight.",
    permission: "report.view",
    filters: DATE_RANGE,
    totals: ["crate_count", "head_count", "total_weight_kg"],
    columns: [
      { key: "production_date", header: "Date", format: "date" },
      { key: "sku_count", header: "SKUs", align: "right", format: "num" },
      { key: "crate_count", header: "Crates", align: "right", format: "num" },
      { key: "head_count", header: "Heads", align: "right", format: "num" },
      { key: "total_weight_kg", header: "Weight (kg)", align: "right", format: "kg" },
      { key: "ave_head_kg", header: "Ave/Head", align: "right", format: "kg" },
    ],
    sql: `
      SELECT c.production_date,
             count(DISTINCT c.product_id)::int AS sku_count,
             count(*)::int AS crate_count,
             COALESCE(sum(c.heads),0)::bigint AS head_count,
             sum(c.net_weight_kg) AS total_weight_kg,
             CASE WHEN COALESCE(sum(c.heads),0) > 0
                  THEN sum(c.net_weight_kg)/sum(c.heads) END AS ave_head_kg
        FROM crates c
       WHERE NOT c.is_voided AND c.production_date BETWEEN $1 AND $2
       GROUP BY c.production_date
       ORDER BY c.production_date DESC`,
  },

  "issuance-summary": {
    id: "issuance-summary",
    title: "Issuance Summary",
    description: "Stock issued out of the warehouse, by purpose.",
    permission: "report.view",
    filters: DATE_RANGE,
    totals: ["crate_count", "total_weight_kg"],
    columns: [
      { key: "issuance_no", header: "Issuance No." },
      { key: "issue_date", header: "Date", format: "date" },
      { key: "purpose", header: "Purpose", format: "badge" },
      { key: "customer", header: "Customer / JO" },
      { key: "crate_count", header: "Crates", align: "right", format: "num" },
      { key: "total_weight_kg", header: "Weight (kg)", align: "right", format: "kg" },
      { key: "status", header: "Status", format: "status" },
      { key: "issued_by_name", header: "Issued by" },
    ],
    sql: `
      SELECT i.issuance_no, i.issue_date, i.purpose,
             COALESCE(cu.name, j.jo_no) AS customer,
             i.crate_count, i.total_weight_kg, i.status::text AS status,
             u.full_name AS issued_by_name
        FROM issuances i
        LEFT JOIN customers cu ON cu.id = i.customer_id
        LEFT JOIN job_orders j ON j.id = i.job_order_id
        LEFT JOIN users u ON u.id = i.issued_by
       WHERE i.issue_date BETWEEN $1 AND $2
       ORDER BY i.issue_date DESC, i.issuance_no DESC`,
  },

  "dispatch-summary": {
    id: "dispatch-summary",
    title: "Dispatch Summary",
    description: "Outbound deliveries with cold-chain details.",
    permission: "report.view",
    filters: DATE_RANGE,
    totals: ["total_weight_kg"],
    columns: [
      { key: "dispatch_no", header: "Dispatch No." },
      { key: "dispatch_date", header: "Date", format: "date" },
      { key: "customer", header: "Customer" },
      { key: "dr_no", header: "DR No." },
      { key: "plate_no", header: "Plate" },
      { key: "truck_temp_c", header: "Temp °C", align: "right" },
      { key: "crate_lines", header: "Crates", align: "right", format: "num" },
      { key: "total_weight_kg", header: "Weight (kg)", align: "right", format: "kg" },
      { key: "status", header: "Status", format: "status" },
    ],
    sql: `
      SELECT d.dispatch_no, d.dispatch_date, cu.name AS customer, d.dr_no, d.plate_no,
             d.truck_temp_c, d.total_weight_kg, d.status::text AS status,
             (SELECT count(*) FROM dispatch_lines dl WHERE dl.dispatch_id = d.id)::int AS crate_lines
        FROM dispatches d
        LEFT JOIN customers cu ON cu.id = d.customer_id
       WHERE d.dispatch_date BETWEEN $1 AND $2
       ORDER BY d.dispatch_date DESC, d.dispatch_no DESC`,
  },

  "crate-audit": {
    id: "crate-audit",
    title: "Crate Audit",
    description: "Full movement history for a crate. Enter a crate number to trace it.",
    permission: "report.view",
    filters: [
      { kind: "text", name: "crate", label: "Crate No.", placeholder: "PMAI-20260813-0001-P1" },
      { kind: "date", name: "from", label: "From", defaultDaysAgo: 30 },
      { kind: "date", name: "to", label: "To", defaultDaysAgo: 0 },
    ],
    columns: [
      { key: "crate_no", header: "Crate" },
      { key: "sku", header: "SKU" },
      { key: "occurred_at", header: "When", format: "datetime" },
      { key: "kind", header: "Movement", format: "badge" },
      { key: "from_status", header: "From", format: "status" },
      { key: "to_status", header: "To", format: "status" },
      { key: "to_location", header: "Slot" },
      { key: "user_name", header: "By" },
    ],
    sql: `
      SELECT c.crate_no, p.sku, m.occurred_at, m.kind::text AS kind,
             m.from_status::text AS from_status, m.to_status::text AS to_status,
             lt.code AS to_location, u.full_name AS user_name
        FROM crate_movements m
        JOIN crates c ON c.id = m.crate_id
        JOIN products p ON p.id = c.product_id
        LEFT JOIN locations lt ON lt.id = m.to_location_id
        LEFT JOIN users u ON u.id = m.user_id
       WHERE m.occurred_at::date BETWEEN $1 AND $2
         AND ($3 = '' OR c.crate_no ILIKE '%' || $3 || '%')
       ORDER BY c.crate_no, m.occurred_at
       LIMIT 2000`,
  },

  "unscanned-crates": {
    id: "unscanned-crates",
    title: "Unscanned Crates",
    description:
      "Crates weighed on the line but never scanned into the warehouse. These are unaccounted stock.",
    permission: "report.view",
    filters: DATE_RANGE,
    totals: ["net_weight_kg"],
    columns: [
      { key: "crate_no", header: "Crate" },
      { key: "sku", header: "SKU" },
      { key: "production_date", header: "Prod. Date", format: "date" },
      { key: "heads", header: "Heads", align: "right", format: "num" },
      { key: "net_weight_kg", header: "Weight (kg)", align: "right", format: "kg" },
      { key: "weighed_at", header: "Weighed", format: "datetime" },
      { key: "hours_waiting", header: "Hours waiting", align: "right", format: "num" },
      { key: "weighed_by_name", header: "Weighed by" },
    ],
    sql: `
      SELECT c.crate_no, p.sku, c.production_date, c.heads, c.net_weight_kg,
             c.weighed_at,
             round(EXTRACT(EPOCH FROM (now() - c.weighed_at))/3600)::int AS hours_waiting,
             u.full_name AS weighed_by_name
        FROM crates c
        JOIN products p ON p.id = c.product_id
        LEFT JOIN users u ON u.id = c.weighed_by
       WHERE NOT c.is_voided AND c.status = 'production'
         AND c.production_date BETWEEN $1 AND $2
       ORDER BY c.weighed_at`,
  },

  "job-orders": {
    id: "job-orders",
    title: "Job Order List",
    description: "Production job orders and their blanket order coverage.",
    permission: "report.view",
    filters: DATE_RANGE,
    totals: ["target_qty_kg"],
    columns: [
      { key: "jo_no", header: "JO No." },
      { key: "scheduled_date", header: "Scheduled", format: "date" },
      { key: "bjo_no", header: "Blanket JO" },
      { key: "sku", header: "Product" },
      { key: "target_qty_kg", header: "Target (kg)", align: "right", format: "kg" },
      { key: "status", header: "Status", format: "status" },
      { key: "created_by_name", header: "Created by" },
      { key: "approved_by_name", header: "Approved by" },
    ],
    sql: `
      SELECT j.jo_no, j.scheduled_date, b.bjo_no, p.sku, j.target_qty_kg,
             j.status::text AS status,
             cu.full_name AS created_by_name, au.full_name AS approved_by_name
        FROM job_orders j
        LEFT JOIN blanket_job_orders b ON b.id = j.blanket_job_order_id
        LEFT JOIN products p ON p.id = j.product_id
        LEFT JOIN users cu ON cu.id = j.created_by
        LEFT JOIN users au ON au.id = j.approved_by
       WHERE COALESCE(j.scheduled_date, j.created_at::date) BETWEEN $1 AND $2
       ORDER BY COALESCE(j.scheduled_date, j.created_at::date) DESC, j.jo_no DESC`,
  },

  "activity-log": {
    id: "activity-log",
    title: "User Activity Log",
    description: "Every action recorded in the system, with the user who performed it.",
    permission: "sys.activity.view",
    filters: [
      { kind: "date", name: "from", label: "From", defaultDaysAgo: 7 },
      { kind: "date", name: "to", label: "To", defaultDaysAgo: 0 },
      {
        kind: "select",
        name: "module",
        label: "Module",
        allLabel: "All modules",
        optionsSql: "SELECT DISTINCT module AS value, module AS label FROM activity_logs ORDER BY 1",
      },
    ],
    columns: [
      { key: "created_at", header: "When", format: "datetime" },
      { key: "user_name", header: "User" },
      { key: "module", header: "Module", format: "badge" },
      { key: "action", header: "Action", format: "badge" },
      { key: "entity", header: "Entity" },
      { key: "description", header: "Description" },
      { key: "ip_address", header: "IP" },
    ],
    sql: `
      SELECT a.created_at, u.full_name AS user_name, a.module, a.action,
             a.entity, a.description, a.ip_address
        FROM activity_logs a
        LEFT JOIN users u ON u.id = a.user_id
       WHERE a.created_at::date BETWEEN $1 AND $2
         AND ($3 = '' OR a.module = $3)
       ORDER BY a.created_at DESC
       LIMIT 2000`,
  },
};
