import { cookies, headers } from "next/headers";
import { forbidden, redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { q, q1 } from "./db";

const DEV_SECRET = "dev-only-secret-change-me-in-production-0000000000";

/**
 * A predictable signing key means anyone can forge a session cookie, so refuse
 * to serve production traffic without a real one. Resolved per request rather
 * than at module load, because `next build` also runs with
 * NODE_ENV=production and must not require runtime secrets.
 */
function secret(): Uint8Array {
  const s = process.env.AUTH_SECRET;
  if (!s) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "AUTH_SECRET is not set. Generate one with `openssl rand -base64 32` and set it in the environment."
      );
    }
    return new TextEncoder().encode(DEV_SECRET);
  }
  return new TextEncoder().encode(s);
}
const COOKIE = "wms_session";
const MAX_AGE = 60 * 60 * 12; // 12 hours

export type SessionUser = {
  id: string;
  email: string;
  fullName: string;
  employeeNo: string | null;
  roleCode: string;
  roleName: string;
  department: string | null;
  plantId: number | null;
  permissions: string[];
  /**
   * Live PMAI shows `full access` on IT accounts as a state distinct from any
   * role, alongside a per-user OVERRIDES count. See System > RBAC.
   */
  hasFullAccess: boolean;
};

export async function hashPassword(plain: string) {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain: string, hash: string) {
  return bcrypt.compare(plain, hash);
}

export async function createSession(userId: string) {
  const token = await new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(secret());

  const store = await cookies();
  store.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function destroySession() {
  const store = await cookies();
  store.delete(COOKIE);
}

async function userIdFromCookie(): Promise<string | null> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (!token) return null;
  // Resolve the key outside the try: a missing AUTH_SECRET is a deployment
  // fault and must surface, not be swallowed as "not signed in".
  const key = secret();
  try {
    const { payload } = await jwtVerify(token, key);
    return (payload.sub as string) ?? null;
  } catch {
    return null; // expired or tampered token
  }
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const id = await userIdFromCookie();
  if (!id) return null;

  const row = await q1<{
    id: string;
    email: string;
    full_name: string;
    employee_no: string | null;
    department: string | null;
    plant_id: number | null;
    role_code: string | null;
    role_name: string | null;
    has_full_access: boolean;
  }>(
    `SELECT u.id, u.email, u.full_name, u.employee_no, u.department, u.plant_id,
            u.has_full_access,
            r.code AS role_code, r.name AS role_name
       FROM users u LEFT JOIN roles r ON r.id = u.role_id
      WHERE u.id = $1 AND u.is_active`,
    [id]
  );
  if (!row) return null;

  /**
   * Effective permissions = role grants UNION per-user grants, MINUS per-user
   * denies. Live PMAI layers overrides on top of the role — the OVERRIDES
   * column on /rbac is a count of these rows, and most warehouse operators
   * carry 11 of them. A deny always beats a grant from either source.
   */
  const perms = await q<{ code: string }>(
    `SELECT p.code
       FROM permissions p
      WHERE p.id IN (
              SELECT rp.permission_id
                FROM users u
                JOIN role_permissions rp ON rp.role_id = u.role_id
               WHERE u.id = $1
              UNION
              SELECT o.permission_id
                FROM user_permission_overrides o
               WHERE o.user_id = $1 AND o.effect = 'grant'
            )
        AND p.id NOT IN (
              SELECT o.permission_id
                FROM user_permission_overrides o
               WHERE o.user_id = $1 AND o.effect = 'deny'
            )`,
    [id]
  );

  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    employeeNo: row.employee_no,
    roleCode: row.role_code ?? "viewer",
    roleName: row.role_name ?? "Viewer",
    department: row.department,
    plantId: row.plant_id,
    permissions: perms.map((p) => p.code),
    hasFullAccess: row.has_full_access,
  };
}

/**
 * Use at the top of every protected page/action. Redirects rather than
 * throwing, so an expired session lands the user on the sign-in page instead
 * of a 500.
 */
export async function requireUser(): Promise<SessionUser> {
  const u = await getSessionUser();
  if (!u) redirect("/login");
  return u;
}

export function can(user: SessionUser | null, permission: string): boolean {
  if (!user) return false;
  // `full access` is the live IT state and outranks everything, including denies.
  if (user.hasFullAccess) return true;
  if (user.roleCode === "admin" || user.roleCode === "it") return true;
  // Denies have already been subtracted when the list was built.
  return user.permissions.includes(permission);
}

export async function requirePermission(permission: string): Promise<SessionUser> {
  const u = await requireUser();
  if (!can(u, permission)) forbidden();
  return u;
}

export async function logActivity(opts: {
  userId?: string | null;
  module: string;
  action: string;
  entity?: string;
  entityId?: string | number;
  description?: string;
  before?: unknown;
  after?: unknown;
}) {
  let ip: string | null = null;
  let ua: string | null = null;
  try {
    const h = await headers();
    ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    ua = h.get("user-agent");
  } catch {
    /* headers unavailable outside a request */
  }
  await q(
    `INSERT INTO activity_logs
       (user_id, module, action, entity, entity_id, description, before_data, after_data, ip_address, user_agent)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      opts.userId ?? null,
      opts.module,
      opts.action,
      opts.entity ?? null,
      opts.entityId != null ? String(opts.entityId) : null,
      opts.description ?? null,
      opts.before ? JSON.stringify(opts.before) : null,
      opts.after ? JSON.stringify(opts.after) : null,
      ip,
      ua,
    ]
  );
}
