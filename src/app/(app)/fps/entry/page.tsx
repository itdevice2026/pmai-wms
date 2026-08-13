import { q } from "@/lib/db";
import { requirePermission, can } from "@/lib/auth";
import { Card, StatCard, DataTable, StatusBadge, Field, Input, Select, Button, LinkButton, type Column } from "@/components/ui";
import { kg, num, dateStr, pct, toISODate } from "@/lib/format";
import { createFpsRun } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "FPS Entry · PMAI Warehouse" };

type Row = {
  id: number;
  fps_no: string;
  jo_no: string | null;
  process_date: string;
  station: string | null;
  input_weight_kg: string;
  output_weight_kg: string;
  yield_pct: string | null;
  status: string;
  operator: string | null;
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const user = await requirePermission("fps.entry.view");
  const { saved, error } = await searchParams;
  const mayManage = can(user, "fps.entry.manage");

  const [rows, products, stations, stats] = await Promise.all([
    q<Row>(
      `SELECT f.id, f.fps_no, j.jo_no, f.process_date, s.name AS station,
              f.input_weight_kg, f.output_weight_kg,
              CASE WHEN f.input_weight_kg > 0
                   THEN round(100 * f.output_weight_kg / f.input_weight_kg, 2) END AS yield_pct,
              f.status::text AS status, u.full_name AS operator
         FROM fps_processings f
         LEFT JOIN job_orders j ON j.id = f.job_order_id
         LEFT JOIN stations s ON s.id = f.station_id
         LEFT JOIN users u ON u.id = f.operator_id
        ORDER BY f.process_date DESC, f.id DESC LIMIT 100`
    ),
    q<{ id: number; sku: string; name: string }>(
      "SELECT id, sku, name FROM products WHERE is_active AND stage IN ('fps','cut') ORDER BY sku"
    ),
    q<{ id: number; name: string }>(
      "SELECT id, name FROM stations WHERE is_active AND kind='fps_station' ORDER BY code"
    ),
    q<{ open: string; in_kg: string; out_kg: string }>(
      `SELECT count(*) FILTER (WHERE status='in_progress') AS open,
              COALESCE(sum(input_weight_kg),0) AS in_kg,
              COALESCE(sum(output_weight_kg),0) AS out_kg
         FROM fps_processings WHERE process_date >= current_date - 7`
    ),
  ]);
  const s = stats[0];
  const yieldPct = Number(s.in_kg) > 0 ? (100 * Number(s.out_kg)) / Number(s.in_kg) : 0;

  const columns: Column<Row>[] = [
    { key: "fps_no", header: "FPS No." },
    { key: "jo_no", header: "Job Order" },
    { key: "process_date", header: "Date", render: (r) => dateStr(r.process_date) },
    { key: "station", header: "Station" },
    { key: "input_weight_kg", header: "Input (kg)", align: "right", render: (r) => kg(r.input_weight_kg) },
    { key: "output_weight_kg", header: "Output (kg)", align: "right", render: (r) => kg(r.output_weight_kg) },
    { key: "yield_pct", header: "Yield", align: "right", render: (r) => (r.yield_pct ? pct(r.yield_pct, 2) : "—") },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
    { key: "operator", header: "Operator" },
  ];

  return (
    <>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">FPS Entry</h1>
          <p className="mt-1 text-sm text-slate-500">
            Open a further-processing run. Inputs and outputs are recorded at the station.
          </p>
        </div>
        <LinkButton href="/fps/station" variant="secondary">Go to FPS Station →</LinkButton>
      </div>

      {(saved || error) && (
        <div className={`mb-4 rounded-lg px-3 py-2 text-sm ring-1 ring-inset ${saved ? "bg-emerald-50 text-emerald-800 ring-emerald-200" : "bg-rose-50 text-rose-700 ring-rose-200"}`}>
          {saved ? `Opened ${saved}` : error}
        </div>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Open runs" value={num(s.open)} tone="purple" />
        <StatCard label="Input (7 days)" value={`${kg(s.in_kg)} kg`} />
        <StatCard label="Output (7 days)" value={`${kg(s.out_kg)} kg`} tone="green" />
        <StatCard label="Yield (7 days)" value={pct(yieldPct, 1)} tone={yieldPct >= 70 ? "green" : "amber"} />
      </div>

      {mayManage && (
        <Card title="Open a processing run" className="mb-6">
          <form action={createFpsRun} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <Field label="Target product">
              <Select name="productId">
                <option value="">Not specified</option>
                {products.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
              </Select>
            </Field>
            <Field label="Station">
              <Select name="stationId">
                <option value="">Not specified</option>
                {stations.map((st) => (<option key={st.id} value={st.id}>{st.name}</option>))}
              </Select>
            </Field>
            <Field label="Process date">
              <Input type="date" name="processDate" required defaultValue={toISODate()} />
            </Field>
            <Field label="Target (kg)">
              <Input name="targetQtyKg" inputMode="decimal" placeholder="Optional" />
            </Field>
            <div className="flex items-end">
              <Button type="submit" className="w-full">Open run</Button>
            </div>
          </form>
        </Card>
      )}

      <Card title={`Processing runs (${rows.length})`} padded={false}>
        <DataTable columns={columns} rows={rows} rowKey={(r) => String(r.id)} />
      </Card>
    </>
  );
}
