"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { q1, nextDocNo } from "@/lib/db";
import { requirePermission, logActivity } from "@/lib/auth";

export async function recordByproduct(formData: FormData): Promise<void> {
  const user = await requirePermission("bd.byproducts.manage");

  const productId = Number(formData.get("productId"));
  const productionDate = String(formData.get("productionDate") ?? "");
  const quantity = Number(formData.get("quantity"));
  const batchNo = String(formData.get("batchNo") ?? "").trim();
  const remarks = String(formData.get("remarks") ?? "").trim();

  if (!productId || !productionDate) redirect("/bd/byproducts?error=Choose+a+product+and+date");
  if (!(quantity > 0)) redirect("/bd/byproducts?error=Quantity+must+be+greater+than+zero");

  const locked = await q1<{ locked: boolean }>(
    "SELECT is_locked('crates', NULL, $1::date) AS locked",
    [productionDate]
  );
  if (locked?.locked) redirect(`/bd/byproducts?error=${encodeURIComponent(productionDate + " is locked")}`);

  const plant = await q1<{ id: number }>("SELECT id FROM plants ORDER BY id LIMIT 1");
  const entryNo = await nextDocNo("BYP");

  const row = await q1<{ id: string }>(
    `INSERT INTO byproduct_entries
       (entry_no, plant_id, product_id, batch_no, production_date, quantity, recorded_by, remarks)
     VALUES ($1,$2,$3,NULLIF($4,''),$5::date,$6,$7,NULLIF($8,''))
     RETURNING id`,
    [entryNo, plant!.id, productId, batchNo, productionDate, quantity, user.id, remarks]
  );

  await logActivity({
    userId: user.id, module: "Basic Dressing", action: "create", entity: "byproduct_entries",
    entityId: row!.id, description: `Recorded ${quantity} kg byproduct as ${entryNo}`,
  });

  revalidatePath("/bd/byproducts");
  redirect(`/bd/byproducts?saved=${encodeURIComponent(entryNo)}`);
}
