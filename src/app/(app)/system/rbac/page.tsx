import { q } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { Card, Badge } from "@/components/ui";
import { togglePermission } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "RBAC · PMAI Warehouse" };

type Role = { id: number; code: string; name: string; description: string | null; user_count: number };
type Perm = { id: number; code: string; module: string; action: string; label: string };

export default async function RbacPage() {
  await requirePermission("sys.rbac.manage");

  const [roles, perms, grants] = await Promise.all([
    q<Role>(
      `SELECT r.id, r.code, r.name, r.description,
              (SELECT count(*) FROM users u WHERE u.role_id = r.id AND u.is_active)::int AS user_count
         FROM roles r ORDER BY r.id`
    ),
    q<Perm>("SELECT id, code, module, action, label FROM permissions ORDER BY module, code"),
    q<{ role_id: number; permission_id: number }>("SELECT role_id, permission_id FROM role_permissions"),
  ]);

  const granted = new Set(grants.map((g) => `${g.role_id}:${g.permission_id}`));

  const modules = new Map<string, Perm[]>();
  for (const p of perms) {
    if (!modules.has(p.module)) modules.set(p.module, []);
    modules.get(p.module)!.push(p);
  }

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          RBAC · Roles &amp; Permissions
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {perms.length} permissions across {modules.size} modules. Administrators always have full
          access; their column is shown for reference and cannot be changed.
        </p>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {roles.map((r) => (
          <div key={r.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-800">{r.name}</span>
              <Badge tone="blue">{r.user_count} users</Badge>
            </div>
            <p className="mt-1 text-xs text-slate-500">{r.description}</p>
          </div>
        ))}
      </div>

      <Card padded={false}>
        <div className="thin-scroll overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 bg-slate-50">
              <tr className="border-b border-slate-200">
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Permission
                </th>
                {roles.map((r) => (
                  <th
                    key={r.id}
                    className="px-3 py-2.5 text-center text-xs font-semibold uppercase tracking-wide text-slate-500"
                  >
                    {r.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...modules.entries()].map(([module, list]) => (
                <>
                  <tr key={module}>
                    <td
                      colSpan={roles.length + 1}
                      className="border-y border-slate-200 bg-slate-100 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-widest text-slate-500"
                    >
                      {module}
                    </td>
                  </tr>
                  {list.map((p) => (
                    <tr key={p.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-4 py-2">
                        <div className="font-medium text-slate-700">{p.label}</div>
                        <div className="font-mono text-[11px] text-slate-400">{p.code}</div>
                      </td>
                      {roles.map((r) => {
                        const isAdmin = r.code === "admin";
                        const on = isAdmin || granted.has(`${r.id}:${p.id}`);
                        return (
                          <td key={r.id} className="px-3 py-2 text-center">
                            <form action={togglePermission}>
                              <input type="hidden" name="roleId" value={r.id} />
                              <input type="hidden" name="permissionId" value={p.id} />
                              <input type="hidden" name="next" value={on ? "off" : "on"} />
                              <button
                                type="submit"
                                disabled={isAdmin}
                                title={isAdmin ? "Administrators always have every permission" : undefined}
                                className={`h-5 w-5 rounded border transition ${
                                  on
                                    ? "border-emerald-500 bg-emerald-500 text-white"
                                    : "border-slate-300 bg-white hover:border-slate-400"
                                } ${isAdmin ? "cursor-not-allowed opacity-60" : ""}`}
                              >
                                {on && (
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" className="mx-auto h-3 w-3">
                                    <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                                  </svg>
                                )}
                              </button>
                            </form>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
