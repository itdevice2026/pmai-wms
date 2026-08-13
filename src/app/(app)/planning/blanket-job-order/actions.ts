"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { q1, nextDocNo } from "@/lib/db";
import { requirePermission, logActivity } from "@/lib/auth";

export async function createBjo(formData: FormData): Promise<void> {
  const user = await requirePermission("plan.bjo.manage");

  const customerId = Number(formData.get("customerId"));
  const productId = formData.get("productId") ? Number(formData.get("productId")) : null;
  const validFrom = String(formData.get("validFrom") ?? "");
  const validTo = String(formData.get("validTo") ?? "");
  const totalQty = Number(formData.get("totalQtyKg"));

  if (!customerId || !validFrom || !validTo) {
    redirect("/planning/blanket-job-order?error=Customer+and+validity+dates+are+required");
  }
  if (validTo < validFrom) {
    redirect("/planning/blanket-job-order?error=End+date+cannot+be+before+start+date");
  }
  if (!(totalQty > 0)) {
    redirect("/planning/blanket-job-order?error=Total+quantity+must+be+greater+than+zero");
  }

  const plant = await q1<{ id: number }>("SELECT id FROM plants ORDER BY id LIMIT 1");
  const bjoNo = await nextDocNo("BJO");

  const row = await q1<{ id: number }>(
    `INSERT INTO blanket_job_orders (bjo_no, plant_id, customer_id, product_id,
                                     valid_from, valid_to, total_qty_kg, status, created_by)
     VALUES ($1,$2,$3,$4,$5::date,$6::date,$7,'approved',$8) RETURNING id`,
    [bjoNo, plant!.id, customerId, productId, validFrom, validTo, totalQty, user.id]
  );

  await logActivity({
    userId: user.id, module: "Planning", action: "create", entity: "blanket_job_orders",
    entityId: row!.id, description: `Created blanket job order ${bjoNo} for ${totalQty} kg`,
  });

  revalidatePath("/planning/blanket-job-order");
  redirect(`/planning/blanket-job-order?saved=${encodeURIComponent(bjoNo)}`);
}
