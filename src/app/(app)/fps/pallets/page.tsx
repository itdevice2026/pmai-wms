import { q } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { Card, StatCard, DataTable, Badge, type Column } from "@/components/ui";
import { kg, num, dateTimeStr } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "FPS Pallets · PMAI Warehouse" };

type Row = {
  id: string; pallet_no: string; status: string; crate_count: number;
  total_weight_kg: string; slot_code: string | null; room: string | null;
  built_at: string; built_by_name: string | null;
};

export default async function Page() {
  await requirePermission("fps.pallets.manage");

  const [rows, stats] = await Promise.all([
    q<Row>(
      `SELECT pl.id, pl.pallet_no, pl.status, pl.crate_count, pl.total_weight_kg,
              l.code AS slot_code, sr.name AS room, pl.built_at, u.full_name AS built_by_name
         FROM pallets pl
         LEFT JOIN locations l ON l.id = pl.location_id
         LEFT JOIN storage_rooms sr ON sr.id = l.storage_room_id
         LEFT JOIN users u ON u.id = pl.built_by
        WHERE pl.kind = 'fps'
        ORDER BY pl.built_at DESC LIMIT 200`
    ),
    q<{ cnt: string; crates: string; wt: string }>(
      `SELECT count(*) AS cnt, COALESCE(sum(crate_count),0) AS crates,
              COALESCE(sum(total_weight_kg),0) AS wt
         FROM pallets WHERE kind='fps' AND status <> 'dispatched'`
    ),
  ]);
  const s = stats[0];

  const columns: Column<Row>[] = [
    { key: "pallet_no", header: "Pallet" },
    { key: "status", header: "Status", render: (r) => <Badge>{r.status}</Badge> },
    { key: "room", header: "Room" },
    { key: "slot_code", header: "Slot" },
    { key: "crate_count", header: "Crates", align: "right", render: (r) => num(r.crate_count) },
    { key: "total_weight_kg", header: "Weight (kg)", align: "right", render: (r) => kg(r.total_weight_kg) },
    { key: "built_at", header: "Built", render: (r) => dateTimeStr(r.built_at) },
    { key: "built_by_name", header: "Built by" },
  ];

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">FPS Pallets</h1>
        <p className="mt-1 text-sm text-slate-500">Pallets built from further-processed output.</p>
      </div>
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Active pallets" value={num(s.cnt)} tone="purple" />
        <StatCard label="Crates on pallets" value={num(s.crates)} />
        <StatCard label="Total weight" value={`${kg(s.wt)} kg`} tone="green" />
      </div>
      <Card title={`FPS pallets (${rows.length})`} padded={false}>
        <DataTable columns={columns} rows={rows} rowKey={(r) => r.id}
          empty="No FPS pallets yet — they are created as further-processed output is palletised." />
      </Card>
    </>
  );
}
