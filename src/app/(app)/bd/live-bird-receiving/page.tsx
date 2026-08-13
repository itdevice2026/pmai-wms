import { q } from "@/lib/db";
import { requirePermission, can } from "@/lib/auth";
import { Card, StatCard, DataTable, StatusBadge, type Column } from "@/components/ui";
import { kg, num, dateStr, pct } from "@/lib/format";
import { ReceiptForm } from "./ReceiptForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Live Bird Receiving · PMAI Warehouse" };

type Receipt = {
  id: number;
  receipt_no: string;
  receipt_date: string;
  grower_name: string;
  batch_no: string | null;
  plate_no: string | null;
  heads_received: number;
  heads_doa: number;
  net_weight_kg: string;
  ave_weight_kg: string | null;
  doa_pct: string | null;
  status: string;
  received_by_name: string | null;
};

export default async function LiveBirdReceivingPage() {
  const user = await requirePermission("bd.live_bird.view");
  const mayManage = can(user, "bd.live_bird.manage");

  const [stats, receipts, growers] = await Promise.all([
    q<{ receipts: string; heads: string; doa: string; weight: string }>(
      `SELECT count(*) AS receipts,
              COALESCE(sum(heads_received),0) AS heads,
              COALESCE(sum(heads_doa),0) AS doa,
              COALESCE(sum(gross_weight_kg - tare_weight_kg),0) AS weight
         FROM live_bird_receipts
        WHERE receipt_date >= current_date - 7`
    ),
    q<Receipt>(
      `SELECT r.id, r.receipt_no, r.receipt_date, g.name AS grower_name, r.batch_no,
              r.plate_no, r.heads_received, r.heads_doa, r.net_weight_kg, r.ave_weight_kg,
              CASE WHEN r.heads_received > 0
                   THEN round(100.0 * r.heads_doa / r.heads_received, 2) END AS doa_pct,
              r.status::text AS status, u.full_name AS received_by_name
         FROM live_bird_receipts r
         JOIN growers g ON g.id = r.grower_id
         LEFT JOIN users u ON u.id = r.received_by
        ORDER BY r.receipt_date DESC, r.id DESC
        LIMIT 200`
    ),
    q<{ id: number; code: string; name: string }>(
      "SELECT id, code, name FROM growers WHERE is_active ORDER BY name"
    ),
  ]);

  const s = stats[0];

  const columns: Column<Receipt>[] = [
    { key: "receipt_no", header: "Receipt No." },
    { key: "receipt_date", header: "Date", render: (r) => dateStr(r.receipt_date) },
    { key: "grower_name", header: "Grower" },
    { key: "batch_no", header: "Batch" },
    { key: "plate_no", header: "Plate" },
    { key: "heads_received", header: "Heads", align: "right", render: (r) => num(r.heads_received) },
    { key: "heads_doa", header: "DOA", align: "right", render: (r) => num(r.heads_doa) },
    { key: "doa_pct", header: "DOA %", align: "right", render: (r) => (r.doa_pct ? pct(r.doa_pct, 2) : "—") },
    { key: "net_weight_kg", header: "Net (kg)", align: "right", render: (r) => kg(r.net_weight_kg) },
    { key: "ave_weight_kg", header: "Ave/Head", align: "right", render: (r) => (r.ave_weight_kg ? kg(r.ave_weight_kg, 3) : "—") },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
  ];

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Live Bird Receiving</h1>
        <p className="mt-1 text-sm text-slate-500">
          Incoming flocks from contract growers — the start of the traceability chain.
        </p>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Receipts (7 days)" value={num(s.receipts)} />
        <StatCard label="Heads received" value={num(s.heads)} tone="blue" />
        <StatCard label="Dead on arrival" value={num(s.doa)} tone="red" />
        <StatCard label="Live weight" value={`${kg(s.weight)} kg`} tone="green" />
      </div>

      {mayManage && (
        <div className="mb-6">
          <ReceiptForm growers={growers} />
        </div>
      )}

      <Card title={`Receipts (${receipts.length})`} padded={false}>
        <DataTable columns={columns} rows={receipts} rowKey={(r) => String(r.id)} />
      </Card>
    </>
  );
}
