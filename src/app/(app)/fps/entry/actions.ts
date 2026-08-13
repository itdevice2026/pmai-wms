"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { q1, nextDocNo } from "@/lib/db";
import { requirePermission, logActivity } from "@/lib/auth";

export async function createFpsRun(formData: FormData): Promise<void> {
  const user = await requirePermission("fps.entry.manage");

  const productId = formData.get("productId") ? Number(formData.get("productId")) : null;
  const stationId = formData.get("stationId") ? Number(formData.get("stationId")) : null;
  const processDate = String(formData.get("processDate") ?? "");
  const targetQty = formData.get("targetQtyKg") ? Number(formData.get("targetQtyKg")) : null;

  if (!processDate) redirect("/fps/entry?error=Choose+a+process+date");

  const plant = await q1<{ id: number }>("SELECT id FROM plants ORDER BY id LIMIT 1");
  const joNo = await nextDocNo("JO");
  const fpsNo = await nextDocNo("FPS");

  const jo = await q1<{ id: number }>(
    `INSERT INTO job_orders (jo_no, plant_id, product_id, target_qty_kg, scheduled_date,
                             status, created_by)
     VALUES ($1,$2,$3,$4,$5::date,'approved',$6) RETURNING id`,
    [joNo, plant!.id, productId, targetQty, processDate, user.id]
  );

  const run = await q1<{ id: number }>(
    `INSERT INTO fps_processings (fps_no, job_order_id, plant_id, station_id, process_date,
                                  started_at, status, operator_id)
     VALUES ($1,$2,$3,$4,$5::date, now(), 'in_progress', $6) RETURNING id`,
    [fpsNo, jo!.id, plant!.id, stationId, processDate, user.id]
  );

  await logActivity({
    userId: user.id, module: "Further Processing", action: "create", entity: "fps_processings",
    entityId: run!.id, description: `Opened FPS run ${fpsNo} under ${joNo}`,
  });

  revalidatePath("/fps/entry");
  redirect(`/fps/entry?saved=${encodeURIComponent(fpsNo)}`);
}
