import { HashRouter, Routes, Route, NavLink, Navigate, useLocation } from "react-router-dom";
import { useState } from "react";
import { SessionProvider, useSession } from "./session";
import { NAV } from "./nav";
import { Card, Field, Button, Spinner, ErrorBox, inputClass } from "./ui";
import {
  Dashboard, WeighingEntry, ScanStation, StorageMap, StockOnHand,
  ActivityLog, Account, ComingSoon,
} from "./pages";
import {
  BasicDressingReport, FpsOutputReport, PalletsReport, WarehouseRecordsReport,
  StorageRoomsReport, ProductionSummaryReport, IssuanceSummaryReport,
  DispatchSummaryReport, CrateAuditReport, UnscannedCratesReport, JobOrdersReport,
} from "./reports";
import {
  Picklist, Issuance, Dispatch, PalletCreation, LocationTransfer,
  PalletTransfer, PalletDisposition, LockedRecords, Rbac, LiveBirdReceiving, Byproducts, ImportWeighing,
} from "./operations";

/**
 * HashRouter is deliberate: GitHub Pages serves static files and has no
 * rewrite rules, so a deep link like /wh/storage-map would 404 on refresh.
 * Hash routing keeps every route reachable and bookmarkable.
 */

const SCREENS: Record<string, React.ComponentType> = {
  "/dashboard": Dashboard,
  "/bd/weighing": WeighingEntry,
  "/bd/scan-station": ScanStation,
  "/wh/storage-map": StorageMap,
  "/reports/stock-on-hand": StockOnHand,
  "/reports/activity-log": ActivityLog,
  "/system/account": Account,

  // Report section — config-driven screens over the db/014 views, which
  // already exclude locked records.
  "/reports/basic-dressing": BasicDressingReport,
  "/reports/fps-output": FpsOutputReport,
  "/reports/pallets": PalletsReport,
  "/reports/warehouse-records": WarehouseRecordsReport,
  "/reports/storage-rooms": StorageRoomsReport,
  "/reports/production-summary": ProductionSummaryReport,
  "/reports/issuance-summary": IssuanceSummaryReport,
  "/reports/dispatch-summary": DispatchSummaryReport,
  "/reports/crate-audit": CrateAuditReport,
  "/reports/unscanned-crates": UnscannedCratesReport,
  "/reports/job-orders": JobOrdersReport,

  // Interactive screens — every write goes through an rpc_* function (db/015).
  "/wh/picklist": Picklist,
  "/wh/issuance": Issuance,
  "/wh/dispatch": Dispatch,
  "/wh/pallet-creation": PalletCreation,
  "/wh/location-transfer": LocationTransfer,
  "/wh/pallet-transfer": PalletTransfer,
  "/planning/pallet-disposition": PalletDisposition,
  "/system/locked-records": LockedRecords,
  "/system/rbac": Rbac,
  "/bd/live-bird-receiving": LiveBirdReceiving,
  "/bd/byproducts": Byproducts,
  "/bd/import": ImportWeighing,
};

function Login() {
  const { signIn, configured } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await signIn(email, password);
    setBusy(false);
    if (!res.ok) setError(res.error ?? "Sign-in failed.");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-600 text-lg font-bold text-white shadow-sm">P</div>
          <h1 className="mt-3 text-xl font-semibold text-slate-900">PMAI Warehouse</h1>
          <p className="mt-1 text-sm text-slate-500">Management System</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          {!configured ? (
            <ErrorBox message="This build has no Supabase configuration. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY and rebuild." />
          ) : (
            <form onSubmit={submit} className="space-y-4">
              {error && <ErrorBox message={error} />}
              <Field label="Email">
                <input className={inputClass} type="email" autoComplete="username" required autoFocus
                  value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@meatplus.ph" />
              </Field>
              <Field label="Password">
                <input className={inputClass} type="password" autoComplete="current-password" required
                  value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
              </Field>
              <Button type="submit" disabled={busy} className="w-full py-2.5">
                {busy ? "Signing in…" : "Sign in"}
              </Button>
            </form>
          )}
        </div>
        <p className="mt-6 text-center text-xs text-slate-400">Meatplus Trading Corp</p>
      </div>
    </main>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const { profile, signOut, can } = useSession();
  const [open, setOpen] = useState(false);
  const loc = useLocation();

  const sections = NAV.map((s) => ({
    ...s,
    items: s.items.filter((i) => !i.permission || can(i.permission)),
  })).filter((s) => s.items.length > 0);

  const initials = (profile?.fullName ?? "")
    .split(/\s+/).slice(0, 2).map((p) => p[0]).join("").toUpperCase();

  return (
    <div className="min-h-screen">
      <button onClick={() => setOpen((v) => !v)} aria-label="Toggle navigation"
        className="fixed left-3 top-3 z-50 rounded-lg border border-slate-300 bg-white p-2 shadow-sm lg:hidden">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" />
        </svg>
      </button>
      {open && <div className="fixed inset-0 z-30 bg-slate-900/30 lg:hidden" onClick={() => setOpen(false)} />}

      <aside className={`fixed inset-y-0 left-0 z-40 w-64 border-r border-slate-200 bg-white transition-transform lg:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}>
        <nav className="thin-scroll flex h-full flex-col overflow-y-auto">
          <div className="sticky top-0 z-10 flex items-center gap-2.5 border-b border-slate-200 bg-white px-5 py-4">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">P</div>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-slate-900">PMAI</div>
              <div className="truncate text-[11px] text-slate-500">Warehouse</div>
            </div>
          </div>
          <div className="flex-1 px-3 pb-8 pt-3">
            {sections.map((section, si) => (
              <div key={section.title ?? `s${si}`} className="mb-4">
                {section.title && (
                  <div className="px-2 pb-1.5 pt-2 text-[10px] font-semibold uppercase tracking-widest text-slate-400">{section.title}</div>
                )}
                <ul className="space-y-0.5">
                  {section.items.map((item) => (
                    <li key={item.href}>
                      <NavLink to={item.href} onClick={() => setOpen(false)}
                        className={({ isActive }) =>
                          `block rounded-lg px-2.5 py-1.5 text-[13px] transition ${
                            isActive ? "bg-brand-50 font-medium text-brand-700"
                                     : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"}`}>
                        {item.label}
                        {!SCREENS[item.href] && <span className="ml-1.5 text-[9px] text-slate-300">soon</span>}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </nav>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-end gap-4 border-b border-slate-200 bg-white/90 px-5 backdrop-blur">
          <div className="hidden text-right sm:block">
            <div className="text-sm font-medium leading-tight text-slate-800">{profile?.fullName}</div>
            <div className="text-[11px] leading-tight text-slate-500">
              {profile?.roleName}{profile?.department ? ` · ${profile.department}` : ""}
            </div>
          </div>
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-600">{initials}</div>
          <button onClick={() => void signOut()}
            className="rounded-lg px-2.5 py-1.5 text-sm text-slate-500 transition hover:bg-slate-100 hover:text-slate-800">
            Logout
          </button>
        </header>
        <main className="px-5 py-6 lg:px-8" key={loc.pathname}>{children}</main>
      </div>
    </div>
  );
}

function Routed() {
  const { profile, loading } = useSession();

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center"><Spinner /></div>;
  }
  if (!profile?.signedIn) return <Login />;

  const allRoutes = NAV.flatMap((s) => s.items);

  return (
    <Shell>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        {allRoutes.map((r) => {
          const Screen = SCREENS[r.href];
          return (
            <Route key={r.href} path={r.href}
              element={Screen ? <Screen /> : <ComingSoon title={r.label} />} />
          );
        })}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Shell>
  );
}

export function App() {
  return (
    <SessionProvider>
      <HashRouter>
        <Routed />
      </HashRouter>
    </SessionProvider>
  );
}
