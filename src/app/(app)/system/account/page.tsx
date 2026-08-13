import { requireUser } from "@/lib/auth";
import { Card, Badge } from "@/components/ui";
import { dateTimeStr } from "@/lib/format";
import { q1 } from "@/lib/db";
import { PasswordForm } from "./PasswordForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "My Account · PMAI Warehouse" };

export default async function Page() {
  const user = await requireUser();
  const row = await q1<{ last_login_at: string | null; created_at: string }>(
    "SELECT last_login_at, created_at FROM users WHERE id = $1",
    [user.id]
  );

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">My Account</h1>
        <p className="mt-1 text-sm text-slate-500">Your sign-in details and password.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Profile">
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Name</dt>
              <dd className="font-medium text-slate-800">{user.fullName}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Email</dt>
              <dd className="text-slate-800">{user.email}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Role</dt>
              <dd><Badge tone="blue">{user.roleName}</Badge></dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Department</dt>
              <dd className="text-slate-800">{user.department ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Last sign-in</dt>
              <dd className="text-slate-800">{dateTimeStr(row?.last_login_at)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Permissions</dt>
              <dd className="text-slate-800">
                {user.roleCode === "admin" ? "All (administrator)" : `${user.permissions.length} granted`}
              </dd>
            </div>
          </dl>
        </Card>

        <Card title="Change password">
          <PasswordForm />
        </Card>
      </div>
    </>
  );
}
