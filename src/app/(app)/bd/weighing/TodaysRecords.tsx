"use client";

import { useMemo, useState, useTransition } from "react";
import { deleteWeighing } from "./actions";
import { kg, num } from "@/lib/format";

export type RecordRow = {
  crate_id: number;
  crate_no: string;
  sku: string;
  band_code: string | null;
  heads: number | null;
  net_weight_kg: string;
  weighed_at: string;
  status: string;
  weighed_by: string | null;
};

export function TodaysRecords({
  rows,
  skus,
  canDelete,
}: {
  rows: RecordRow[];
  skus: string[];
  canDelete: boolean;
}) {
  const [search, setSearch] = useState("");
  const [sku, setSku] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (!sku || r.sku === sku) &&
        (!s || r.crate_no.toLowerCase().includes(s) || r.sku.toLowerCase().includes(s))
    );
  }, [rows, search, sku]);

  const totalWeight = filtered.reduce((a, r) => a + Number(r.net_weight_kg), 0);

  function toggle(id: number) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function removeSelected() {
    if (selected.size === 0) return;
    start(async () => {
      const errors: string[] = [];
      for (const id of selected) {
        const res = await deleteWeighing(id);
        if (!res.ok && res.error) errors.push(res.error);
      }
      setSelected(new Set());
      setMsg(errors.length ? errors[0] : null);
    });
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-1 flex items-center gap-2">
        <h2 className="text-lg font-semibold text-slate-900">Today&apos;s records</h2>
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          Live
        </span>
      </div>
      <p className="mb-4 text-sm text-slate-500">
        {num(filtered.length)} record(s) · {kg(totalWeight, 3)} kg total
      </p>

      <div className="no-print mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[180px] flex-1">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
            🔍
          </span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search / scan code"
            className="w-full rounded-lg border-0 py-2 pl-9 pr-3 text-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-brand-500"
          />
        </div>

        <select
          value={sku}
          onChange={(e) => setSku(e.target.value)}
          className="rounded-lg border-0 px-3 py-2 text-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-brand-500"
        >
          <option value="">All SKUs</option>
          {skus.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={() => window.print()}
          disabled={filtered.length === 0}
          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-100 px-3.5 py-2 text-sm font-medium text-emerald-800 transition hover:bg-emerald-200 disabled:opacity-50"
        >
          🖨 Print All
        </button>

        <button
          type="button"
          onClick={removeSelected}
          disabled={!canDelete || selected.size === 0 || pending}
          title={canDelete ? undefined : "Requires the 'Delete weighing records' permission"}
          className="inline-flex items-center gap-1.5 rounded-lg bg-rose-100 px-3.5 py-2 text-sm font-medium text-rose-800 transition hover:bg-rose-200 disabled:opacity-50"
        >
          🗑 Delete ({selected.size})
        </button>
      </div>

      {msg && (
        <div className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-inset ring-rose-200">
          {msg}
        </div>
      )}

      <div className="thin-scroll max-h-[520px] overflow-y-auto rounded-lg border border-slate-200">
        {filtered.length === 0 ? (
          <p className="px-4 py-16 text-center text-sm text-slate-400">
            No records yet today — save a weight to start logging.
          </p>
        ) : (
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 bg-slate-50/95 backdrop-blur">
              <tr className="border-b border-slate-200 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                <th className="w-8 px-3 py-2" />
                <th className="px-3 py-2 text-left">Crate</th>
                <th className="px-3 py-2 text-left">SKU</th>
                <th className="px-3 py-2 text-right">Heads</th>
                <th className="px-3 py-2 text-right">Net kg</th>
                <th className="px-3 py-2 text-right">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((r) => (
                <tr key={r.crate_id} className="hover:bg-slate-50">
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={selected.has(r.crate_id)}
                      onChange={() => toggle(r.crate_id)}
                      className="h-4 w-4 rounded border-slate-300"
                    />
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-700">{r.crate_no}</td>
                  <td className="px-3 py-2 font-medium text-slate-800">{r.sku}</td>
                  <td className="px-3 py-2 text-right tabnum text-slate-600">{r.heads ?? "—"}</td>
                  <td className="px-3 py-2 text-right tabnum font-medium text-slate-800">
                    {kg(r.net_weight_kg)}
                  </td>
                  <td className="px-3 py-2 text-right text-xs text-slate-400">
                    {new Date(r.weighed_at).toLocaleTimeString("en-PH", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
