import { q } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { Card, DataTable, Badge, type Column } from "@/components/ui";
import { dateTimeStr, num } from "@/lib/format";
import { ImportForm } from "./ImportForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Import · PMAI Warehouse" };

type Row = {
  id: number; filename: string; target: string; row_count: number;
  success_count: number; error_count: number; imported_at: string; imported_by_name: string | null;
};

export default async function Page() {
  await requirePermission("bd.import.use");

  const rows = await q<Row>(
    `SELECT b.id, b.filename, b.target, b.row_count, b.success_count, b.error_count,
            b.imported_at, u.full_name AS imported_by_name
       FROM import_batches b LEFT JOIN users u ON u.id = b.imported_by
      ORDER BY b.imported_at DESC LIMIT 100`
  );

  const columns: Column<Row>[] = [
    { key: "filename", header: "File" },
    { key: "target", header: "Target", render: (r) => <Badge>{r.target}</Badge> },
    { key: "row_count", header: "Rows", align: "right", render: (r) => num(r.row_count) },
    {
      key: "success_count", header: "Imported", align: "right",
      render: (r) => <span className="text-emerald-600">{num(r.success_count)}</span>,
    },
    {
      key: "error_count", header: "Rejected", align: "right",
      render: (r) => (r.error_count > 0 ? <span className="text-rose-600">{num(r.error_count)}</span> : "0"),
    },
    { key: "imported_at", header: "When", render: (r) => dateTimeStr(r.imported_at) },
    { key: "imported_by_name", header: "By" },
  ];

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Import</h1>
        <p className="mt-1 text-sm text-slate-500">
          Bulk-load weighing records from a CSV — for catching up after a scale or network outage.
        </p>
      </div>
      <div className="mb-6"><ImportForm /></div>
      <Card title={`Import history (${rows.length})`} padded={false}>
        <DataTable columns={columns} rows={rows} rowKey={(r) => String(r.id)} empty="Nothing imported yet." />
      </Card>
    </>
  );
}
