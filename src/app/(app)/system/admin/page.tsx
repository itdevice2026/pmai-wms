import { q } from "@/lib/db";
import { requirePermission, can } from "@/lib/auth";
import { Card, StatCard, Badge, DataTable, type Column } from "@/components/ui";
import { dateTimeStr, num, relTime } from "@/lib/format";
import { UserForm } from "./UserForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin · PMAI Warehouse" };

type UserRow = {
  id: string;
  employee_no: string | null;
  full_name: string;
  email: string;
  department: string | null;
  role_name: string | null;
  role_code: string | null;
  is_active: boolean;
  last_login_at: string | null;
};

const DEPT_TONE: Record<string, string> = {
  Admin: "red",
  Production: "amber",
  Warehouse: "blue",
  FPS: "purple",
  QA: "teal",
};

export default async function AdminPage() {
  const me = await requirePermission("sys.users.view");
  const mayManage = can(me, "sys.users.manage");

  const [stats, users, roles, activity] = await Promise.all([
    q<{ total: string; admins: string; production: string; warehouse: string; inactive: string }>(
      `SELECT count(*) FILTER (WHERE is_active) AS total,
              count(*) FILTER (WHERE is_active AND department='Admin') AS admins,
              count(*) FILTER (WHERE is_active AND department='Production') AS production,
              count(*) FILTER (WHERE is_active AND department='Warehouse') AS warehouse,
              count(*) FILTER (WHERE NOT is_active) AS inactive
         FROM users`
    ),
    q<UserRow>(
      `SELECT u.id, u.employee_no, u.full_name, u.email, u.department,
              r.name AS role_name, r.code AS role_code, u.is_active, u.last_login_at
         FROM users u LEFT JOIN roles r ON r.id = u.role_id
        ORDER BY u.is_active DESC, u.full_name`
    ),
    q<{ id: number; code: string; name: string }>("SELECT id, code, name FROM roles ORDER BY id"),
    q<{ description: string | null; user_name: string | null; created_at: string; module: string }>(
      `SELECT a.description, u.full_name AS user_name, a.created_at, a.module
         FROM activity_logs a LEFT JOIN users u ON u.id = a.user_id
        ORDER BY a.created_at DESC LIMIT 10`
    ),
  ]);

  const s = stats[0];

  const columns: Column<UserRow>[] = [
    {
      key: "full_name",
      header: "Name",
      render: (r) => (
        <div>
          <div className="font-medium text-slate-800">{r.full_name}</div>
          <div className="text-xs text-slate-400">{r.email}</div>
        </div>
      ),
    },
    { key: "employee_no", header: "Employee No." },
    {
      key: "department",
      header: "Department",
      render: (r) =>
        r.department ? (
          <Badge tone={DEPT_TONE[r.department] ?? "slate"}>{r.department}</Badge>
        ) : (
          <span className="text-slate-300">—</span>
        ),
    },
    { key: "role_name", header: "Role", render: (r) => r.role_name ?? "—" },
    {
      key: "is_active",
      header: "Status",
      render: (r) => (
        <Badge tone={r.is_active ? "green" : "slate"}>{r.is_active ? "Active" : "Disabled"}</Badge>
      ),
    },
    {
      key: "last_login_at",
      header: "Last login",
      render: (r) => (r.last_login_at ? relTime(r.last_login_at) : "Never"),
    },
  ];

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Admin</h1>
        <p className="mt-1 text-sm text-slate-500">Users, departments and access.</p>
      </div>

      <div className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Total Users" value={num(s.total)} />
        <StatCard label="Admins" value={num(s.admins)} tone="red" />
        <StatCard label="Production" value={num(s.production)} tone="amber" />
        <StatCard label="Warehouse" value={num(s.warehouse)} tone="blue" />
        <StatCard label="Disabled" value={num(s.inactive)} tone="slate" />
      </div>

      {mayManage && (
        <div className="mb-6">
          <UserForm roles={roles} />
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <Card title={`Users (${users.length})`} padded={false}>
            <DataTable columns={columns} rows={users} rowKey={(r) => r.id} />
          </Card>
        </div>

        <Card title="Recent Activity" padded={false}>
          {activity.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-slate-400">Nothing logged yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {activity.map((a, i) => (
                <li key={i} className="px-5 py-3">
                  <div className="text-sm text-slate-700">{a.description ?? a.module}</div>
                  <div className="mt-0.5 text-xs text-slate-400">
                    {a.user_name ?? "System"} · {dateTimeStr(a.created_at)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
