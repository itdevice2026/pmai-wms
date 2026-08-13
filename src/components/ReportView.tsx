import { q } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { REPORTS, type ColumnDef, type ReportDef } from "@/lib/reports";
import { Card, Badge, StatusBadge } from "@/components/ui";
import { kg, num, pct, dateStr, dateTimeStr, toISODate } from "@/lib/format";

export type SearchParams = Record<string, string | string[] | undefined>;

function daysAgo(n: number) {
  return toISODate(new Date(Date.now() - n * 86400000));
}

/** Resolve filter values from the query string, applying declared defaults. */
export function resolveParams(def: ReportDef, sp: SearchParams) {
  const filters = def.filters ?? [];
  const get = (name: string) => {
    const v = sp[name];
    return Array.isArray(v) ? v[0] : v;
  };

  const from =
    get("from") ??
    daysAgo(
      (filters.find((f) => f.kind === "date" && f.name === "from") as { defaultDaysAgo?: number })
        ?.defaultDaysAgo ?? def.defaultRangeDays ?? 7
    );
  const to = get("to") ?? daysAgo(0);

  // Remaining filters become $3, $4, ... in declaration order
  const extras = filters
    .filter((f) => f.name !== "from" && f.name !== "to")
    .map((f) => get(f.name) ?? "");

  return { from, to, extras, params: [from, to, ...extras] as unknown[] };
}

function renderCell(col: ColumnDef, row: Record<string, unknown>) {
  const v = row[col.key];
  if (v === null || v === undefined || v === "") return <span className="text-slate-300">—</span>;
  switch (col.format) {
    case "kg":
      return kg(v);
    case "num":
      return num(v);
    case "pct":
      return pct(v);
    case "date":
      return dateStr(v);
    case "datetime":
      return dateTimeStr(v);
    case "status":
      return <StatusBadge status={String(v)} />;
    case "badge":
      return <Badge>{String(v).replace(/_/g, " ")}</Badge>;
    default:
      return String(v);
  }
}

export async function ReportView({
  id,
  searchParams,
}: {
  id: string;
  searchParams: SearchParams;
}) {
  const def = REPORTS[id];
  if (!def) return <p className="text-sm text-rose-600">Unknown report: {id}</p>;

  await requirePermission(def.permission);

  const { from, to, params } = resolveParams(def, searchParams);
  const rows = (await q(def.sql, params)) as Record<string, unknown>[];

  // Build select options for any select filters
  const selectOptions: Record<string, { value: string; label: string }[]> = {};
  for (const f of def.filters ?? []) {
    if (f.kind === "select") {
      selectOptions[f.name] = (await q(f.optionsSql)) as { value: string; label: string }[];
    }
  }

  const totals = def.totals?.length
    ? Object.fromEntries(
        def.totals.map((k) => [k, rows.reduce((s, r) => s + Number(r[k] ?? 0), 0)])
      )
    : null;

  const exportHref = `/reports/${id}/export?${new URLSearchParams(
    Object.entries(searchParams).reduce<Record<string, string>>((a, [k, v]) => {
      const val = Array.isArray(v) ? v[0] : v;
      if (val) a[k] = val;
      return a;
    }, { from, to })
  ).toString()}`;

  return (
    <>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{def.title}</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-500">{def.description}</p>
        </div>
        <a
          href={exportHref}
          className="no-print inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3.5 py-2 text-sm font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200 hover:bg-emerald-100"
        >
          ↓ Export CSV
        </a>
      </div>

      {def.filters && def.filters.length > 0 && (
        <form
          method="get"
          className="no-print mb-5 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
        >
          {def.filters.map((f) => {
            const current =
              f.name === "from" ? from : f.name === "to" ? to : (searchParams[f.name] as string) ?? "";
            if (f.kind === "date")
              return (
                <label key={f.name} className="block">
                  <span className="mb-1.5 block text-xs font-medium text-slate-600">{f.label}</span>
                  <input
                    type="date"
                    name={f.name}
                    defaultValue={current}
                    className="rounded-lg border-0 px-3 py-2 text-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-brand-500"
                  />
                </label>
              );
            if (f.kind === "select")
              return (
                <label key={f.name} className="block">
                  <span className="mb-1.5 block text-xs font-medium text-slate-600">{f.label}</span>
                  <select
                    name={f.name}
                    defaultValue={current}
                    className="rounded-lg border-0 px-3 py-2 text-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-brand-500"
                  >
                    <option value="">{f.allLabel ?? "All"}</option>
                    {(selectOptions[f.name] ?? []).map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
              );
            return (
              <label key={f.name} className="block">
                <span className="mb-1.5 block text-xs font-medium text-slate-600">{f.label}</span>
                <input
                  name={f.name}
                  defaultValue={current}
                  placeholder={f.placeholder}
                  className="w-64 rounded-lg border-0 px-3 py-2 text-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-brand-500"
                />
              </label>
            );
          })}
          <button
            type="submit"
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-700"
          >
            Apply
          </button>
        </form>
      )}

      <Card padded={false}>
        <div className="thin-scroll overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/80">
                {def.columns.map((c) => (
                  <th
                    key={c.key}
                    className={`whitespace-nowrap px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500 ${
                      c.align === "right" ? "text-right" : "text-left"
                    }`}
                  >
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.length === 0 && (
                <tr>
                  <td colSpan={def.columns.length} className="px-4 py-14 text-center text-slate-400">
                    No records for this period.
                  </td>
                </tr>
              )}
              {rows.map((r, i) => (
                <tr key={i} className="hover:bg-slate-50">
                  {def.columns.map((c) => (
                    <td
                      key={c.key}
                      className={`whitespace-nowrap px-4 py-2.5 text-slate-700 ${
                        c.align === "right" ? "text-right tabnum" : "text-left"
                      }`}
                    >
                      {renderCell(c, r)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            {totals && rows.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold text-slate-800">
                  {def.columns.map((c, i) => (
                    <td
                      key={c.key}
                      className={`px-4 py-2.5 ${c.align === "right" ? "text-right tabnum" : "text-left"}`}
                    >
                      {i === 0
                        ? `Total · ${num(rows.length)} rows`
                        : totals[c.key] !== undefined
                          ? c.format === "kg"
                            ? kg(totals[c.key])
                            : num(totals[c.key])
                          : ""}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </Card>
    </>
  );
}
