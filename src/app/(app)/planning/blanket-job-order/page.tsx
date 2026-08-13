import { q } from "@/lib/db";
import { requirePermission, can } from "@/lib/auth";
import { Card, StatCard, DataTable, StatusBadge, Field, Input, Select, Button, type Column } from "@/components/ui";
import { kg, num, dateStr, pct, toISODate } from "@/lib/format";
import { createBjo } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Blanket Job Order · PMAI Warehouse" };

type Row = {
  id: number; bjo_no: string; customer_name: string | null; sku: string | null;
  valid_from: string; valid_to: string; total_qty_kg: string; released_qty_kg: string;
  fulfilled_pct: string | null; status: string; jo_count: number;
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const user = await requirePermission("plan.bjo.view");
  const { saved, error } = await searchParams;
  const mayManage = can(user, "plan.bjo.manage");

  const [rows, customers, products, stats] = await Promise.all([
    q<Row>(
      `SELECT b.id, b.bjo_no, c.name AS customer_name, p.sku,
              b.valid_from, b.valid_to, b.total_qty_kg, b.released_qty_kg,
              CASE WHEN b.total_qty_kg > 0
                   THEN round(100 * b.released_qty_kg / b.total_qty_kg, 1) END AS fulfilled_pct,
              b.status::text AS status,
              (SELECT count(*) FROM job_orders j WHERE j.blanket_job_order_id = b.id)::int AS jo_count
         FROM blanket_job_orders b
         LEFT JOIN customers c ON c.id = b.customer_id
         LEFT JOIN products p ON p.id = b.product_id
        ORDER BY b.valid_from DESC, b.id DESC LIMIT 100`
    ),
    q<{ id: number; name: string }>("SELECT id, name FROM customers WHERE is_active ORDER BY name"),
    q<{ id: number; sku: string; name: string }>(
      "SELECT id, sku, name FROM products WHERE is_active ORDER BY sku LIMIT 200"
    ),
    q<{ active: string; committed: string; released: string }>(
      `SELECT count(*) FILTER (WHERE current_date BETWEEN valid_from AND valid_to) AS active,
              COALESCE(sum(total_qty_kg) FILTER (WHERE current_date BETWEEN valid_from AND valid_to),0) AS committed,
              COALESCE(sum(released_qty_kg) FILTER (WHERE current_date BETWEEN valid_from AND valid_to),0) AS released
         FROM blanket_job_orders`
    ),
  ]);
  const s = stats[0];

  const columns: Column<Row>[] = [
    { key: "bjo_no", header: "BJO No." },
    { key: "customer_name", header: "Customer" },
    { key: "sku", header: "Product" },
    { key: "valid_from", header: "Valid from", render: (r) => dateStr(r.valid_from) },
    { key: "valid_to", header: "Valid to", render: (r) => dateStr(r.valid_to) },
    { key: "total_qty_kg", header: "Committed (kg)", align: "right", render: (r) => kg(r.total_qty_kg) },
    { key: "released_qty_kg", header: "Released (kg)", align: "right", render: (r) => kg(r.released_qty_kg) },
    { key: "fulfilled_pct", header: "Fulfilled", align: "right", render: (r) => (r.fulfilled_pct ? pct(r.fulfilled_pct, 1) : "—") },
    { key: "jo_count", header: "Job orders", align: "right", render: (r) => num(r.jo_count) },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
  ];

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Blanket Job Order</h1>
        <p className="mt-1 text-sm text-slate-500">
          Standing volume commitments to a customer, drawn down by individual job orders.
        </p>
      </div>

      {(saved || error) && (
        <div className={`mb-4 rounded-lg px-3 py-2 text-sm ring-1 ring-inset ${saved ? "bg-emerald-50 text-emerald-800 ring-emerald-200" : "bg-rose-50 text-rose-700 ring-rose-200"}`}>
          {saved ? `Created ${saved}` : error}
        </div>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Active BJOs" value={num(s.active)} tone="indigo" />
        <StatCard label="Committed volume" value={`${kg(s.committed)} kg`} />
        <StatCard label="Released to date" value={`${kg(s.released)} kg`} tone="green" />
      </div>

      {mayManage && (
        <Card title="Create blanket job order" className="mb-6">
          <form action={createBjo} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <Field label="Customer">
              <Select name="customerId" required>
                {customers.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
              </Select>
            </Field>
            <Field label="Product (optional)">
              <Select name="productId"><option value="">Any</option>
                {products.map((p) => (<option key={p.id} value={p.id}>{p.sku}</option>))}
              </Select>
            </Field>
            <Field label="Valid from">
              <Input type="date" name="validFrom" required defaultValue={toISODate()} />
            </Field>
            <Field label="Valid to">
              <Input type="date" name="validTo" required />
            </Field>
            <Field label="Total quantity (kg)">
              <Input name="totalQtyKg" inputMode="decimal" required placeholder="0.00" />
            </Field>
            <div className="flex items-end lg:col-span-5">
              <Button type="submit">Create blanket order</Button>
            </div>
          </form>
        </Card>
      )}

      <Card title={`Blanket job orders (${rows.length})`} padded={false}>
        <DataTable columns={columns} rows={rows} rowKey={(r) => String(r.id)} />
      </Card>
    </>
  );
}
