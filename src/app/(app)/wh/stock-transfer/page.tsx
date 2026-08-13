import { q } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { TRANSFER_CONFIG } from "@/lib/transfer-flow";
import { TransferClient } from "@/components/TransferClient";

export const dynamic = "force-dynamic";
export const metadata = { title: `${TRANSFER_CONFIG["stock"].title} · PMAI Warehouse` };

export default async function Page() {
  await requirePermission("wh.transfer.view");
  const cfg = TRANSFER_CONFIG["stock"];

  const slots = await q<{ id: number; code: string; room: string; occupied: boolean }>(
    `SELECT l.id, l.code, sr.name AS room,
            EXISTS (SELECT 1 FROM pallets p
                     WHERE p.location_id = l.id AND p.status <> 'dispatched') AS occupied
       FROM locations l
       JOIN storage_rooms sr ON sr.id = l.storage_room_id
      WHERE l.is_slot AND l.is_active AND sr.is_available
      ORDER BY sr.sort_order, l.code
      LIMIT 600`
  );

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{cfg.title}</h1>
        <p className="mt-1 text-sm text-slate-500">{cfg.subtitle}</p>
      </div>
      <TransferClient kind="stock" unit={cfg.unit} slots={slots} />
    </>
  );
}
