"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { saveWeighing } from "./actions";
import { createScaleAdapter, type ScaleStatus } from "@/lib/scale";
import { kg } from "@/lib/format";

export type Product = {
  id: number;
  sku: string;
  class_code: string | null;
  band_code: string | null;
  band_min_kg: string | null;
  band_max_kg: string | null;
};

export type CrateType = {
  id: number;
  code: string;
  name: string;
  tare_kg: string;
  default_heads: number | null;
};

export type ClassOpt = { id: number; code: string; name: string };

export function WeighingForm({
  classes,
  products,
  crateTypes,
  today,
  maxDate,
  canUnlockDate,
  labelSize,
  autoPrint,
  fillSpace,
}: {
  classes: ClassOpt[];
  products: Product[];
  crateTypes: CrateType[];
  today: string;
  maxDate: string;
  canUnlockDate: boolean;
  labelSize: string;
  autoPrint: boolean;
  fillSpace: boolean;
}) {
  const [classCode, setClassCode] = useState(classes[0]?.code ?? "A");
  const banded = useMemo(
    () => products.filter((p) => p.class_code === classCode),
    [products, classCode]
  );
  const [productId, setProductId] = useState<number | null>(banded[0]?.id ?? null);
  const [crateTypeId, setCrateTypeId] = useState(crateTypes[0]?.id ?? 0);
  const [productionDate, setProductionDate] = useState(today);
  const [weight, setWeight] = useState("");
  const [heads, setHeads] = useState(String(crateTypes[0]?.default_heads ?? 15));
  const [dateUnlocked, setDateUnlocked] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [pending, start] = useTransition();

  const [scaleStatus, setScaleStatus] = useState<ScaleStatus>("connecting");
  const [liveWeight, setLiveWeight] = useState<number | null>(null);
  const weightRef = useRef<HTMLInputElement>(null);

  // Keep the SKU valid when the class changes
  useEffect(() => {
    if (!banded.some((p) => p.id === productId)) setProductId(banded[0]?.id ?? null);
  }, [banded, productId]);

  // Live scale
  useEffect(() => {
    const adapter = createScaleAdapter();
    adapter.start(
      (r) => {
        setLiveWeight(r.weightKg);
        if (r.stable) setWeight(r.weightKg.toFixed(2));
      },
      (s) => setScaleStatus(s)
    );
    return () => adapter.stop();
  }, []);

  const selected = banded.find((p) => p.id === productId);
  const crateType = crateTypes.find((c) => c.id === crateTypeId);
  const tare = Number(crateType?.tare_kg ?? 0);
  const net = weight ? Math.max(0, Number(weight) - tare) : 0;
  const headCount = Number(heads) || 0;
  const perHead = headCount > 0 && net > 0 ? net / headCount : 0;

  // Warn when the per-head average falls outside the selected band
  const bandLo = Number(selected?.band_min_kg ?? 0);
  const bandHi = Number(selected?.band_max_kg ?? 0);
  const outOfBand =
    perHead > 0 && bandLo > 0 && bandHi > 0 && (perHead < bandLo || perHead > bandHi);

  const dateEditable = canUnlockDate || dateUnlocked;

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    start(async () => {
      const res = await saveWeighing(fd);
      if (res.ok) {
        setMsg({ kind: "ok", text: `Saved ${res.crateNo} · ${kg(res.netKg)} kg` });
        setWeight("");
        weightRef.current?.focus();
        if (autoPrint && res.crateNo) window.setTimeout(() => window.print(), 150);
      } else {
        setMsg({ kind: "err", text: res.error ?? "Could not save." });
      }
    });
  }

  return (
    <form onSubmit={submit} className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-5 flex items-center gap-2">
        <span className="text-xl">🐔</span>
        <h2 className="text-lg font-semibold text-slate-900">Weighing Entry</h2>
      </div>

      {/* Label controls */}
      <div className="no-print mb-5 flex flex-wrap items-center gap-5 text-sm">
        <label className="flex items-center gap-2">
          <span className="text-slate-500">Label size</span>
          <select
            name="labelSize"
            defaultValue={labelSize}
            className="rounded-lg border-0 px-2.5 py-1.5 text-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-brand-500"
          >
            <option value="5x3">5 × 3 in</option>
            <option value="4x2">4 × 2 in</option>
            <option value="4x6">4 × 6 in</option>
          </select>
        </label>
        <Toggle label="Fill space" defaultOn={fillSpace} name="fillSpace" />
        <Toggle label="Auto-print" defaultOn={autoPrint} name="autoPrint" />
      </div>

      {/* Live scale */}
      <div className="mb-6 rounded-lg bg-slate-100 px-6 py-8 text-center">
        <div className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">
          Live weight from scale
        </div>
        <div className="mt-2 text-5xl font-bold tabnum text-slate-800">
          {liveWeight != null ? liveWeight.toFixed(2) : "--"}{" "}
          <span className="text-3xl">kg</span>
        </div>
        <div className="mt-1 text-xs text-slate-400">
          {scaleStatus === "live"
            ? "Scale connected"
            : scaleStatus === "manual"
              ? "Manual entry — no scale configured"
              : scaleStatus === "connecting"
                ? "Waiting for scale…"
                : "Scale offline — key the weight below"}
        </div>
      </div>

      {/* Row 1 */}
      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <div>
          <label className="mb-1.5 block text-sm font-semibold text-slate-700">
            Production Date
          </label>
          <input
            type="date"
            name="productionDate"
            value={productionDate}
            max={maxDate}
            disabled={!dateEditable}
            onChange={(e) => setProductionDate(e.target.value)}
            className="w-full rounded-lg border-0 px-3 py-2 text-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-brand-500 disabled:bg-slate-50 disabled:text-slate-500"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                dateEditable
                  ? "bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-200"
                  : "bg-slate-100 text-slate-500 ring-1 ring-inset ring-slate-200"
              }`}
            >
              🔒 {dateEditable ? "Editable" : "Locked"}
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-400">can set up to tomorrow</p>
          {!canUnlockDate && (
            <button
              type="button"
              onClick={() => setDateUnlocked((v) => !v)}
              disabled
              title="Requires the 'Unlock production date' permission"
              className="mt-2 rounded-lg border border-slate-300 px-2.5 py-1 text-xs text-slate-400"
            >
              Unlock operators
            </button>
          )}
          {canUnlockDate && (
            <button
              type="button"
              onClick={() => setDateUnlocked((v) => !v)}
              className="mt-2 rounded-lg border border-brand-300 px-2.5 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50"
            >
              {dateUnlocked ? "Lock operators" : "Unlock operators"}
            </button>
          )}
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-semibold text-slate-700">Class / Band</label>
          <select
            value={classCode}
            onChange={(e) => setClassCode(e.target.value)}
            className="w-full rounded-lg border-0 px-3 py-2 text-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-brand-500"
          >
            {classes.map((c) => (
              <option key={c.id} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-semibold text-slate-700">SKU (band)</label>
          <select
            name="productId"
            value={productId ?? ""}
            onChange={(e) => setProductId(Number(e.target.value))}
            className="w-full rounded-lg border-0 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-900 ring-1 ring-inset ring-emerald-300 focus:ring-2 focus:ring-brand-500"
          >
            {banded.map((p) => (
              <option key={p.id} value={p.id}>
                {p.band_code} · {Number(p.band_min_kg).toFixed(2)}-{Number(p.band_max_kg).toFixed(2)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Row 2 */}
      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <div>
          <label className="mb-1.5 block text-sm font-semibold text-slate-700">Weight (kg)</label>
          <input
            ref={weightRef}
            name="weightKg"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            inputMode="decimal"
            required
            autoFocus
            placeholder="0.00"
            className="w-full rounded-lg border-0 px-3 py-2 text-sm tabnum ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-brand-500"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-semibold text-slate-700">Crate Type</label>
          <select
            name="crateTypeId"
            value={crateTypeId}
            onChange={(e) => {
              const id = Number(e.target.value);
              setCrateTypeId(id);
              const ct = crateTypes.find((c) => c.id === id);
              if (ct?.default_heads) setHeads(String(ct.default_heads));
            }}
            className="w-full rounded-lg border-0 px-3 py-2 text-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-brand-500"
          >
            {crateTypes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {Number(c.tare_kg) > 0 ? ` (tare ${c.tare_kg} kg)` : ""}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-semibold text-slate-700">Heads</label>
          <input
            name="heads"
            value={heads}
            onChange={(e) => setHeads(e.target.value)}
            inputMode="numeric"
            required
            className="w-full rounded-lg border-0 px-3 py-2 text-sm tabnum ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-brand-500"
          />
        </div>
      </div>

      {/* Derived figures */}
      {net > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-1 rounded-lg bg-slate-50 px-4 py-2.5 text-sm">
          <span className="text-slate-500">
            Net <strong className="tabnum text-slate-800">{kg(net)} kg</strong>
            {tare > 0 && <span className="ml-1 text-xs text-slate-400">(tare {tare})</span>}
          </span>
          <span className="text-slate-500">
            Per head{" "}
            <strong className={`tabnum ${outOfBand ? "text-rose-600" : "text-slate-800"}`}>
              {perHead.toFixed(3)} kg
            </strong>
          </span>
          {outOfBand && (
            <span className="text-xs font-medium text-rose-600">
              ⚠ Outside band {bandLo.toFixed(2)}–{bandHi.toFixed(2)} — check the SKU
            </span>
          )}
        </div>
      )}

      {msg && (
        <div
          className={`mb-4 rounded-lg px-3 py-2 text-sm ring-1 ring-inset ${
            msg.kind === "ok"
              ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
              : "bg-rose-50 text-rose-700 ring-rose-200"
          }`}
        >
          {msg.text}
        </div>
      )}

      <button
        type="submit"
        disabled={pending || !productId}
        className="w-full rounded-lg bg-blue-600 px-4 py-3.5 text-base font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-60"
      >
        {pending ? "Saving…" : "💾 Save & Log"}
      </button>
    </form>
  );
}

function Toggle({
  label,
  defaultOn,
  name,
}: {
  label: string;
  defaultOn: boolean;
  name: string;
}) {
  const [on, setOn] = useState(defaultOn);
  return (
    <label className="flex cursor-pointer items-center gap-2">
      <span className="text-slate-500">{label}</span>
      <input type="checkbox" name={name} checked={on} onChange={() => setOn(!on)} className="sr-only" />
      <span
        className={`relative h-6 w-11 rounded-full transition ${on ? "bg-emerald-500" : "bg-slate-300"}`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
            on ? "left-[22px]" : "left-0.5"
          }`}
        />
      </span>
    </label>
  );
}
