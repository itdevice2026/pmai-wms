import { q } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { StatCard } from "@/components/ui";
import { kg, num } from "@/lib/format";
import { ScanClient } from "./ScanClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "FPS Receiving Station · PMAI Warehouse" };

export default async function Page() {
  await requirePermission("wh.receiving.manage");

  const [locations, stats] = await Promise.all([
    q<{ id: number; code: string; name: string }>(
      `SELECT id, code, name FROM locations
        WHERE is_active AND NOT is_slot AND kind IN ('staging','fps','chiller','production')
        ORDER BY code`
    ),
    q<{ at_fps: string; at_fps_kg: string; received: string; received_kg: string }>(
      `SELECT count(*) FILTER (WHERE status='issued_to_fps') AS at_fps,
              COALESCE(sum(net_weight_kg) FILTER (WHERE status='issued_to_fps'),0) AS at_fps_kg,
              count(*) FILTER (WHERE status='fps_processed') AS received,
              COALESCE(sum(net_weight_kg) FILTER (WHERE status='fps_processed'),0) AS received_kg
         FROM crates WHERE NOT is_voided`
    ),
  ]);
  const s = stats[0];

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">FPS Receiving Station</h1>
        <p className="mt-1 text-sm text-slate-500">
          Scan terminal for booking further-processed crates back into the warehouse.
        </p>
      </div>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Out at FPS" value={num(s.at_fps)} tone="purple" hint="Awaiting return" />
        <StatCard label="Out at FPS weight" value={`${kg(s.at_fps_kg)} kg`} tone="purple" />
        <StatCard label="Received back" value={num(s.received)} tone="green" />
        <StatCard label="Received weight" value={`${kg(s.received_kg)} kg`} tone="green" />
      </div>
      <ScanClient locations={locations} />
    </>
  );
}
