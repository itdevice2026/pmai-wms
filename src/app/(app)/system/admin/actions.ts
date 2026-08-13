"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { q1 } from "@/lib/db";
import { requirePermission, hashPassword, logActivity } from "@/lib/auth";

const Schema = z.object({
  fullName: z.string().trim().min(2),
  email: z.string().trim().email(),
  employeeNo: z.string().trim().optional(),
  department: z.string().trim().optional(),
  roleId: z.coerce.number().int().positive(),
  password: z.string().optional(),
});

export async function createUser(formData: FormData): Promise<{
  ok: boolean;
  error?: string;
  email?: string;
  password?: string;
}> {
  const me = await requirePermission("sys.users.manage");

  const parsed = Schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the entered values." };
  }
  const d = parsed.data;
  const email = d.email.toLowerCase();

  const existing = await q1("SELECT id FROM users WHERE lower(email)=$1", [email]);
  if (existing) return { ok: false, error: `${email} already has an account.` };

  const password = d.password?.trim() || randomBytes(9).toString("base64url");
  const hash = await hashPassword(password);
  const plant = await q1<{ id: number }>("SELECT id FROM plants ORDER BY id LIMIT 1");

  const row = await q1<{ id: string; email: string }>(
    `INSERT INTO users (employee_no, email, password_hash, full_name, role_id, department, plant_id)
     VALUES (NULLIF($1,''), $2, $3, $4, $5, NULLIF($6,''), $7)
     RETURNING id, email`,
    [
      d.employeeNo ?? "",
      email,
      hash,
      d.fullName,
      d.roleId,
      d.department ?? "",
      plant?.id ?? null,
    ]
  );

  await logActivity({
    userId: me.id,
    module: "System",
    action: "create",
    entity: "users",
    entityId: row!.id,
    description: `Created user ${email}`,
  });

  revalidatePath("/system/admin");
  return { ok: true, email: row!.email, password };
}
