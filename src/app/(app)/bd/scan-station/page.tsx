import { q } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { ScanClient } from "./ScanClient";
import { StatCard } from "@/components/ui";
import { kg, num } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "BD Scan Station · PMAI Warehouse" };

export default async function ScanStationPage() {
  await requirePermission("bd.scan.use");

  const [locations, stats] = await Promise.all([
    q<{ id: number; code: string; name: string }>(
      `SELECT id, code, name FROM locations
        WHERE is_active AND kind IN ('staging','chiller','production')
          AND NOT is_slot
        ORDER BY kind, code`
    ),
    q<{ waiting: string; waiting_kg: string; received: string; received_kg: string }>(
      `SELECT
         count(*) FILTER (WHERE status='production')                        AS waiting,
         COALESCE(sum(net_weight_kg) FILTER (WHERE status='production'),0)  AS waiting_kg,
         count(*) FILTER (WHERE status='warehouse')                         AS received,
         COALESCE(sum(net_weight_kg) FILTER (WHERE status='warehouse'),0)   AS received_kg
       FROM crates
      WHERE NOT is_voided AND production_date = current_date`
    ),
  ]);

  const s = stats[0];

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">BD Scan Station</h1>
        <p className="mt-1 text-sm text-slate-500">
          Scan crates off the dressing line to receive them into the warehouse.
        </p>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Waiting on the line" value={num(s.waiting)} tone="amber" hint="Status: production" />
        <StatCard label="Waiting weight" value={`${kg(s.waiting_kg)} kg`} tone="amber" />
        <StatCard label="Received today" value={num(s.received)} tone="blue" hint="Status: warehouse" />
        <StatCard label="Received weight" value={`${kg(s.received_kg)} kg`} tone="green" />
      </div>

      <ScanClient locations={locations} />
    </>
  );
}
