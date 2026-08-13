import { q } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { Card, StatCard, DataTable, Badge, LinkButton, type Column } from "@/components/ui";
import { kg, num, dateStr, relTime } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "FPS Receiving · PMAI Warehouse" };

type Row = {
  crate_no: string;
  sku: string;
  production_date: string;
  net_weight_kg: string;
  issuance_no: string | null;
  issued_at: string | null;
  age_hours: number | null;
};

export default async function Page() {
  await requirePermission("wh.receiving.view");

  const [rows, stats] = await Promise.all([
    q<Row>(
      `SELECT c.crate_no, p.sku, c.production_date, c.net_weight_kg,
              i.issuance_no,
              m.occurred_at AS issued_at,
              round(EXTRACT(EPOCH FROM (now() - m.occurred_at))/3600)::int AS age_hours
         FROM crates c
         JOIN products p ON p.id = c.product_id
         LEFT JOIN LATERAL (
           SELECT occurred_at, ref_id FROM crate_movements
            WHERE crate_id = c.id AND to_status = 'issued_to_fps'
            ORDER BY occurred_at DESC LIMIT 1) m ON true
         LEFT JOIN issuances i ON i.id = m.ref_id
        WHERE NOT c.is_voided AND c.status = 'issued_to_fps'
        ORDER BY m.occurred_at NULLS LAST
        LIMIT 500`
    ),
    q<{ cnt: string; wt: string }>(
      `SELECT count(*) AS cnt, COALESCE(sum(net_weight_kg),0) AS wt
         FROM crates WHERE NOT is_voided AND status = 'issued_to_fps'`
    ),
  ]);
  const s = stats[0];

  const columns: Column<Row>[] = [
    { key: "crate_no", header: "Crate" },
    { key: "sku", header: "SKU" },
    { key: "production_date", header: "Prod. Date", render: (r) => dateStr(r.production_date) },
    { key: "net_weight_kg", header: "Weight (kg)", align: "right", render: (r) => kg(r.net_weight_kg) },
    { key: "issuance_no", header: "Issued on" },
    { key: "issued_at", header: "Issued", render: (r) => (r.issued_at ? relTime(r.issued_at) : "—") },
    {
      key: "age_hours",
      header: "Hours out",
      align: "right",
      render: (r) =>
        r.age_hours == null ? "—" : (
          <Badge tone={r.age_hours > 24 ? "red" : r.age_hours > 8 ? "amber" : "slate"}>
            {num(r.age_hours)}h
          </Badge>
        ),
    },
  ];

  return (
    <>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">FPS Receiving</h1>
          <p className="mt-1 text-sm text-slate-500">
            Crates currently out at further processing, awaiting return to the warehouse.
          </p>
        </div>
        <LinkButton href="/wh/fps-receiving-station">Open scan station →</LinkButton>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        <StatCard label="Crates out at FPS" value={num(s.cnt)} tone="purple" />
        <StatCard label="Weight out at FPS" value={`${kg(s.wt)} kg`} tone="purple" />
      </div>

      <Card title={`Awaiting return (${rows.length})`} padded={false}>
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.crate_no}
          empty="Nothing is out at further processing."
        />
      </Card>
    </>
  );
}
