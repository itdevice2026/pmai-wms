"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { q1, nextDocNo } from "@/lib/db";
import { requirePermission, logActivity } from "@/lib/auth";

const Schema = z.object({
  growerId: z.coerce.number().int().positive(),
  receiptDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  batchNo: z.string().trim().optional(),
  plateNo: z.string().trim().optional(),
  driverName: z.string().trim().optional(),
  headsLoaded: z.coerce.number().int().min(0).default(0),
  headsReceived: z.coerce.number().int().min(0),
  headsDoa: z.coerce.number().int().min(0).default(0),
  headsCondemned: z.coerce.number().int().min(0).default(0),
  grossWeightKg: z.coerce.number().min(0),
  tareWeightKg: z.coerce.number().min(0).default(0),
  remarks: z.string().trim().optional(),
});

export async function createReceipt(
  formData: FormData
): Promise<{ ok: boolean; receiptNo?: string; error?: string }> {
  const user = await requirePermission("bd.live_bird.manage");

  const parsed = Schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the entered values." };
  }
  const d = parsed.data;

  if (d.headsDoa > d.headsReceived) {
    return { ok: false, error: "DOA cannot exceed heads received." };
  }
  if (d.tareWeightKg > d.grossWeightKg) {
    return { ok: false, error: "Tare weight cannot exceed gross weight." };
  }

  const locked = await q1<{ locked: boolean }>(
    "SELECT is_locked('live_bird_receipts', NULL, $1::date) AS locked",
    [d.receiptDate]
  );
  if (locked?.locked) {
    return { ok: false, error: `${d.receiptDate} is locked — no new receipts can be posted.` };
  }

  const plant = await q1<{ id: number }>("SELECT id FROM plants ORDER BY id LIMIT 1");
  if (!plant) return { ok: false, error: "No plant configured." };

  const net = d.grossWeightKg - d.tareWeightKg;
  const liveHeads = d.headsReceived - d.headsDoa;
  const ave = liveHeads > 0 ? net / liveHeads : null;

  const receiptNo = await nextDocNo("LBR");

  const row = await q1<{ id: number }>(
    `INSERT INTO live_bird_receipts
       (receipt_no, plant_id, grower_id, receipt_date, batch_no, plate_no, driver_name,
        heads_loaded, heads_received, heads_doa, heads_condemned,
        gross_weight_kg, tare_weight_kg, ave_weight_kg, status, received_by, remarks)
     VALUES ($1,$2,$3,$4::date,NULLIF($5,''),NULLIF($6,''),NULLIF($7,''),
             $8,$9,$10,$11,$12,$13,$14,'completed',$15,NULLIF($16,''))
     RETURNING id`,
    [
      receiptNo, plant.id, d.growerId, d.receiptDate,
      d.batchNo ?? "", d.plateNo ?? "", d.driverName ?? "",
      d.headsLoaded, d.headsReceived, d.headsDoa, d.headsCondemned,
      d.grossWeightKg, d.tareWeightKg, ave, user.id, d.remarks ?? "",
    ]
  );

  await logActivity({
    userId: user.id,
    module: "Basic Dressing",
    action: "create",
    entity: "live_bird_receipts",
    entityId: row!.id,
    description: `Received ${d.headsReceived} heads (${net.toFixed(2)} kg) as ${receiptNo}`,
  });

  revalidatePath("/bd/live-bird-receiving");
  return { ok: true, receiptNo };
}
