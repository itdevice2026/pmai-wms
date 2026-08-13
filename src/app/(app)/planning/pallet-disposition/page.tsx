import { q } from "@/lib/db";
import { requirePermission, can } from "@/lib/auth";
import { Card, StatCard, DataTable, StatusBadge, Badge, Field, Input, Select, Button, Textarea, type Column } from "@/components/ui";
import { kg, num, dateStr, toISODate } from "@/lib/format";
import { planDisposition } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pallet Disposition · PMAI Warehouse" };

const DISPOSITIONS = [
  { value: "dispatch", label: "Dispatch to customer" },
  { value: "cutting", label: "Send to cutting" },
  { value: "fps", label: "Send to further processing" },
  { value: "hold", label: "Hold (QA)" },
  { value: "rework", label: "Rework" },
  { value: "disposal", label: "Disposal" },
];

type Row = {
  id: number; disposition_no: string; plan_date: string; pallet_no: string | null;
  disposition: string; customer_name: string | null; status: string;
  crate_count: number | null; total_weight_kg: string | null; planned_by_name: string | null;
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const user = await requirePermission("plan.disposition.view");
  const { saved, error } = await searchParams;
  const mayManage = can(user, "plan.disposition.manage");

  const [rows, pallets, customers, stats] = await Promise.all([
    q<Row>(
      `SELECT d.id, d.disposition_no, d.plan_date, pl.pallet_no, d.disposition,
              c.name AS customer_name, d.status::text AS status,
              pl.crate_count, pl.total_weight_kg, u.full_name AS planned_by_name
         FROM pallet_dispositions d
         LEFT JOIN pallets pl ON pl.id = d.pallet_id
         LEFT JOIN customers c ON c.id = d.target_customer_id
         LEFT JOIN users u ON u.id = d.planned_by
        ORDER BY d.plan_date DESC, d.id DESC LIMIT 100`
    ),
    q<{ id: string; pallet_no: string; crate_count: number; total_weight_kg: string; room: string | null }>(
      `SELECT pl.id, pl.pallet_no, pl.crate_count, pl.total_weight_kg, sr.name AS room
         FROM pallets pl
         LEFT JOIN locations l ON l.id = pl.location_id
         LEFT JOIN storage_rooms sr ON sr.id = l.storage_room_id
        WHERE pl.status IN ('stored','open') AND pl.crate_count > 0
        ORDER BY pl.built_at DESC LIMIT 300`
    ),
    q<{ id: number; name: string }>("SELECT id, name FROM customers WHERE is_active ORDER BY name"),
    q<{ pending: string; planned_kg: string }>(
      `SELECT count(*) FILTER (WHERE d.status='pending') AS pending,
              COALESCE(sum(pl.total_weight_kg) FILTER (WHERE d.status='pending'),0) AS planned_kg
         FROM pallet_dispositions d LEFT JOIN pallets pl ON pl.id = d.pallet_id`
    ),
  ]);
  const s = stats[0];

  const columns: Column<Row>[] = [
    { key: "disposition_no", header: "Ref." },
    { key: "plan_date", header: "Plan date", render: (r) => dateStr(r.plan_date) },
    { key: "pallet_no", header: "Pallet" },
    { key: "disposition", header: "Disposition", render: (r) => <Badge tone="indigo">{r.disposition}</Badge> },
    { key: "customer_name", header: "Customer" },
    { key: "crate_count", header: "Crates", align: "right", render: (r) => num(r.crate_count ?? 0) },
    { key: "total_weight_kg", header: "Weight (kg)", align: "right", render: (r) => kg(r.total_weight_kg ?? 0) },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
    { key: "planned_by_name", header: "Planned by" },
  ];

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Pallet Disposition</h1>
        <p className="mt-1 text-sm text-slate-500">
          Decide what happens next to each stored pallet — dispatch, cut, further process, or hold.
        </p>
      </div>

      {(saved || error) && (
        <div className={`mb-4 rounded-lg px-3 py-2 text-sm ring-1 ring-inset ${saved ? "bg-emerald-50 text-emerald-800 ring-emerald-200" : "bg-rose-50 text-rose-700 ring-rose-200"}`}>
          {saved ? `Planned ${saved}` : error}
        </div>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Pending decisions" value={num(s.pending)} tone="amber" />
        <StatCard label="Planned weight" value={`${kg(s.planned_kg)} kg`} />
        <StatCard label="Pallets available" value={num(pallets.length)} tone="blue" />
      </div>

      {mayManage && (
        <Card title="Plan a disposition" className="mb-6">
          <form action={planDisposition} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <Field label="Pallet">
              <Select name="palletId" required>
                {pallets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.pallet_no} · {p.crate_count} crates · {kg(p.total_weight_kg)} kg
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Disposition">
              <Select name="disposition" required>
                {DISPOSITIONS.map((d) => (<option key={d.value} value={d.value}>{d.label}</option>))}
              </Select>
            </Field>
            <Field label="Customer (if dispatch)">
              <Select name="targetCustomerId"><option value="">None</option>
                {customers.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
              </Select>
            </Field>
            <Field label="Plan date">
              <Input type="date" name="planDate" defaultValue={toISODate()} />
            </Field>
            <div className="flex items-end">
              <Button type="submit" className="w-full">Plan</Button>
            </div>
            <Field label="Remarks" className="sm:col-span-2 lg:col-span-5">
              <Textarea name="remarks" rows={2} />
            </Field>
          </form>
        </Card>
      )}

      <Card title={`Dispositions (${rows.length})`} padded={false}>
        <DataTable columns={columns} rows={rows} rowKey={(r) => String(r.id)} />
      </Card>
    </>
  );
}
