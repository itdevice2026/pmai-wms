/**
 * Report screens for the browser build.
 *
 * Every report in the Report section is one entry in REPORTS below: a view
 * name, a date column and column metadata. ReportScreen does the rest —
 * filtering, totals, CSV export and rendering — so adding a report is a
 * config change, not a new component.
 *
 * The views live in db/014_report_views.sql and already exclude locked
 * records, so nothing here needs to know about locking.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { sb } from "./supabase";
import {
  Card, DataTable, ErrorBox, PageHeader, Spinner, inputClass,
} from "./ui";
import type { Column } from "./ui";
import { csvEscape, dateStr, dateTimeStr, kg, num, pct, toISODate } from "./format";

type Row = Record<string, unknown>;
type Fmt = "kg" | "num" | "date" | "datetime" | "pct" | "text";

type ColSpec = { key: string; header: string; align?: "left" | "right"; format?: Fmt };

type ReportSpec = {
  title: string;
  subtitle: string;
  /** Postgres view, from db/014 */
  view: string;
  /** Column the date range filters on. Omit for reports that are not date-scoped. */
  dateColumn?: string;
  /** Free-text filter, e.g. crate number */
  textFilter?: { column: string; label: string; placeholder?: string };
  columns: ColSpec[];
  /** Columns summed into a totals row */
  totals?: string[];
  defaultDays?: number;
  orderBy?: { column: string; ascending?: boolean };
  limit?: number;
};

/* ------------------------------------------------------------------ formatting */

function renderCell(value: unknown, format?: Fmt): string {
  if (value === null || value === undefined || value === "") return "—";
  switch (format) {
    case "kg": return kg(Number(value));
    case "num": return num(Number(value));
    case "pct": return pct(Number(value));
    case "date": return dateStr(String(value));
    case "datetime": return dateTimeStr(String(value));
    default: return String(value);
  }
}

/** Only numeric formats participate in a totals row. */
const SUMMABLE: ReadonlySet<Fmt | undefined> = new Set<Fmt | undefined>(["kg", "num"]);

/* ------------------------------------------------------------------ the screen */

function ReportScreen({ spec }: { spec: ReportSpec }) {
  const today = toISODate(new Date());
  const start = toISODate(
    new Date(Date.now() - (spec.defaultDays ?? 7) * 86_400_000)
  );

  const [from, setFrom] = useState(start);
  const [to, setTo] = useState(today);
  const [text, setText] = useState("");
  // Applied values are separate from the inputs so typing does not refetch.
  const [applied, setApplied] = useState({ from: start, to: today, text: "" });

  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      let query = sb()
        .from(spec.view)
        .select(spec.columns.map((c) => c.key).join(","));

      if (spec.dateColumn) {
        query = query.gte(spec.dateColumn, applied.from).lte(spec.dateColumn, applied.to);
      }
      if (spec.textFilter && applied.text.trim()) {
        query = query.ilike(spec.textFilter.column, `%${applied.text.trim()}%`);
      }
      if (spec.orderBy) {
        query = query.order(spec.orderBy.column, { ascending: spec.orderBy.ascending ?? false });
      }
      query = query.limit(spec.limit ?? 2000);

      const { data, error: e } = await query;
      if (e) throw new Error(e.message);
      setRows((data ?? []) as unknown as Row[]);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [spec, applied]);

  useEffect(() => { void load(); }, [load]);

  const totals = useMemo(() => {
    if (!spec.totals?.length) return null;
    const acc: Record<string, number> = {};
    for (const key of spec.totals) {
      acc[key] = rows.reduce((sum, r) => sum + (Number(r[key]) || 0), 0);
    }
    return acc;
  }, [rows, spec.totals]);

  const columns: Column<Row>[] = spec.columns.map((c) => ({
    key: c.key,
    header: c.header,
    align: c.align,
    render: (row: Row) => renderCell(row[c.key], c.format),
  }));

  function exportCsv() {
    const header = spec.columns.map((c) => csvEscape(c.header)).join(",");
    const body = rows
      .map((r) => spec.columns.map((c) => csvEscape(renderCell(r[c.key], c.format))).join(","))
      .join("\n");
    const blob = new Blob([`${header}\n${body}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${spec.view.replace(/^v_rpt_/, "")}-${applied.from}-to-${applied.to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <PageHeader title={spec.title} subtitle={spec.subtitle} />

      {/* Always rendered: reports without a date range still need CSV export. */}
      <Card className="mb-5">
        <div className="flex flex-wrap items-end gap-3">
            {spec.dateColumn && (
              <>
                <label className="text-sm">
                  <span className="mb-1 block text-xs font-medium text-slate-600">From</span>
                  <input type="date" className={inputClass} value={from}
                    onChange={(e) => setFrom(e.target.value)} />
                </label>
                <label className="text-sm">
                  <span className="mb-1 block text-xs font-medium text-slate-600">To</span>
                  <input type="date" className={inputClass} value={to}
                    onChange={(e) => setTo(e.target.value)} />
                </label>
              </>
            )}
            {spec.textFilter && (
              <label className="text-sm">
                <span className="mb-1 block text-xs font-medium text-slate-600">
                  {spec.textFilter.label}
                </span>
                <input className={inputClass} value={text} placeholder={spec.textFilter.placeholder}
                  onChange={(e) => setText(e.target.value)} />
              </label>
            )}
            {(spec.dateColumn || spec.textFilter) && (
              <button
                type="button"
                onClick={() => setApplied({ from, to, text })}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
              >
                Apply
              </button>
            )}
            <button
              type="button"
              onClick={exportCsv}
              disabled={rows.length === 0}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              ⬇ Export CSV
            </button>
        </div>
      </Card>

      {loading && <Spinner />}
      {error && !loading && <ErrorBox message={error} />}

      {!loading && !error && (
        <Card padded={false}>
          <DataTable columns={columns} rows={rows}
            empty={`No records for ${applied.from} to ${applied.to}.`} />
          {totals && rows.length > 0 && (
            <div className="flex flex-wrap gap-6 border-t border-slate-200 bg-slate-50/80 px-4 py-3 text-sm">
              <span className="font-semibold text-slate-500">
                {num(rows.length)} row{rows.length === 1 ? "" : "s"}
              </span>
              {spec.totals!.map((key) => {
                const col = spec.columns.find((c) => c.key === key);
                if (!col || !SUMMABLE.has(col.format)) return null;
                return (
                  <span key={key} className="text-slate-600">
                    {col.header}:{" "}
                    <strong className="text-slate-900">
                      {renderCell(totals[key], col.format)}
                    </strong>
                  </span>
                );
              })}
            </div>
          )}
        </Card>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ the registry */

const REPORTS: Record<string, ReportSpec> = {
  basicDressing: {
    title: "Basic Dressing Report",
    subtitle: "Crates weighed on the dressing line, by production date and SKU.",
    view: "v_rpt_basic_dressing",
    dateColumn: "production_date",
    orderBy: { column: "production_date" },
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
  },

  fpsOutput: {
    title: "FPS Production Output",
    subtitle: "Further-processing runs with input, output and yield.",
    view: "v_rpt_fps_output",
    dateColumn: "process_date",
    orderBy: { column: "process_date" },
    totals: ["input_weight_kg", "output_weight_kg"],
    columns: [
      { key: "fps_no", header: "FPS No." },
      { key: "process_date", header: "Date", format: "date" },
      { key: "jo_no", header: "Job Order" },
      { key: "station", header: "Station" },
      { key: "input_weight_kg", header: "Input (kg)", align: "right", format: "kg" },
      { key: "output_weight_kg", header: "Output (kg)", align: "right", format: "kg" },
      { key: "yield_pct", header: "Yield", align: "right", format: "pct" },
      { key: "status", header: "Status" },
      { key: "operator", header: "Operator" },
    ],
  },

  pallets: {
    title: "Pallets",
    subtitle: "All pallets with contents, location and storage age.",
    view: "v_rpt_pallets",
    dateColumn: "built_date",
    defaultDays: 30,
    orderBy: { column: "built_at" },
    totals: ["crate_count", "total_weight_kg"],
    columns: [
      { key: "pallet_no", header: "Pallet" },
      { key: "kind", header: "Type" },
      { key: "status", header: "Status" },
      { key: "storage_room", header: "Room" },
      { key: "slot_code", header: "Slot" },
      { key: "crate_count", header: "Crates", align: "right", format: "num" },
      { key: "total_weight_kg", header: "Weight (kg)", align: "right", format: "kg" },
      // Live drives the 3-day review / 4-day decide alerts off this.
      { key: "storage_age_days", header: "Storage Age", align: "right", format: "num" },
      { key: "disposition", header: "Disposition" },
      { key: "built_at", header: "Built", format: "datetime" },
      { key: "built_by_name", header: "Built by" },
    ],
  },

  warehouseRecords: {
    title: "Warehouse Records",
    subtitle: "Every crate movement recorded in the warehouse.",
    view: "v_rpt_warehouse_records",
    dateColumn: "occurred_date",
    orderBy: { column: "occurred_at" },
    columns: [
      { key: "occurred_at", header: "When", format: "datetime" },
      { key: "crate_no", header: "Crate" },
      { key: "sku", header: "SKU" },
      { key: "kind", header: "Movement" },
      { key: "from_status", header: "From" },
      { key: "to_status", header: "To" },
      { key: "from_location", header: "From Slot" },
      { key: "to_location", header: "To Slot" },
      { key: "weight_kg", header: "Weight (kg)", align: "right", format: "kg" },
      { key: "user_name", header: "By" },
    ],
  },

  storageRooms: {
    title: "Storage Rooms",
    subtitle:
      "Capacity and utilisation per room. Rooms without defined slots show no utilisation — stock there is tracked at room level.",
    view: "v_rpt_storage_rooms",
    orderBy: { column: "sort_order", ascending: true },
    totals: ["crates", "weight_kg"],
    columns: [
      { key: "name", header: "Room" },
      { key: "kind", header: "Type" },
      { key: "temp_range", header: "Temp (°C)" },
      { key: "is_available", header: "Status" },
      { key: "total_slots", header: "Slots", align: "right", format: "num" },
      { key: "occupied", header: "Occupied", align: "right", format: "num" },
      { key: "blocked", header: "Blocked", align: "right", format: "num" },
      { key: "available", header: "Available", align: "right", format: "num" },
      { key: "utilisation_pct", header: "Utilisation", align: "right", format: "pct" },
      { key: "crates", header: "Crates", align: "right", format: "num" },
      { key: "weight_kg", header: "Weight (kg)", align: "right", format: "kg" },
    ],
  },

  productionSummary: {
    title: "Production Summary",
    subtitle: "Daily dressing output: heads, crates and weight.",
    view: "v_rpt_production_summary",
    dateColumn: "production_date",
    orderBy: { column: "production_date" },
    totals: ["crate_count", "head_count", "total_weight_kg"],
    columns: [
      { key: "production_date", header: "Date", format: "date" },
      { key: "sku_count", header: "SKUs", align: "right", format: "num" },
      { key: "crate_count", header: "Crates", align: "right", format: "num" },
      { key: "head_count", header: "Heads", align: "right", format: "num" },
      { key: "total_weight_kg", header: "Weight (kg)", align: "right", format: "kg" },
      { key: "ave_head_kg", header: "Ave/Head", align: "right", format: "kg" },
    ],
  },

  issuanceSummary: {
    title: "Issuance Summary",
    subtitle: "Stock issued out of the warehouse, by purpose.",
    view: "v_rpt_issuance_summary",
    dateColumn: "issue_date",
    orderBy: { column: "issue_date" },
    totals: ["crate_count", "total_weight_kg"],
    columns: [
      { key: "issuance_no", header: "Issuance No." },
      { key: "issue_date", header: "Date", format: "date" },
      { key: "purpose", header: "Purpose" },
      { key: "customer", header: "Customer / JO" },
      { key: "crate_count", header: "Crates", align: "right", format: "num" },
      { key: "total_weight_kg", header: "Weight (kg)", align: "right", format: "kg" },
      { key: "status", header: "Status" },
      { key: "issued_by_name", header: "Issued by" },
    ],
  },

  dispatchSummary: {
    title: "Dispatch Summary",
    subtitle: "Outbound deliveries with cold-chain details.",
    view: "v_rpt_dispatch_summary",
    dateColumn: "dispatch_date",
    orderBy: { column: "dispatch_date" },
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
      { key: "status", header: "Status" },
    ],
  },

  crateAudit: {
    title: "Crate Audit",
    subtitle:
      "Movement history per crate, with the QR-created to QR-scanned wait time. Enter a crate number to trace one.",
    view: "v_rpt_crate_audit",
    dateColumn: "occurred_date",
    defaultDays: 30,
    textFilter: { column: "crate_no", label: "Crate No.", placeholder: "PMAI-20260813-0001-P1" },
    orderBy: { column: "occurred_at" },
    columns: [
      { key: "crate_no", header: "Crate" },
      { key: "sku", header: "SKU" },
      { key: "occurred_at", header: "When", format: "datetime" },
      { key: "kind", header: "Movement" },
      { key: "from_status", header: "From" },
      { key: "to_status", header: "To" },
      { key: "to_location", header: "Slot" },
      { key: "qr_created_at", header: "QR Created", format: "datetime" },
      { key: "qr_scanned_at", header: "QR Scanned", format: "datetime" },
      { key: "wait_seconds", header: "Wait (s)", align: "right", format: "num" },
      { key: "user_name", header: "By" },
    ],
  },

  unscannedCrates: {
    title: "Unscanned Crates",
    subtitle:
      "Crates weighed on the line but never scanned into the warehouse. These are unaccounted stock.",
    view: "v_rpt_unscanned_crates",
    dateColumn: "production_date",
    orderBy: { column: "weighed_at", ascending: true },
    totals: ["heads", "net_weight_kg"],
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
  },

  jobOrders: {
    title: "Job Order List",
    subtitle: "Production job orders and their blanket order coverage.",
    view: "v_rpt_job_orders",
    dateColumn: "scheduled_date",
    defaultDays: 30,
    orderBy: { column: "scheduled_date" },
    totals: ["target_qty_kg"],
    columns: [
      { key: "jo_no", header: "JO No." },
      { key: "scheduled_date", header: "Scheduled", format: "date" },
      { key: "bjo_no", header: "Blanket JO" },
      { key: "sku", header: "Product" },
      { key: "target_qty_kg", header: "Target (kg)", align: "right", format: "kg" },
      { key: "status", header: "Status" },
      { key: "created_by_name", header: "Created by" },
      { key: "approved_by_name", header: "Approved by" },
    ],
  },

  activityLog: {
    title: "User Activity Log",
    subtitle: "Every action recorded in the system, with the user who performed it.",
    view: "v_rpt_activity_log",
    dateColumn: "created_date",
    orderBy: { column: "created_at" },
    columns: [
      { key: "created_at", header: "When", format: "datetime" },
      { key: "user_name", header: "User" },
      { key: "segment", header: "Segment" },
      { key: "action", header: "Action" },
      { key: "entity", header: "Entity" },
      { key: "description", header: "Description" },
      { key: "ip_address", header: "IP" },
    ],
  },
};

/* ------------------------------------------------------------------ exports */

export const BasicDressingReport = () => <ReportScreen spec={REPORTS.basicDressing} />;
export const FpsOutputReport = () => <ReportScreen spec={REPORTS.fpsOutput} />;
export const PalletsReport = () => <ReportScreen spec={REPORTS.pallets} />;
export const WarehouseRecordsReport = () => <ReportScreen spec={REPORTS.warehouseRecords} />;
export const StorageRoomsReport = () => <ReportScreen spec={REPORTS.storageRooms} />;
export const ProductionSummaryReport = () => <ReportScreen spec={REPORTS.productionSummary} />;
export const IssuanceSummaryReport = () => <ReportScreen spec={REPORTS.issuanceSummary} />;
export const DispatchSummaryReport = () => <ReportScreen spec={REPORTS.dispatchSummary} />;
export const CrateAuditReport = () => <ReportScreen spec={REPORTS.crateAudit} />;
export const UnscannedCratesReport = () => <ReportScreen spec={REPORTS.unscannedCrates} />;
export const JobOrdersReport = () => <ReportScreen spec={REPORTS.jobOrders} />;
export const ActivityLogReport = () => <ReportScreen spec={REPORTS.activityLog} />;
