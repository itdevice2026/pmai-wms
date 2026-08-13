"use client";

import { useState, useTransition } from "react";
import { importWeighings, type ImportResult } from "./actions";
import { Card, Button } from "@/components/ui";
import { num } from "@/lib/format";

export function ImportForm() {
  const [res, setRes] = useState<ImportResult | null>(null);
  const [pending, start] = useTransition();

  return (
    <Card title="Import weighing records">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          start(async () => setRes(await importWeighings(fd)));
        }}
        className="space-y-4"
      >
        <div className="rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-600">
          <p className="font-medium text-slate-700">Expected CSV columns</p>
          <code className="mt-1 block font-mono text-xs text-slate-500">
            production_date,sku,weight_kg,heads
          </code>
          <p className="mt-2 text-xs text-slate-500">
            Dates must be YYYY-MM-DD. Each row creates one crate in <strong>production</strong>{" "}
            status — scan them in at the BD Scan Station as usual. Locked periods are rejected
            row by row, and the whole batch is logged.
          </p>
        </div>

        <input
          type="file"
          name="file"
          accept=".csv,text/csv"
          required
          className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-600 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-brand-700"
        />

        <Button type="submit" disabled={pending}>
          {pending ? "Importing…" : "Import file"}
        </Button>
      </form>

      {res && (
        <div className="mt-5">
          {res.ok ? (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg bg-slate-100 px-4 py-3 text-center">
                  <div className="text-2xl font-semibold tabnum text-slate-800">{num(res.total)}</div>
                  <div className="text-xs uppercase tracking-wide text-slate-500">Rows</div>
                </div>
                <div className="rounded-lg bg-emerald-50 px-4 py-3 text-center">
                  <div className="text-2xl font-semibold tabnum text-emerald-700">{num(res.success)}</div>
                  <div className="text-xs uppercase tracking-wide text-emerald-600">Imported</div>
                </div>
                <div className="rounded-lg bg-rose-50 px-4 py-3 text-center">
                  <div className="text-2xl font-semibold tabnum text-rose-700">{num(res.failed)}</div>
                  <div className="text-xs uppercase tracking-wide text-rose-600">Rejected</div>
                </div>
              </div>
              {res.errors && res.errors.length > 0 && (
                <div className="thin-scroll mt-4 max-h-56 overflow-y-auto rounded-lg border border-rose-200 bg-rose-50 p-3">
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-rose-700">
                    Rejected rows
                  </p>
                  <ul className="space-y-0.5 text-xs text-rose-800">
                    {res.errors.map((e, i) => (<li key={i}>{e}</li>))}
                  </ul>
                </div>
              )}
            </>
          ) : (
            <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-inset ring-rose-200">
              {res.error}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
