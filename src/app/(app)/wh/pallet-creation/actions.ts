"use server";

import { revalidatePath } from "next/cache";
import { q1, tx, nextDocNo } from "@/lib/db";
import { requirePermission, logActivity } from "@/lib/auth";
import { moveCrate, type MoveResult } from "@/lib/crate-flow";

export async function openPallet(): Promise<{
  ok: boolean;
  palletId?: string;
  palletNo?: string;
  error?: string;
}> {
  const user = await requirePermission("wh.pallet.manage");
  const plant = await q1<{ id: number }>("SELECT id FROM plants ORDER BY id LIMIT 1");
  if (!plant) return { ok: false, error: "No plant configured." };

  const palletNo = await nextDocNo("PLT");
  const row = await q1<{ id: string }>(
    `INSERT INTO pallets (pallet_no, plant_id, kind, status, built_by)
     VALUES ($1,$2,'bd','open',$3) RETURNING id`,
    [palletNo, plant.id, user.id]
  );

  await logActivity({
    userId: user.id,
    module: "Warehouse",
    action: "create",
    entity: "pallets",
    description: `Opened pallet ${palletNo}`,
  });

  revalidatePath("/wh/pallet-creation");
  return { ok: true, palletId: row!.id, palletNo };
}

export async function addCrateToPallet(code: string, palletId: string): Promise<MoveResult> {
  const user = await requirePermission("wh.pallet.manage");
  if (!palletId) return { ok: false, message: "No pallet selected." };

  const pallet = await q1<{ pallet_no: string; status: string; location_id: number | null }>(
    "SELECT pallet_no, status, location_id FROM pallets WHERE id=$1",
    [palletId]
  );
  if (!pallet) return { ok: false, message: "Pallet not found." };
  if (pallet.status !== "open") {
    return { ok: false, message: `Pallet ${pallet.pallet_no} is ${pallet.status}, not open.` };
  }

  // Crates join a pallet while still in 'warehouse'; putaway to 'storage'
  // happens when the pallet is closed into a slot.
  const crate = await q1<{ id: string; crate_no: string; status: string; pallet_id: string | null; sku: string; net_weight_kg: string }>(
    `SELECT c.id, c.crate_no, c.status::text AS status, c.pallet_id, p.sku, c.net_weight_kg
       FROM crates c JOIN products p ON p.id = c.product_id
      WHERE c.crate_no = $1 AND NOT c.is_voided`,
    [code.trim()]
  );
  if (!crate) return { ok: false, message: `Unknown crate ${code}` };
  if (crate.status !== "warehouse") {
    return {
      ok: false,
      message: `Crate is ${crate.status.replace(/_/g, " ")} — receive it at the scan station first`,
      crateNo: crate.crate_no,
      sku: crate.sku,
    };
  }
  if (crate.pallet_id && String(crate.pallet_id) === String(palletId)) {
    return { ok: false, message: "Already on this pallet", crateNo: crate.crate_no, sku: crate.sku };
  }

  await tx(async (client) => {
    await client.query("UPDATE crates SET pallet_id=$2 WHERE id=$1", [crate.id, palletId]);
    await client.query(
      `INSERT INTO crate_movements (crate_id, kind, from_status, to_status, to_pallet_id,
                                    weight_kg, user_id, ref_table, ref_no)
       VALUES ($1,'bd_pallet_create',$2::crate_status,$2::crate_status,$3,$4,$5,'pallets',$6)`,
      [crate.id, crate.status, palletId, crate.net_weight_kg, user.id, pallet.pallet_no]
    );
  });

  revalidatePath("/wh/pallet-creation");
  return {
    ok: true,
    message: `Added to ${pallet.pallet_no}`,
    crateNo: crate.crate_no,
    sku: crate.sku,
    weightKg: Number(crate.net_weight_kg),
  };
}

export async function closeAndPutaway(formData: FormData): Promise<{
  ok: boolean;
  palletNo?: string;
  slotCode?: string;
  error?: string;
}> {
  const user = await requirePermission("wh.pallet.manage");

  const palletId = String(formData.get("palletId") ?? "");
  const slotId = Number(formData.get("slotId"));
  if (!palletId || !slotId) return { ok: false, error: "Choose a pallet and a slot." };

  const pallet = await q1<{ pallet_no: string; crate_count: number }>(
    "SELECT pallet_no, crate_count FROM pallets WHERE id=$1",
    [palletId]
  );
  if (!pallet) return { ok: false, error: "Pallet not found." };
  if (pallet.crate_count === 0) return { ok: false, error: "Pallet is empty." };

  const slot = await q1<{ code: string; taken: boolean }>(
    `SELECT l.code,
            EXISTS (SELECT 1 FROM pallets p
                     WHERE p.location_id = l.id AND p.status <> 'dispatched'
                       AND p.id <> $2) AS taken
       FROM locations l WHERE l.id = $1 AND l.is_slot AND l.is_active`,
    [slotId, palletId]
  );
  if (!slot) return { ok: false, error: "Slot not found." };
  if (slot.taken) return { ok: false, error: `Slot ${slot.code} is already occupied.` };

  const crates = await tx(async (client) => {
    await client.query(
      `UPDATE pallets SET status='stored', location_id=$2, closed_at=now() WHERE id=$1`,
      [palletId, slotId]
    );
    const res = await client.query<{ crate_no: string }>(
      "SELECT crate_no FROM crates WHERE pallet_id=$1 AND NOT is_voided",
      [palletId]
    );
    return res.rows.map((r) => r.crate_no);
  });

  // Move each crate through the shared flow so the ledger and locks apply.
  for (const crateNo of crates) {
    await moveCrate({
      crateCode: crateNo,
      toStatus: "storage",
      user,
      toLocationId: slotId,
      refTable: "pallets",
      refNo: pallet.pallet_no,
      module: "Warehouse",
    });
  }

  await logActivity({
    userId: user.id,
    module: "Warehouse",
    action: "putaway",
    entity: "pallets",
    description: `Put away ${pallet.pallet_no} (${crates.length} crates) into ${slot.code}`,
  });

  revalidatePath("/wh/pallet-creation");
  revalidatePath("/wh/storage-map");
  return { ok: true, palletNo: pallet.pallet_no, slotCode: slot.code };
}
