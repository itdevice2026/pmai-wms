"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { kg, num } from "@/lib/format";

export type ScanResult = {
  ok: boolean;
  message: string;
  crateNo?: string;
  sku?: string;
  weightKg?: number;
  toStatus?: string;
};

export type ScanRow = ScanResult & { at: number };

/**
 * Shared barcode-scan terminal. Used by BD Scan Station, FPS Receiving Station
 * and the transfer screens — anywhere the operator scans crate after crate and
 * needs immediate, unambiguous feedback without touching the mouse.
 */
export function ScanStation({
  title,
  subtitle,
  actionLabel,
  onScan,
  contextFields,
  disabled,
  disabledReason,
}: {
  title: string;
  subtitle: string;
  actionLabel: string;
  onScan: (code: string, context: Record<string, string>) => Promise<ScanResult>;
  contextFields?: React.ReactNode;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const [code, setCode] = useState("");
  const [log, setLog] = useState<ScanRow[]>([]);
  const [pending, start] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // Keep focus in the scan box — hardware scanners type like a keyboard.
  useEffect(() => {
    const t = setInterval(() => {
      if (document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "SELECT") {
        inputRef.current?.focus();
      }
    }, 1200);
    return () => clearInterval(t);
  }, []);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const value = code.trim();
    if (!value || disabled) return;

    const ctx: Record<string, string> = {};
    if (formRef.current) {
      for (const [k, v] of new FormData(formRef.current).entries()) {
        if (k !== "code") ctx[k] = String(v);
      }
    }

    start(async () => {
      const res = await onScan(value, ctx);
      setLog((prev) => [{ ...res, at: Date.now() }, ...prev].slice(0, 200));
      setCode("");
      inputRef.current?.focus();
    });
  }

  const okCount = log.filter((l) => l.ok).length;
  const errCount = log.length - okCount;
  const totalWeight = log.filter((l) => l.ok).reduce((s, l) => s + (l.weightKg ?? 0), 0);
  const last = log[0];

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <form
        ref={formRef}
        onSubmit={submit}
        className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
      >
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        <p className="mt-1 text-sm text-slate-500">{subtitle}</p>

        {disabled && disabledReason && (
          <div className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-inset ring-amber-200">
            {disabledReason}
          </div>
        )}

        {contextFields && <div className="mt-5 grid gap-4 sm:grid-cols-2">{contextFields}</div>}

        <div className="mt-5">
          <label className="mb-1.5 block text-sm font-semibold text-slate-700">
            Scan crate barcode
          </label>
          <input
            ref={inputRef}
            name="code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoFocus
            disabled={disabled}
            placeholder="PMAI-20260813-0001-P1"
            className="w-full rounded-lg border-0 px-4 py-4 text-center font-mono text-lg tracking-wider ring-2 ring-inset ring-slate-300 focus:ring-brand-500 disabled:bg-slate-50"
          />
          <p className="mt-1.5 text-xs text-slate-400">
            The field stays focused for hardware scanners. Press Enter to {actionLabel.toLowerCase()}.
          </p>
        </div>

        <button
          type="submit"
          disabled={pending || disabled || !code.trim()}
          className="mt-4 w-full rounded-lg bg-brand-600 px-4 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-brand-700 disabled:opacity-50"
        >
          {pending ? "Working…" : actionLabel}
        </button>

        {/* Big, unambiguous feedback for the last scan */}
        {last && (
          <div
            className={`mt-5 rounded-xl px-5 py-4 ring-1 ring-inset ${
              last.ok
                ? "bg-emerald-50 text-emerald-900 ring-emerald-200"
                : "bg-rose-50 text-rose-900 ring-rose-200"
            }`}
          >
            <div className="flex items-center gap-2 text-base font-semibold">
              <span>{last.ok ? "✓" : "✕"}</span>
              <span>{last.message}</span>
            </div>
            {last.crateNo && (
              <div className="mt-1 font-mono text-xs opacity-70">
                {last.crateNo}
                {last.sku ? ` · ${last.sku}` : ""}
                {last.weightKg ? ` · ${kg(last.weightKg)} kg` : ""}
              </div>
            )}
          </div>
        )}
      </form>

      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">This session</h2>
          <button
            type="button"
            onClick={() => setLog([])}
            className="text-xs text-slate-400 hover:text-slate-600"
          >
            Clear
          </button>
        </div>

        <div className="mb-4 grid grid-cols-3 gap-3">
          <div className="rounded-lg bg-emerald-50 px-3 py-2.5 text-center">
            <div className="text-2xl font-semibold tabnum text-emerald-700">{num(okCount)}</div>
            <div className="text-[11px] uppercase tracking-wide text-emerald-600">Accepted</div>
          </div>
          <div className="rounded-lg bg-rose-50 px-3 py-2.5 text-center">
            <div className="text-2xl font-semibold tabnum text-rose-700">{num(errCount)}</div>
            <div className="text-[11px] uppercase tracking-wide text-rose-600">Rejected</div>
          </div>
          <div className="rounded-lg bg-slate-100 px-3 py-2.5 text-center">
            <div className="text-2xl font-semibold tabnum text-slate-700">{kg(totalWeight)}</div>
            <div className="text-[11px] uppercase tracking-wide text-slate-500">kg scanned</div>
          </div>
        </div>

        <div className="thin-scroll max-h-[460px] overflow-y-auto rounded-lg border border-slate-200">
          {log.length === 0 ? (
            <p className="px-4 py-16 text-center text-sm text-slate-400">
              Nothing scanned yet — scan a crate to begin.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {log.map((l, i) => (
                <li key={i} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-sm">
                      <span className={l.ok ? "text-emerald-600" : "text-rose-600"}>
                        {l.ok ? "✓" : "✕"}
                      </span>
                      <span className="truncate text-slate-700">{l.message}</span>
                    </div>
                    {l.crateNo && (
                      <div className="truncate font-mono text-[11px] text-slate-400">
                        {l.crateNo}
                        {l.sku ? ` · ${l.sku}` : ""}
                      </div>
                    )}
                  </div>
                  <span className="shrink-0 text-xs tabnum text-slate-400">
                    {l.weightKg ? `${kg(l.weightKg)} kg` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
