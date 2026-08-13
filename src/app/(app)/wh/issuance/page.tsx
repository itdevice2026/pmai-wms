import { q } from "@/lib/db";
import { requirePermission, can } from "@/lib/auth";
import { Card, StatCard, DataTable, StatusBadge, Badge, type Column } from "@/components/ui";
import { kg, num, dateStr } from "@/lib/format";
import { IssuanceWorkbench } from "./IssuanceWorkbench";

export const dynamic = "force-dynamic";
export const metadata = { title: "Issuance · PMAI Warehouse" };

type Row = {
  id: number;
  issuance_no: string;
  issue_date: string;
  purpose: string;
  target: string | null;
  crate_count: number;
  total_weight_kg: string;
  status: string;
  issued_by_name: string | null;
};

export default async function IssuancePage() {
  const user = await requirePermission("wh.issuance.view");
  const mayManage = can(user, "wh.issuance.manage");

  const [stats, rows, open, customers, jobOrders] = await Promise.all([
    q<{ today: string; today_kg: string; open: string }>(
      `SELECT count(*) FILTER (WHERE issue_date = current_date) AS today,
              COALESCE(sum(total_weight_kg) FILTER (WHERE issue_date = current_date),0) AS today_kg,
              count(*) FILTER (WHERE status IN ('draft','in_progress')) AS open
         FROM issuances`
    ),
    q<Row>(
      `SELECT i.id, i.issuance_no, i.issue_date, i.purpose,
              COALESCE(c.name, j.jo_no) AS target,
              i.crate_count, i.total_weight_kg, i.status::text AS status,
              u.full_name AS issued_by_name
         FROM issuances i
         LEFT JOIN customers c ON c.id = i.customer_id
         LEFT JOIN job_orders j ON j.id = i.job_order_id
         LEFT JOIN users u ON u.id = i.issued_by
        ORDER BY i.issue_date DESC, i.id DESC LIMIT 100`
    ),
    q<{ id: number; issuance_no: string; purpose: string; crate_count: number; total_weight_kg: string }>(
      `SELECT id, issuance_no, purpose, crate_count, total_weight_kg
         FROM issuances WHERE status IN ('draft','in_progress')
        ORDER BY created_at DESC`
    ),
    q<{ id: number; name: string }>("SELECT id, name FROM customers WHERE is_active ORDER BY name"),
    q<{ id: number; jo_no: string }>(
      "SELECT id, jo_no FROM job_orders WHERE status IN ('pending','approved','in_progress') ORDER BY jo_no DESC LIMIT 50"
    ),
  ]);

  const s = stats[0];

  const columns: Column<Row>[] = [
    { key: "issuance_no", header: "Issuance No." },
    { key: "issue_date", header: "Date", render: (r) => dateStr(r.issue_date) },
    { key: "purpose", header: "Purpose", render: (r) => <Badge>{r.purpose}</Badge> },
    { key: "target", header: "Customer / JO" },
    { key: "crate_count", header: "Crates", align: "right", render: (r) => num(r.crate_count) },
    { key: "total_weight_kg", header: "Weight (kg)", align: "right", render: (r) => kg(r.total_weight_kg) },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
    { key: "issued_by_name", header: "Issued by" },
  ];

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Issuance</h1>
        <p className="mt-1 text-sm text-slate-500">
          Release stock out of the warehouse — to further processing, cutting, or a customer.
        </p>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Issued today" value={num(s.today)} tone="blue" />
        <StatCard label="Weight today" value={`${kg(s.today_kg)} kg`} tone="green" />
        <StatCard label="Open issuances" value={num(s.open)} tone="amber" />
      </div>

      {mayManage && (
        <div className="mb-6">
          <IssuanceWorkbench open={open} customers={customers} jobOrders={jobOrders} />
        </div>
      )}

      <Card title={`Issuances (${rows.length})`} padded={false}>
        <DataTable columns={columns} rows={rows} rowKey={(r) => String(r.id)} />
      </Card>
    </>
  );
}
