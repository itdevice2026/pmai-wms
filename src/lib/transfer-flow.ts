import { q, q1, tx, nextDocNo } from "./db";
import { requirePermission, logActivity } from "./auth";
import { moveCrate, type MoveResult } from "./crate-flow";

/**
 * The three transfer screens (Location / Pallet / Stock) differ only in what
 * unit moves and which statuses are legal, so they share one implementation.
 */
export type TransferKind = "location" | "pallet" | "stock";

export const TRANSFER_CONFIG: Record<
  TransferKind,
  { title: string; subtitle: string; unit: "crate" | "pallet"; expectFrom: string[] }
> = {
  location: {
    title: "Location Transfer",
    subtitle: "Move individual crates from one slot to another.",
    unit: "crate",
    expectFrom: ["warehouse", "storage", "wh_received_cut", "fps_processed"],
  },
  pallet: {
    title: "Pallet Transfer",
    subtitle: "Move a whole pallet — every crate on it goes with it.",
    unit: "pallet",
    expectFrom: ["warehouse", "storage", "wh_received_cut", "fps_processed"],
  },
  stock: {
    title: "Stock Transfer",
    subtitle: "Move stock between storage rooms, recorded as a transfer document.",
    unit: "crate",
    expectFrom: ["warehouse", "storage", "wh_received_cut", "fps_processed"],
  },
};

/** Move one crate into a slot, opening a transfer document on first scan. */
export async function transferCrate(
  kind: TransferKind,
  code: string,
  toSlotId: number
): Promise<MoveResult> {
  const user = await requirePermission("wh.transfer.manage");
  const cfg = TRANSFER_CONFIG[kind];

  if (!toSlotId) return { ok: false, message: "Choose a destination slot first." };

  const slot = await q1<{ code: string; room_available: boolean; taken: boolean }>(
    `SELECT l.code, sr.is_available AS room_available,
            EXISTS (SELECT 1 FROM pallets p
                     WHERE p.location_id = l.id AND p.status <> 'dispatched') AS taken
       FROM locations l
       LEFT JOIN storage_rooms sr ON sr.id = l.storage_room_id
      WHERE l.id = $1 AND l.is_active`,
    [toSlotId]
  );
  if (!slot) return { ok: false, message: "Destination slot not found." };
  if (slot.room_available === false) {
    return { ok: false, message: `Room is OFF — ${slot.code} cannot accept pallets.` };
  }

  return moveCrate({
    crateCode: code,
    toStatus: "storage",
    user,
    toLocationId: toSlotId,
    module: "Warehouse",
    expectFrom: cfg.expectFrom,
    refTable: "transfers",
    refNo: `${kind} transfer`,
  });
}

/** Move an entire pallet, and every crate on it, into a slot. */
export async function transferPallet(
  palletNo: string,
  toSlotId: number
): Promise<MoveResult> {
  const user = await requirePermission("wh.transfer.manage");
  if (!toSlotId) return { ok: false, message: "Choose a destination slot first." };

  const pallet = await q1<{
    id: string; pallet_no: string; status: string;
    crate_count: number; total_weight_kg: string; location_id: number | null;
  }>(
    "SELECT id, pallet_no, status, crate_count, total_weight_kg, location_id FROM pallets WHERE pallet_no=$1",
    [palletNo.trim()]
  );
  if (!pallet) return { ok: false, message: `Unknown pallet ${palletNo}` };
  if (pallet.status === "dispatched") {
    return { ok: false, message: `${pallet.pallet_no} has already been dispatched.` };
  }
  if (pallet.location_id === toSlotId) {
    return { ok: false, message: "Pallet is already in that slot.", crateNo: pallet.pallet_no };
  }

  const slot = await q1<{ code: string; taken: boolean; room_available: boolean }>(
    `SELECT l.code, sr.is_available AS room_available,
            EXISTS (SELECT 1 FROM pallets p
                     WHERE p.location_id = l.id AND p.status <> 'dispatched'
                       AND p.id <> $2) AS taken
       FROM locations l
       LEFT JOIN storage_rooms sr ON sr.id = l.storage_room_id
      WHERE l.id = $1 AND l.is_slot AND l.is_active`,
    [toSlotId, pallet.id]
  );
  if (!slot) return { ok: false, message: "Destination slot not found." };
  if (slot.taken) return { ok: false, message: `Slot ${slot.code} is already occupied.` };
  if (slot.room_available === false) {
    return { ok: false, message: `Room is OFF — ${slot.code} cannot accept pallets.` };
  }

  const crates = await q<{ crate_no: string }>(
    "SELECT crate_no FROM crates WHERE pallet_id=$1 AND NOT is_voided",
    [pallet.id]
  );

  await q("UPDATE pallets SET location_id=$2 WHERE id=$1", [pallet.id, toSlotId]);

  let moved = 0;
  for (const c of crates) {
    const r = await moveCrate({
      crateCode: c.crate_no,
      toStatus: "storage",
      user,
      toLocationId: toSlotId,
      module: "Warehouse",
      refTable: "pallets",
      refNo: pallet.pallet_no,
    });
    if (r.ok) moved++;
  }

  await logActivity({
    userId: user.id,
    module: "Warehouse",
    action: "transfer",
    entity: "pallets",
    description: `Moved pallet ${pallet.pallet_no} (${moved} crates) to ${slot.code}`,
  });

  return {
    ok: true,
    message: `Moved ${moved}/${crates.length} crates to ${slot.code}`,
    crateNo: pallet.pallet_no,
    weightKg: Number(pallet.total_weight_kg),
  };
}

/** Create a transfer document header so movements can be reported on. */
export async function openTransfer(kind: TransferKind, fromId: number | null, toId: number | null) {
  const user = await requirePermission("wh.transfer.manage");
  const plant = await q1<{ id: number }>("SELECT id FROM plants ORDER BY id LIMIT 1");
  const no = await nextDocNo("TRF");

  const row = await q1<{ id: number }>(
    `INSERT INTO transfers (transfer_no, kind, plant_id, from_location_id, to_location_id,
                            status, requested_by)
     VALUES ($1,$2,$3,$4,$5,'in_progress',$6) RETURNING id`,
    [no, kind, plant!.id, fromId, toId, user.id]
  );

  await logActivity({
    userId: user.id,
    module: "Warehouse",
    action: "create",
    entity: "transfers",
    entityId: row!.id,
    description: `Opened ${kind} transfer ${no}`,
  });

  return { id: row!.id, transferNo: no };
}
