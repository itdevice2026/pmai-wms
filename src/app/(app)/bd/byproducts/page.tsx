import { q } from "@/lib/db";
import { requirePermission, can } from "@/lib/auth";
import { Card, StatCard, DataTable, Field, Input, Select, Button, Textarea, type Column } from "@/components/ui";
import { kg, num, dateStr, toISODate } from "@/lib/format";
import { recordByproduct } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Byproducts · PMAI Warehouse" };

type Row = {
  id: string;
  entry_no: string;
  production_date: string;
  sku: string;
  product_name: string;
  batch_no: string | null;
  quantity: string;
  uom: string;
  recorded_by_name: string | null;
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { saved, error } = await searchParams;
  const user = await requirePermission("bd.byproducts.view");
  const mayManage = can(user, "bd.byproducts.manage");

  const [rows, products, stats] = await Promise.all([
    q<Row>(
      `SELECT b.id, b.entry_no, b.production_date, p.sku, p.name AS product_name,
              b.batch_no, b.quantity, b.uom, u.full_name AS recorded_by_name
         FROM byproduct_entries b
         JOIN products p ON p.id = b.product_id
         LEFT JOIN users u ON u.id = b.recorded_by
        ORDER BY b.production_date DESC, b.id DESC LIMIT 200`
    ),
    q<{ id: number; sku: string; name: string }>(
      "SELECT id, sku, name FROM products WHERE is_active AND stage='byproduct' ORDER BY sku"
    ),
    q<{ today: string; week: string }>(
      `SELECT COALESCE(sum(quantity) FILTER (WHERE production_date = current_date),0) AS today,
              COALESCE(sum(quantity) FILTER (WHERE production_date >= current_date - 7),0) AS week
         FROM byproduct_entries`
    ),
  ]);
  const s = stats[0];

  const columns: Column<Row>[] = [
    { key: "entry_no", header: "Entry No." },
    { key: "production_date", header: "Date", render: (r) => dateStr(r.production_date) },
    { key: "sku", header: "SKU" },
    { key: "product_name", header: "Byproduct" },
    { key: "batch_no", header: "Batch" },
    { key: "quantity", header: "Quantity", align: "right", render: (r) => `${kg(r.quantity)} ${r.uom}` },
    { key: "recorded_by_name", header: "Recorded by" },
  ];

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Byproducts</h1>
        <p className="mt-1 text-sm text-slate-500">
          Feet, heads, gizzard, liver and neck recovered from the dressing line.
        </p>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Today" value={`${kg(s.today)} kg`} tone="brand" />
        <StatCard label="Last 7 days" value={`${kg(s.week)} kg`} tone="blue" />
        <StatCard label="Byproduct SKUs" value={num(products.length)} />
      </div>

      {(saved || error) && (
        <div
          className={`mb-4 rounded-lg px-3 py-2 text-sm ring-1 ring-inset ${
            saved
              ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
              : "bg-rose-50 text-rose-700 ring-rose-200"
          }`}
        >
          {saved ? `Recorded ${saved}` : error}
        </div>
      )}

      {mayManage && (
        <Card title="Record byproduct" className="mb-6">
          <form action={recordByproduct} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <Field label="Byproduct">
              <Select name="productId" required>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Production date">
              <Input type="date" name="productionDate" required defaultValue={toISODate()} />
            </Field>
            <Field label="Quantity (kg)">
              <Input name="quantity" inputMode="decimal" required placeholder="0.00" />
            </Field>
            <Field label="Batch no.">
              <Input name="batchNo" placeholder="Optional" />
            </Field>
            <div className="flex items-end">
              <Button type="submit" className="w-full">Record</Button>
            </div>
            <Field label="Remarks" className="sm:col-span-2 lg:col-span-5">
              <Textarea name="remarks" rows={2} />
            </Field>
          </form>
        </Card>
      )}

      <Card title={`Entries (${rows.length})`} padded={false}>
        <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} />
      </Card>
    </>
  );
}
