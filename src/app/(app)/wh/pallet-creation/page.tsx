import { q } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { PalletBuilder } from "./PalletBuilder";
import { Card, StatCard } from "@/components/ui";
import { kg, num, dateTimeStr } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "BD Pallet Creation · PMAI Warehouse" };

export default async function PalletCreationPage() {
  await requirePermission("wh.pallet.manage");

  const [openPallets, slots, stats] = await Promise.all([
    q<{
      id: string; pallet_no: string; crate_count: number;
      total_weight_kg: string; built_at: string; slot_code: string | null;
    }>(
      `SELECT pl.id, pl.pallet_no, pl.crate_count, pl.total_weight_kg, pl.built_at,
              l.code AS slot_code
         FROM pallets pl LEFT JOIN locations l ON l.id = pl.location_id
        WHERE pl.status = 'open'
        ORDER BY pl.built_at DESC`
    ),
    q<{ id: number; code: string; room: string }>(
      `SELECT l.id, l.code, sr.name AS room
         FROM locations l
         JOIN storage_rooms sr ON sr.id = l.storage_room_id
        WHERE l.is_slot AND l.is_active AND sr.is_available
          AND NOT EXISTS (
            SELECT 1 FROM pallets p
             WHERE p.location_id = l.id AND p.status <> 'dispatched')
        ORDER BY sr.sort_order, l.code
        LIMIT 400`
    ),
    q<{ loose: string; loose_kg: string }>(
      `SELECT count(*) AS loose, COALESCE(sum(net_weight_kg),0) AS loose_kg
         FROM crates
        WHERE NOT is_voided AND status = 'warehouse' AND pallet_id IS NULL`
    ),
  ]);

  const s = stats[0];

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">BD Pallet Creation</h1>
        <p className="mt-1 text-sm text-slate-500">
          Build a pallet from received crates, then put it away into a storage slot.
        </p>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Loose crates" value={num(s.loose)} tone="amber" hint="Received, not yet palletised" />
        <StatCard label="Loose weight" value={`${kg(s.loose_kg)} kg`} />
        <StatCard label="Open pallets" value={num(openPallets.length)} tone="blue" />
      </div>

      <PalletBuilder openPallets={openPallets} slots={slots} />

      <Card title="Open pallets" padded={false} className="mt-6">
        {openPallets.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-slate-400">
            No open pallets. Start one above.
          </p>
        ) : (
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50/80">
              <tr className="border-b border-slate-200 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-4 py-2.5 text-left">Pallet</th>
                <th className="px-4 py-2.5 text-right">Crates</th>
                <th className="px-4 py-2.5 text-right">Weight (kg)</th>
                <th className="px-4 py-2.5 text-left">Slot</th>
                <th className="px-4 py-2.5 text-left">Started</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {openPallets.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5 font-medium text-slate-800">{p.pallet_no}</td>
                  <td className="px-4 py-2.5 text-right tabnum">{num(p.crate_count)}</td>
                  <td className="px-4 py-2.5 text-right tabnum">{kg(p.total_weight_kg)}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-500">{p.slot_code ?? "—"}</td>
                  <td className="px-4 py-2.5 text-slate-500">{dateTimeStr(p.built_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
