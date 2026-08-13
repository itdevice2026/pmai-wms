import Link from "next/link";
import { q } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { Card, StatCard, Badge } from "@/components/ui";
import { CRATE_STATUS_LABEL, CRATE_STATUS_TONE } from "@/lib/nav";
import { kg, num, relTime, dateStr } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard · PMAI Warehouse" };

export default async function DashboardPage() {
  const user = await requireUser();

  const [
    userStats,
    crateStats,
    statusRows,
    todayProd,
    recentActivity,
    lowRooms,
    expiring,
  ] = await Promise.all([
    q<{ total: string; admins: string; production: string; warehouse: string }>(
      `SELECT
         count(*) FILTER (WHERE is_active)                              AS total,
         count(*) FILTER (WHERE is_active AND department = 'Admin')     AS admins,
         count(*) FILTER (WHERE is_active AND department = 'Production') AS production,
         count(*) FILTER (WHERE is_active AND department = 'Warehouse') AS warehouse
       FROM users`
    ),
    q<{ crates: string; weighings: string; job_orders: string; fps: string; pending_jo: string }>(
      `SELECT
         (SELECT count(*) FROM crates WHERE NOT is_voided)        AS crates,
         (SELECT count(*) FROM weighing_records)                  AS weighings,
         (SELECT count(*) FROM job_orders)                        AS job_orders,
         (SELECT count(*) FROM fps_processings)                   AS fps,
         (SELECT count(*) FROM job_orders WHERE status = 'pending') AS pending_jo`
    ),
    q<{ status: string; cnt: string; wt: string }>(
      `SELECT status::text AS status, count(*) AS cnt, COALESCE(sum(net_weight_kg),0) AS wt
         FROM crates WHERE NOT is_voided GROUP BY status`
    ),
    q<{ crates: string; heads: string; wt: string }>(
      `SELECT count(*) AS crates, COALESCE(sum(heads),0) AS heads, COALESCE(sum(net_weight_kg),0) AS wt
         FROM crates WHERE production_date = current_date AND NOT is_voided`
    ),
    q<{
      crate_no: string;
      from_status: string | null;
      to_status: string | null;
      occurred_at: string;
      full_name: string | null;
    }>(
      `SELECT c.crate_no, m.from_status::text, m.to_status::text, m.occurred_at, u.full_name
         FROM crate_movements m
         JOIN crates c ON c.id = m.crate_id
         LEFT JOIN users u ON u.id = m.user_id
        ORDER BY m.occurred_at DESC LIMIT 12`
    ),
    q<{ room: string; used: string; capacity: string }>(
      `SELECT sr.name AS room,
              count(DISTINCT c.location_id) AS used,
              COALESCE(sr.capacity_pallets, 0) AS capacity
         FROM storage_rooms sr
         LEFT JOIN locations l ON l.storage_room_id = sr.id
         LEFT JOIN crates c ON c.location_id = l.id AND NOT c.is_voided
                            AND c.status IN ('storage','warehouse')
        WHERE sr.is_active
        GROUP BY sr.id, sr.name, sr.capacity_pallets
        ORDER BY sr.name`
    ),
    q<{ cnt: string; wt: string }>(
      `SELECT count(*) AS cnt, COALESCE(sum(net_weight_kg),0) AS wt
         FROM v_stock_ageing
        WHERE days_to_expiry IS NOT NULL AND days_to_expiry <= 3`
    ),
  ]);

  const us = userStats[0];
  const cs = crateStats[0];
  const tp = todayProd[0];
  const byStatus = new Map(statusRows.map((r) => [r.status, r]));
  const order = [
    "production",
    "warehouse",
    "storage",
    "cutting",
    "issued_to_fps",
    "fps_processed",
    "wh_received_cut",
    "picked",
    "dispatched",
  ];

  const onHandWeight = statusRows
    .filter((r) => ["warehouse", "storage", "wh_received_cut", "fps_processed"].includes(r.status))
    .reduce((s, r) => s + Number(r.wt), 0);

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Welcome back, {user.fullName.split(" ")[0]}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {dateStr(new Date())} · {user.roleName}
        </p>
      </div>

      {/* Today */}
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-400">
        Today
      </h2>
      <div className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Crates Produced" value={num(tp.crates)} tone="brand" hint="Dressed today" />
        <StatCard label="Heads Processed" value={num(tp.heads)} tone="slate" />
        <StatCard label="Production Weight" value={`${kg(tp.wt)} kg`} tone="blue" />
        <StatCard
          label="Stock on Hand"
          value={`${kg(onHandWeight)} kg`}
          tone="green"
          href="/reports/stock-on-hand"
        />
      </div>

      {/* System overview */}
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-400">
        System Overview
      </h2>
      <div className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Weighing Records" value={num(cs.weighings)} href="/bd/weighing" />
        <StatCard label="Total Crates" value={num(cs.crates)} />
        <StatCard
          label="Job Orders"
          value={num(cs.job_orders)}
          hint={`${cs.pending_jo} pending`}
          href="/reports/job-orders"
        />
        <StatCard label="FPS Processings" value={num(cs.fps)} href="/fps/entry" />
      </div>

      {/* Crate status */}
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-400">
        Crate Status Breakdown
      </h2>
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {order.map((s) => {
          const row = byStatus.get(s);
          return (
            <StatCard
              key={s}
              label={CRATE_STATUS_LABEL[s]}
              value={num(row?.cnt ?? 0)}
              hint={`${kg(row?.wt ?? 0)} kg`}
              tone={(CRATE_STATUS_TONE[s] ?? "slate") as never}
            />
          );
        })}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card
          title="Recent Crate Activity"
          padded={false}
          action={
            <Link href="/reports/crate-audit" className="text-xs font-medium text-brand-600 hover:underline">
              View all →
            </Link>
          }
        >
          {recentActivity.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-slate-400">
              No crate movements recorded yet.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {recentActivity.map((a, i) => (
                <li key={i} className="flex items-center justify-between gap-4 px-5 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-sm">
                      <span className="text-slate-500">
                        {a.from_status ? CRATE_STATUS_LABEL[a.from_status] : "New"}
                      </span>
                      <span className="text-slate-300">→</span>
                      <span className="font-medium text-slate-800">
                        {a.to_status ? CRATE_STATUS_LABEL[a.to_status] : "—"}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate text-xs text-slate-400">
                      {a.crate_no}
                      {a.full_name ? ` · ${a.full_name}` : ""}
                    </div>
                  </div>
                  <span className="shrink-0 text-xs text-slate-400">{relTime(a.occurred_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="space-y-6">
          <Card title="Storage Room Utilisation" padded={false}>
            {lowRooms.length === 0 ? (
              <p className="px-5 py-10 text-center text-sm text-slate-400">
                No storage rooms configured.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {lowRooms.map((r, i) => {
                  const used = Number(r.used);
                  const cap = Number(r.capacity) || 1;
                  const p = Math.min(100, Math.round((used / cap) * 100));
                  return (
                    <li key={i} className="px-5 py-3">
                      <div className="mb-1.5 flex items-center justify-between text-sm">
                        <span className="text-slate-700">{r.room}</span>
                        <span className="tabnum text-xs text-slate-500">
                          {used} / {r.capacity} slots
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className={`h-full rounded-full ${
                            p > 85 ? "bg-rose-500" : p > 60 ? "bg-amber-500" : "bg-emerald-500"
                          }`}
                          style={{ width: `${p}%` }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card title="Attention Needed">
            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-slate-600">Expiring within 3 days</span>
                <Badge tone={Number(expiring[0].cnt) > 0 ? "red" : "green"}>
                  {num(expiring[0].cnt)} crates · {kg(expiring[0].wt)} kg
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-600">Crates still unscanned</span>
                <Link href="/reports/unscanned-crates">
                  <Badge tone={Number(byStatus.get("production")?.cnt ?? 0) > 0 ? "amber" : "green"}>
                    {num(byStatus.get("production")?.cnt ?? 0)} in production
                  </Badge>
                </Link>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-600">Active users</span>
                <Badge tone="blue">{num(us.total)}</Badge>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
