import { Fragment } from "react";
import Link from "next/link";
import { q } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { StatCard, Card } from "@/components/ui";
import { kg, num, dateStr } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Stock on Hand · PMAI Warehouse" };

type ByDate = {
  section: string;
  sku: string;
  product_name: string;
  production_date: string;
  age_days: number;
  crate_count: number;
  head_count: string;
  total_weight_kg: string;
};

type ByPallet = {
  pallet_no: string | null;
  storage_room: string | null;
  location_code: string | null;
  sku: string;
  section: string;
  production_date: string;
  age_days: number;
  crate_count: number;
  head_count: string;
  total_weight_kg: string;
};

export default async function StockOnHandPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  await requirePermission("report.view");
  const { tab } = await searchParams;
  const byPallet = tab === "pallet";

  const [totals, rows, palletRows] = await Promise.all([
    q<{ crates: string; heads: string; wt: string; skus: string; dates: string }>(
      `SELECT count(*)::int AS crates, COALESCE(sum(heads),0) AS heads,
              COALESCE(sum(net_weight_kg),0) AS wt,
              count(DISTINCT sku)::int AS skus,
              count(DISTINCT production_date)::int AS dates
         FROM v_stock_on_hand`
    ),
    // production_date is cast to text: node-postgres returns `date` as a JS Date
    // object, and distinct Date objects never dedupe in a Set or match as Map
    // keys — which silently produced one pivot column per row instead of one
    // per production date.
    q<ByDate>(
      `SELECT section, sku, product_name, production_date::text AS production_date,
              age_days, crate_count, head_count, total_weight_kg
         FROM v_stock_on_hand_by_date
        ORDER BY section, sku, production_date`
    ),
    byPallet
      ? q<ByPallet>(
          `SELECT pallet_no, storage_room, location_code, sku, section,
                  production_date::text AS production_date, age_days,
                  crate_count, head_count, total_weight_kg
             FROM v_stock_on_hand_by_pallet
            ORDER BY storage_room, location_code, pallet_no, sku`
        )
      : Promise.resolve([] as ByPallet[]),
  ]);

  const t = totals[0];

  // Pivot: distinct production dates become column groups, oldest first.
  const dates = [...new Set(rows.map((r) => r.production_date))].sort();
  const ageOf = new Map(rows.map((r) => [r.production_date, r.age_days]));

  // Group rows by section -> sku -> date
  const sections = new Map<string, Map<string, Map<string, ByDate>>>();
  for (const r of rows) {
    if (!sections.has(r.section)) sections.set(r.section, new Map());
    const skuMap = sections.get(r.section)!;
    if (!skuMap.has(r.sku)) skuMap.set(r.sku, new Map());
    skuMap.get(r.sku)!.set(r.production_date, r);
  }

  const colTotal = (d: string) => {
    const rs = rows.filter((r) => r.production_date === d);
    return {
      crate: rs.reduce((s, r) => s + r.crate_count, 0),
      head: rs.reduce((s, r) => s + Number(r.head_count), 0),
      wt: rs.reduce((s, r) => s + Number(r.total_weight_kg), 0),
    };
  };

  return (
    <>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Stock on Hand</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-500">
            What&apos;s physically in the warehouse, per SKU and production date. Includes
            basic-dressing crates (in storage/warehouse) and FPS finished goods received back.
          </p>
        </div>
        <div className="no-print flex items-center gap-2">
          <a
            href={`/reports/stock-on-hand/export${byPallet ? "?tab=pallet" : ""}`}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3.5 py-2 text-sm font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200 hover:bg-emerald-100"
          >
            ↓ Export CSV
          </a>
        </div>
      </div>

      {/* Tabs */}
      <div className="no-print mb-6 border-b border-slate-200">
        <nav className="-mb-px flex gap-6">
          {[
            { key: "date", label: "By Date", href: "/reports/stock-on-hand" },
            { key: "pallet", label: "By Pallet", href: "/reports/stock-on-hand?tab=pallet" },
          ].map((x) => {
            const active = (x.key === "pallet") === byPallet;
            return (
              <Link
                key={x.key}
                href={x.href}
                className={`border-b-2 px-1 pb-3 text-sm font-medium transition ${
                  active
                    ? "border-brand-600 text-brand-700"
                    : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700"
                }`}
              >
                {x.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Crates on Hand" value={num(t.crates)} tone="blue" />
        <StatCard label="Total Heads" value={num(t.heads)} tone="indigo" />
        <StatCard label="Total Weight" value={`${kg(t.wt)} kg`} tone="green" />
        <StatCard label="SKUs · Prod. Dates" value={`${t.skus} · ${t.dates}`} />
      </div>

      {byPallet ? (
        <Card padded={false}>
          <div className="thin-scroll overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50/80">
                <tr className="border-b border-slate-200 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-2.5 text-left">Pallet</th>
                  <th className="px-4 py-2.5 text-left">Room</th>
                  <th className="px-4 py-2.5 text-left">Slot</th>
                  <th className="px-4 py-2.5 text-left">SKU</th>
                  <th className="px-4 py-2.5 text-left">Prod. Date</th>
                  <th className="px-4 py-2.5 text-right">Crate</th>
                  <th className="px-4 py-2.5 text-right">Head</th>
                  <th className="px-4 py-2.5 text-right">Weight</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {palletRows.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-12 text-center text-slate-400">
                      No stock on hand.
                    </td>
                  </tr>
                )}
                {palletRows.map((r, i) => (
                  <tr key={i} className="hover:bg-slate-50">
                    <td className="px-4 py-2 font-medium text-slate-800">{r.pallet_no ?? "—"}</td>
                    <td className="px-4 py-2 text-slate-600">{r.storage_room ?? "—"}</td>
                    <td className="px-4 py-2 font-mono text-xs text-slate-500">
                      {r.location_code ?? "—"}
                    </td>
                    <td className="px-4 py-2 font-medium text-slate-700">{r.sku}</td>
                    <td className="px-4 py-2 text-slate-600">
                      {dateStr(r.production_date)}{" "}
                      <span className="text-xs text-emerald-600">Day {r.age_days}</span>
                    </td>
                    <td className="px-4 py-2 text-right tabnum">{num(r.crate_count)}</td>
                    <td className="px-4 py-2 text-right tabnum">{num(r.head_count)}</td>
                    <td className="px-4 py-2 text-right tabnum">{kg(r.total_weight_kg)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <Card padded={false}>
          <div className="thin-scroll overflow-x-auto">
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th
                    rowSpan={2}
                    className="sticky left-0 z-10 border-b border-r border-slate-200 bg-slate-50 px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600"
                  >
                    SKU
                  </th>
                  {dates.map((d) => (
                    <th
                      key={d}
                      colSpan={3}
                      className="border-b border-r border-slate-200 bg-slate-50 px-4 py-2 text-center text-xs font-semibold text-slate-700"
                    >
                      {dateStr(d)}
                      <div className="font-semibold text-emerald-600">Day {ageOf.get(d)}</div>
                    </th>
                  ))}
                  <th
                    colSpan={3}
                    className="border-b border-slate-200 bg-amber-50 px-4 py-2 text-center text-xs font-bold uppercase tracking-wide text-amber-800"
                  >
                    Total
                  </th>
                </tr>
                <tr className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  {dates.map((d) => (
                    <Fragment key={d}>
                      <th className="border-b border-slate-200 bg-slate-50 px-3 py-1.5 text-right">Crate</th>
                      <th className="border-b border-slate-200 bg-slate-50 px-3 py-1.5 text-right">Head</th>
                      <th className="border-b border-r border-slate-200 bg-slate-50 px-3 py-1.5 text-right">Weight</th>
                    </Fragment>
                  ))}
                  <th className="border-b border-slate-200 bg-amber-50 px-3 py-1.5 text-right">Crate</th>
                  <th className="border-b border-slate-200 bg-amber-50 px-3 py-1.5 text-right">Head</th>
                  <th className="border-b border-slate-200 bg-amber-50 px-3 py-1.5 text-right">Weight</th>
                </tr>
              </thead>

              <tbody>
                {/* Grand total row */}
                <tr className="bg-slate-800 font-semibold text-white">
                  <td className="sticky left-0 z-10 bg-slate-800 px-4 py-2">TOTAL</td>
                  {dates.map((d) => {
                    const ct = colTotal(d);
                    return (
                      <Fragment key={d}>
                        <td className="px-3 py-2 text-right tabnum">{num(ct.crate)}</td>
                        <td className="px-3 py-2 text-right tabnum">{num(ct.head)}</td>
                        <td className="border-r border-slate-600 px-3 py-2 text-right tabnum">{kg(ct.wt)}</td>
                      </Fragment>
                    );
                  })}
                  <td className="bg-amber-400 px-3 py-2 text-right tabnum text-slate-900">{num(t.crates)}</td>
                  <td className="bg-amber-400 px-3 py-2 text-right tabnum text-slate-900">{num(t.heads)}</td>
                  <td className="bg-amber-400 px-3 py-2 text-right tabnum text-slate-900">{kg(t.wt)}</td>
                </tr>

                {[...sections.entries()].map(([section, skuMap]) => (
                  <Fragment key={section}>
                    <tr>
                      <td
                        colSpan={dates.length * 3 + 4}
                        className="sticky left-0 border-b border-slate-200 bg-slate-100 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-widest text-slate-500"
                      >
                        {section}
                      </td>
                    </tr>
                    {[...skuMap.entries()].map(([sku, dateMap]) => {
                      const rowTotal = [...dateMap.values()].reduce(
                        (a, r) => ({
                          crate: a.crate + r.crate_count,
                          head: a.head + Number(r.head_count),
                          wt: a.wt + Number(r.total_weight_kg),
                        }),
                        { crate: 0, head: 0, wt: 0 }
                      );
                      return (
                        <tr key={`${section}-${sku}`} className="border-b border-slate-100 hover:bg-slate-50">
                          <td className="sticky left-0 z-10 border-r border-slate-200 bg-white px-4 py-2 font-semibold text-slate-800">
                            {sku}
                          </td>
                          {dates.map((d) => {
                            const cell = dateMap.get(d);
                            return (
                              <Fragment key={d}>
                                <td className="px-3 py-2 text-right tabnum text-slate-600">
                                  {cell ? num(cell.crate_count) : ""}
                                </td>
                                <td className="px-3 py-2 text-right tabnum text-slate-600">
                                  {cell ? num(cell.head_count) : ""}
                                </td>
                                <td className="border-r border-slate-200 px-3 py-2 text-right tabnum text-slate-500">
                                  {cell ? kg(cell.total_weight_kg) : ""}
                                </td>
                              </Fragment>
                            );
                          })}
                          <td className="bg-amber-50/60 px-3 py-2 text-right font-semibold tabnum text-slate-800">
                            {num(rowTotal.crate)}
                          </td>
                          <td className="bg-amber-50/60 px-3 py-2 text-right font-semibold tabnum text-slate-800">
                            {num(rowTotal.head)}
                          </td>
                          <td className="bg-amber-50/60 px-3 py-2 text-right font-semibold tabnum text-slate-800">
                            {kg(rowTotal.wt)}
                          </td>
                        </tr>
                      );
                    })}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
