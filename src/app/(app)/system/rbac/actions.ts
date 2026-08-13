"use server";

import { revalidatePath } from "next/cache";
import { q, q1 } from "@/lib/db";
import { requirePermission, logActivity } from "@/lib/auth";

export async function togglePermission(formData: FormData) {
  const user = await requirePermission("sys.rbac.manage");

  const roleId = Number(formData.get("roleId"));
  const permissionId = Number(formData.get("permissionId"));
  const next = String(formData.get("next"));
  if (!roleId || !permissionId) return;

  const role = await q1<{ code: string; name: string }>("SELECT code, name FROM roles WHERE id=$1", [
    roleId,
  ]);
  // The admin role is implicitly all-powerful in can(); never let the grid
  // create the illusion that permissions can be revoked from it.
  if (!role || role.code === "admin") return;

  const perm = await q1<{ code: string }>("SELECT code FROM permissions WHERE id=$1", [permissionId]);
  if (!perm) return;

  if (next === "on") {
    await q(
      `INSERT INTO role_permissions (role_id, permission_id) VALUES ($1,$2)
       ON CONFLICT DO NOTHING`,
      [roleId, permissionId]
    );
  } else {
    await q("DELETE FROM role_permissions WHERE role_id=$1 AND permission_id=$2", [
      roleId,
      permissionId,
    ]);
  }

  await logActivity({
    userId: user.id,
    module: "System",
    action: next === "on" ? "grant" : "revoke",
    entity: "role_permissions",
    description: `${next === "on" ? "Granted" : "Revoked"} ${perm.code} for ${role.name}`,
  });

  revalidatePath("/system/rbac");
}
