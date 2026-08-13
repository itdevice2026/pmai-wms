import { redirect } from "next/navigation";
import { getSessionUser, can } from "@/lib/auth";
import { q1 } from "@/lib/db";
import { NAV } from "@/lib/nav";
import { Sidebar } from "@/components/Sidebar";
import { logoutAction } from "@/app/actions/session";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const plant = await q1<{ name: string }>(
    "SELECT name FROM plants WHERE id = $1::int OR $1::int IS NULL ORDER BY id LIMIT 1",
    [user.plantId]
  );

  // Only show menu entries the signed-in role can actually open.
  const sections = NAV.map((s) => ({
    ...s,
    items: s.items.filter((i) => !i.permission || can(user, i.permission)),
  })).filter((s) => s.items.length > 0);

  const initials = user.fullName
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();

  return (
    <div className="min-h-screen">
      <Sidebar sections={sections} plantName={plant?.name ?? "Plant"} />

      <div className="lg:pl-64">
        <header className="no-print sticky top-0 z-20 flex h-14 items-center justify-end gap-4 border-b border-slate-200 bg-white/90 px-5 backdrop-blur">
          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <div className="text-sm font-medium leading-tight text-slate-800">
                {user.fullName}
              </div>
              <div className="text-[11px] leading-tight text-slate-500">
                {user.roleName}
                {user.department ? ` · ${user.department}` : ""}
              </div>
            </div>
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-600">
              {initials}
            </div>
            <form action={logoutAction}>
              <button
                type="submit"
                className="rounded-lg px-2.5 py-1.5 text-sm text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
              >
                Logout
              </button>
            </form>
          </div>
        </header>

        <main className="px-5 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
