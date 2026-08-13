import { headers } from "next/headers";
import { q, q1 } from "./db";

/** Best-effort client address, honouring the proxy headers Vercel sets. */
export async function clientIp(): Promise<string | null> {
  try {
    const h = await headers();
    return (
      h.get("x-real-ip") ??
      h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      null
    );
  } catch {
    return null;
  }
}

/**
 * How long the caller must wait before another login attempt, in seconds.
 * 0 means they may proceed.
 */
export async function loginRetryAfter(email: string, ip: string | null): Promise<number> {
  const row = await q1<{ secs: number }>(
    "SELECT login_retry_after($1, $2) AS secs",
    [email, ip]
  );
  return row?.secs ?? 0;
}

export async function recordLoginAttempt(
  email: string,
  ip: string | null,
  ok: boolean
): Promise<void> {
  await q("SELECT record_login_attempt($1, $2, $3)", [email, ip, ok]);
}

/** "90 seconds" / "2 minutes" — for a message a warehouse operator will read. */
export function humanWait(seconds: number): string {
  if (seconds < 60) return `${seconds} second${seconds === 1 ? "" : "s"}`;
  const mins = Math.ceil(seconds / 60);
  return `${mins} minute${mins === 1 ? "" : "s"}`;
}
