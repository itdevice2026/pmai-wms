"use server";

import { revalidatePath } from "next/cache";
import { q1 } from "@/lib/db";
import { requireUser, hashPassword, verifyPassword, logActivity } from "@/lib/auth";

export type ChangeResult = { ok: boolean; error?: string; message?: string };

/** Minimum bar for a plant-floor system: length over exotic character rules. */
function weakness(pw: string): string | null {
  if (pw.length < 10) return "Use at least 10 characters.";
  if (!/[a-zA-Z]/.test(pw)) return "Include at least one letter.";
  if (!/[0-9]/.test(pw)) return "Include at least one number.";
  if (/^(.)\1+$/.test(pw)) return "That password is a single repeated character.";
  const common = ["password", "12345678", "qwerty", "letmein", "admin123", "pmai"];
  if (common.some((c) => pw.toLowerCase().includes(c))) {
    return "That password contains a commonly guessed word.";
  }
  return null;
}

export async function changePassword(
  _prev: ChangeResult | undefined,
  formData: FormData
): Promise<ChangeResult> {
  const user = await requireUser();

  const current = String(formData.get("current") ?? "");
  const next = String(formData.get("next") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (!current || !next) return { ok: false, error: "Fill in every field." };
  if (next !== confirm) return { ok: false, error: "The new passwords do not match." };
  if (next === current) return { ok: false, error: "The new password must differ from the old one." };

  const weak = weakness(next);
  if (weak) return { ok: false, error: weak };

  const row = await q1<{ password_hash: string }>(
    "SELECT password_hash FROM users WHERE id = $1",
    [user.id]
  );
  if (!row || !(await verifyPassword(current, row.password_hash))) {
    return { ok: false, error: "Your current password is not correct." };
  }

  await q1("UPDATE users SET password_hash = $2 WHERE id = $1 RETURNING id", [
    user.id,
    await hashPassword(next),
  ]);

  await logActivity({
    userId: user.id,
    module: "System",
    action: "password_change",
    entity: "users",
    entityId: user.id,
    description: "Changed own password",
  });

  revalidatePath("/system/account");
  return { ok: true, message: "Password changed. Use it the next time you sign in." };
}
