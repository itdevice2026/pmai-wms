"use server";

import { redirect } from "next/navigation";
import { q1 } from "@/lib/db";
import {
  createSession,
  destroySession,
  getSessionUser,
  logActivity,
  verifyPassword,
} from "@/lib/auth";
import {
  clientIp,
  humanWait,
  loginRetryAfter,
  recordLoginAttempt,
} from "@/lib/rate-limit";

export async function loginAction(
  _prev: { error?: string } | undefined,
  formData: FormData
): Promise<{ error?: string }> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) return { error: "Enter your email and password." };

  const ip = await clientIp();

  // Throttle before touching the password hash, so a locked-out attacker
  // cannot use bcrypt timing as an oracle either.
  const wait = await loginRetryAfter(email, ip);
  if (wait > 0) {
    return {
      error: `Too many failed attempts. Try again in ${humanWait(wait)}.`,
    };
  }

  const user = await q1<{ id: string; password_hash: string; is_active: boolean }>(
    "SELECT id, password_hash, is_active FROM users WHERE lower(email) = $1",
    [email]
  );

  const ok = Boolean(
    user && user.is_active && (await verifyPassword(password, user.password_hash))
  );

  await recordLoginAttempt(email, ip, ok);

  if (!ok) {
    // Deliberately identical for unknown email, wrong password and disabled
    // account — do not reveal which accounts exist.
    return { error: "Invalid email or password." };
  }

  await createSession(user!.id);
  await q1("UPDATE users SET last_login_at = now() WHERE id = $1 RETURNING id", [user!.id]);
  await logActivity({
    userId: user!.id,
    module: "System",
    action: "login",
    description: "Signed in",
  });

  redirect("/dashboard");
}

export async function logoutAction() {
  const u = await getSessionUser();
  if (u) {
    await logActivity({
      userId: u.id,
      module: "System",
      action: "logout",
      description: "Signed out",
    });
  }
  await destroySession();
  redirect("/login");
}
