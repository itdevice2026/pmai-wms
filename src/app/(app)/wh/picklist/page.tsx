import { q } from "@/lib/db";
import { requirePermission, can } from "@/lib/auth";
import { Card, StatCard, DataTable, StatusBadge, Badge, type Column } from "@/components/ui";
import { kg, num, dateStr } from "@/lib/format";
import { PicklistWorkbench } from "./PicklistWorkbench";

export const dynamic = "force-dynamic";
export const metadata = { title: "Picklist · PMAI Warehouse" };

type Row = {
  id: number;
  picklist_no: string;
  pick_date: string;
  customer_name: string | null;
  strategy: string;
  total_weight_kg: string;
  picked_weight_kg: string;
  status: string;
  lines: number;
};

export default async function PicklistPage() {
  const user = await requirePermission("wh.picklist.view");
  const mayManage = can(user, "wh.picklist.manage");

  const [rows, open, customers, skus] = await Promise.all([
    q<Row>(
      `SELECT p.id, p.picklist_no, p.pick_date, c.name AS customer_name, p.strategy,
              p.total_weight_kg, p.picked_weight_kg, p.status::text AS status,
              (SELECT count(*) FROM picklist_lines pl WHERE pl.picklist_id = p.id)::int AS lines
         FROM picklists p LEFT JOIN customers c ON c.id = p.customer_id
        ORDER BY p.pick_date DESC, p.id DESC LIMIT 100`
    ),
    q<{ id: number; picklist_no: string; customer_name: string | null; picked_weight_kg: string; total_weight_kg: string }>(
      `SELECT p.id, p.picklist_no, c.name AS customer_name, p.picked_weight_kg, p.total_weight_kg
         FROM picklists p LEFT JOIN customers c ON c.id = p.customer_id
        WHERE p.status IN ('draft','in_progress') ORDER BY p.created_at DESC`
    ),
    q<{ id: number; name: string }>("SELECT id, name FROM customers WHERE is_active ORDER BY name"),
    q<{ id: number; sku: string; on_hand: number; oldest: string | null }>(
      `SELECT p.id, p.sku,
              count(c.id)::int AS on_hand,
              min(c.production_date)::text AS oldest
         FROM products p
         JOIN crates c ON c.product_id = p.id AND NOT c.is_voided
                      AND c.status IN ('warehouse','storage','wh_received_cut','fps_processed')
        GROUP BY p.id, p.sku HAVING count(c.id) > 0
        ORDER BY p.sku`
    ),
  ]);

  const totalOpen = open.length;
  const pickedToday = rows
    .filter((r) => r.pick_date === new Date().toISOString().slice(0, 10))
    .reduce((s, r) => s + Number(r.picked_weight_kg), 0);

  const columns: Column<Row>[] = [
    { key: "picklist_no", header: "Picklist No." },
    { key: "pick_date", header: "Date", render: (r) => dateStr(r.pick_date) },
    { key: "customer_name", header: "Customer" },
    { key: "strategy", header: "Strategy", render: (r) => <Badge tone="indigo">{r.strategy.toUpperCase()}</Badge> },
    { key: "lines", header: "Lines", align: "right", render: (r) => num(r.lines) },
    { key: "total_weight_kg", header: "Required (kg)", align: "right", render: (r) => kg(r.total_weight_kg) },
    { key: "picked_weight_kg", header: "Picked (kg)", align: "right", render: (r) => kg(r.picked_weight_kg) },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
  ];

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Picklist</h1>
        <p className="mt-1 text-sm text-slate-500">
          Build a pick for a customer. FEFO suggests the oldest production date first.
        </p>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Open picklists" value={num(totalOpen)} tone="amber" />
        <StatCard label="Picked today" value={`${kg(pickedToday)} kg`} tone="green" />
        <StatCard label="SKUs available" value={num(skus.length)} tone="blue" />
      </div>

      {mayManage && (
        <div className="mb-6">
          <PicklistWorkbench open={open} customers={customers} skus={skus} />
        </div>
      )}

      <Card title={`Picklists (${rows.length})`} padded={false}>
        <DataTable columns={columns} rows={rows} rowKey={(r) => String(r.id)} />
      </Card>
    </>
  );
}
