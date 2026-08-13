"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { q1, nextDocNo } from "@/lib/db";
import { requirePermission, logActivity } from "@/lib/auth";

export async function planDisposition(formData: FormData): Promise<void> {
  const user = await requirePermission("plan.disposition.manage");

  const palletId = formData.get("palletId") ? Number(formData.get("palletId")) : null;
  const disposition = String(formData.get("disposition") ?? "").trim();
  const customerId = formData.get("targetCustomerId") ? Number(formData.get("targetCustomerId")) : null;
  const planDate = String(formData.get("planDate") ?? "");
  const remarks = String(formData.get("remarks") ?? "").trim();

  const valid = ["dispatch", "cutting", "fps", "hold", "rework", "disposal"];
  if (!palletId || !valid.includes(disposition)) {
    redirect("/planning/pallet-disposition?error=Choose+a+pallet+and+a+disposition");
  }

  const plant = await q1<{ id: number }>("SELECT id FROM plants ORDER BY id LIMIT 1");
  const no = await nextDocNo("PDS");

  const row = await q1<{ id: number }>(
    `INSERT INTO pallet_dispositions (disposition_no, plant_id, pallet_id, plan_date,
                                      disposition, target_customer_id, status, planned_by, remarks)
     VALUES ($1,$2,$3, COALESCE(NULLIF($4,'')::date, current_date), $5,$6,'pending',$7,NULLIF($8,''))
     RETURNING id`,
    [no, plant!.id, palletId, planDate, disposition, customerId, user.id, remarks]
  );

  await logActivity({
    userId: user.id, module: "Planning", action: "create", entity: "pallet_dispositions",
    entityId: row!.id, description: `Planned ${disposition} for pallet ${palletId} as ${no}`,
  });

  revalidatePath("/planning/pallet-disposition");
  redirect(`/planning/pallet-disposition?saved=${encodeURIComponent(no)}`);
}
