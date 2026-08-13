import { q } from "@/lib/db";
import { requirePermission, can } from "@/lib/auth";
import { Card, StatCard, DataTable, StatusBadge, type Column } from "@/components/ui";
import { kg, num, dateStr } from "@/lib/format";
import { DispatchWorkbench } from "./DispatchWorkbench";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dispatch · PMAI Warehouse" };

type Row = {
  id: number;
  dispatch_no: string;
  dispatch_date: string;
  customer_name: string | null;
  dr_no: string | null;
  plate_no: string | null;
  truck_temp_c: string | null;
  total_weight_kg: string;
  status: string;
  crates: number;
};

export default async function DispatchPage() {
  const user = await requirePermission("wh.dispatch.view");
  const mayManage = can(user, "wh.dispatch.manage");
  const mayRelease = can(user, "wh.dispatch.release");

  const [rows, open, customers, picklists, stats] = await Promise.all([
    q<Row>(
      `SELECT d.id, d.dispatch_no, d.dispatch_date, c.name AS customer_name, d.dr_no,
              d.plate_no, d.truck_temp_c, d.total_weight_kg, d.status::text AS status,
              (SELECT count(*) FROM dispatch_lines dl WHERE dl.dispatch_id = d.id)::int AS crates
         FROM dispatches d LEFT JOIN customers c ON c.id = d.customer_id
        ORDER BY d.dispatch_date DESC, d.id DESC LIMIT 100`
    ),
    q<{ id: number; dispatch_no: string; customer_name: string | null; total_weight_kg: string }>(
      `SELECT d.id, d.dispatch_no, c.name AS customer_name, d.total_weight_kg
         FROM dispatches d LEFT JOIN customers c ON c.id = d.customer_id
        WHERE d.status IN ('draft','in_progress') ORDER BY d.created_at DESC`
    ),
    q<{ id: number; name: string }>("SELECT id, name FROM customers WHERE is_active ORDER BY name"),
    q<{ id: number; picklist_no: string; customer_id: number | null; picked_weight_kg: string }>(
      `SELECT id, picklist_no, customer_id, picked_weight_kg FROM picklists
        WHERE status = 'completed'
          AND NOT EXISTS (SELECT 1 FROM dispatches d WHERE d.picklist_id = picklists.id)
        ORDER BY pick_date DESC LIMIT 50`
    ),
    q<{ today: string; today_kg: string; picked: string; picked_kg: string }>(
      `SELECT
         (SELECT count(*) FROM dispatches WHERE dispatch_date = current_date) AS today,
         (SELECT COALESCE(sum(total_weight_kg),0) FROM dispatches WHERE dispatch_date = current_date) AS today_kg,
         (SELECT count(*) FROM crates WHERE status='picked' AND NOT is_voided) AS picked,
         (SELECT COALESCE(sum(net_weight_kg),0) FROM crates WHERE status='picked' AND NOT is_voided) AS picked_kg`
    ),
  ]);

  const s = stats[0];

  const columns: Column<Row>[] = [
    { key: "dispatch_no", header: "Dispatch No." },
    { key: "dispatch_date", header: "Date", render: (r) => dateStr(r.dispatch_date) },
    { key: "customer_name", header: "Customer" },
    { key: "dr_no", header: "DR No." },
    { key: "plate_no", header: "Plate" },
    { key: "truck_temp_c", header: "Temp °C", align: "right", render: (r) => (r.truck_temp_c ?? "—") },
    { key: "crates", header: "Crates", align: "right", render: (r) => num(r.crates) },
    { key: "total_weight_kg", header: "Weight (kg)", align: "right", render: (r) => kg(r.total_weight_kg) },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
  ];

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Dispatch</h1>
        <p className="mt-1 text-sm text-slate-500">
          Load picked stock onto a vehicle and release it, with cold-chain details recorded.
        </p>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Dispatched today" value={num(s.today)} tone="blue" />
        <StatCard label="Weight today" value={`${kg(s.today_kg)} kg`} tone="green" />
        <StatCard label="Awaiting dispatch" value={num(s.picked)} tone="amber" hint="Crates picked" />
        <StatCard label="Awaiting weight" value={`${kg(s.picked_kg)} kg`} tone="amber" />
      </div>

      {mayManage && (
        <div className="mb-6">
          <DispatchWorkbench
            open={open}
            customers={customers}
            picklists={picklists}
            mayRelease={mayRelease}
          />
        </div>
      )}

      <Card title={`Dispatches (${rows.length})`} padded={false}>
        <DataTable columns={columns} rows={rows} rowKey={(r) => String(r.id)} />
      </Card>
    </>
  );
}
