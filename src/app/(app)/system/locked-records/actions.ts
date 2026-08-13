"use server";

import { revalidatePath } from "next/cache";
import { q } from "@/lib/db";
import { requirePermission, logActivity } from "@/lib/auth";

export async function createLock(formData: FormData) {
  const user = await requirePermission("sys.locks.manage");

  const entity = String(formData.get("entity") ?? "").trim();
  const periodFrom = String(formData.get("periodFrom") ?? "");
  const periodTo = String(formData.get("periodTo") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();

  if (!entity || !periodFrom || !periodTo) return;
  if (periodTo < periodFrom) return;

  await q(
    `INSERT INTO locked_records (entity, period_from, period_to, reason, locked_by)
     VALUES ($1,$2::date,$3::date,NULLIF($4,''),$5)`,
    [entity, periodFrom, periodTo, reason, user.id]
  );

  await logActivity({
    userId: user.id,
    module: "System",
    action: "lock",
    entity: "locked_records",
    description: `Locked ${entity} for ${periodFrom} → ${periodTo}`,
  });

  revalidatePath("/system/locked-records");
}

export async function releaseLock(formData: FormData) {
  const user = await requirePermission("sys.locks.manage");
  const id = Number(formData.get("id"));
  if (!id) return;

  const rows = await q<{ entity: string }>(
    `UPDATE locked_records
        SET is_active = false, unlocked_by = $2, unlocked_at = now()
      WHERE id = $1 AND is_active
      RETURNING entity`,
    [id, user.id]
  );

  if (rows[0]) {
    await logActivity({
      userId: user.id,
      module: "System",
      action: "unlock",
      entity: "locked_records",
      entityId: id,
      description: `Unlocked ${rows[0].entity}`,
    });
  }

  revalidatePath("/system/locked-records");
}
