import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { sb, rpc, type RpcResult } from "./supabase";
import QRCode from "qrcode";
import { useSession } from "./session";
import {
  Card, StatCard, Badge, Field, Button, Spinner, ErrorBox,
  DataTable, PageHeader, inputClass, type Column,
} from "./ui";
import { kg, num, dateStr, dateTimeStr, relTime } from "./format";
import { CRATE_STATUS_LABEL, CRATE_STATUS_TONE } from "./nav";

/** Small data-loading hook so every screen handles loading and errors alike. */
function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const run = useCallback(() => {
    setLoading(true);
    fn()
      .then((d) => { setData(d); setError(null); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => { run(); }, [run]);
  return { data, error, loading, reload: run };
}

/* ------------------------------------------------------------------ Dashboard */

export function Dashboard() {
  const { profile } = useSession();

  const { data, error, loading } = useLoad(async () => {
    const [statusRes, todayRes, movesRes, roomsRes] = await Promise.all([
      sb().from("crates").select("status, net_weight_kg").eq("is_voided", false),
      sb().from("crates").select("heads, net_weight_kg")
        .eq("production_date", new Date().toISOString().slice(0, 10)).eq("is_voided", false),
      sb().from("crate_movements")
        .select("from_status, to_status, occurred_at, crates(crate_no)")
        .order("occurred_at", { ascending: false }).limit(10),
      sb().from("storage_rooms").select("id, name, capacity_pallets, is_available").eq("is_active", true),
    ]);
    if (statusRes.error) throw new Error(statusRes.error.message);

    const byStatus = new Map<string, { n: number; wt: number }>();
    for (const c of statusRes.data ?? []) {
      const cur = byStatus.get(c.status) ?? { n: 0, wt: 0 };
      cur.n += 1; cur.wt += Number(c.net_weight_kg ?? 0);
      byStatus.set(c.status, cur);
    }
    const today = (todayRes.data ?? []).reduce(
      (a, c) => ({ n: a.n + 1, heads: a.heads + Number(c.heads ?? 0), wt: a.wt + Number(c.net_weight_kg ?? 0) }),
      { n: 0, heads: 0, wt: 0 }
    );
    return { byStatus, today, moves: movesRes.data ?? [], rooms: roomsRes.data ?? [] };
  }, []);

  if (loading) return <Spinner />;
  if (error) return <ErrorBox message={error} />;
  if (!data) return null;

  const order = ["production","warehouse","storage","cutting","issued_to_fps","fps_processed","wh_received_cut","picked","dispatched"];
  const onHand = ["warehouse","storage","wh_received_cut","fps_processed"]
    .reduce((s, k) => s + (data.byStatus.get(k)?.wt ?? 0), 0);

  return (
    <>
      <PageHeader
        title={`Welcome back, ${profile?.fullName?.split(" ")[0] ?? ""}`}
        subtitle={`${dateStr(new Date())} · ${profile?.roleName ?? ""}`}
      />

      <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-400">Today</h2>
      <div className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Crates Produced" value={num(data.today.n)} tone="brand" />
        <StatCard label="Heads Processed" value={num(data.today.heads)} />
        <StatCard label="Production Weight" value={`${kg(data.today.wt)} kg`} tone="blue" />
        <StatCard label="Stock on Hand" value={`${kg(onHand)} kg`} tone="green" />
      </div>

      <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-400">Crate Status Breakdown</h2>
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {order.map((s) => (
          <StatCard key={s} label={CRATE_STATUS_LABEL[s]} value={num(data.byStatus.get(s)?.n ?? 0)}
            hint={`${kg(data.byStatus.get(s)?.wt ?? 0)} kg`} tone={CRATE_STATUS_TONE[s] ?? "slate"} />
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Recent Crate Activity" padded={false}>
          {data.moves.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-slate-400">No crate movements yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.moves.map((m, i) => (
                <li key={i} className="flex items-center justify-between gap-4 px-5 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-sm">
                      <span className="text-slate-500">{m.from_status ? CRATE_STATUS_LABEL[m.from_status] : "New"}</span>
                      <span className="text-slate-300">→</span>
                      <span className="font-medium text-slate-800">{m.to_status ? CRATE_STATUS_LABEL[m.to_status] : "—"}</span>
                    </div>
                    <div className="mt-0.5 truncate text-xs text-slate-400">
                      {(m.crates as { crate_no?: string } | null)?.crate_no ?? ""}
                    </div>
                  </div>
                  <span className="shrink-0 text-xs text-slate-400">{relTime(m.occurred_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Storage Rooms" padded={false}>
          <ul className="divide-y divide-slate-100">
            {data.rooms.map((r) => (
              <li key={r.id} className="flex items-center justify-between px-5 py-3 text-sm">
                <span className="text-slate-700">{r.name}</span>
                <span className="flex items-center gap-2">
                  <span className="tabnum text-xs text-slate-500">{r.capacity_pallets} slots</span>
                  <Badge tone={r.is_available ? "green" : "slate"}>{r.is_available ? "ON" : "OFF"}</Badge>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}

/* -------------------------------------------------------------- Weighing Entry */

type BandProduct = { id: number; sku: string; band_code: string | null; band_min_kg: string | null; band_max_kg: string | null; class_id: number | null };
type CrateType = { id: number; name: string; tare_kg: string; default_heads: number | null };
type ClassRow = { id: number; code: string; name: string };

export function WeighingEntry() {
  const { can, profile } = useSession();
  const today = new Date().toISOString().slice(0, 10);
  // "Today's records" means transactions WEIGHED today by this operator —
  // not every crate whose production date is today. Backfilled or imported
  // records must not appear here.
  const dayStart = useMemo(() => {
    const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString();
  }, []);

  const { data, error, loading } = useLoad(async () => {
    const [cls, prods, types, settings] = await Promise.all([
      sb().from("product_classes").select("id, code, name").eq("is_active", true).order("sort_order"),
      sb().from("products").select("id, sku, band_code, band_min_kg, band_max_kg, class_id")
        .not("band_code", "is", null).eq("is_active", true).order("sort_order"),
      sb().from("crate_types").select("id, name, tare_kg, default_heads").eq("is_active", true).order("sort_order"),
      sb().from("app_settings").select("key, value").eq("scope", "global")
        .in("key", ["weighing.operators_can_edit_date", "weighing.future_days"]),
    ]);
    if (prods.error) throw new Error(prods.error.message);
    const setting = (k: string) =>
      (settings.data ?? []).find((s) => (s as { key?: string }).key === k) as { value?: unknown } | undefined;
    return {
      classes: (cls.data ?? []) as ClassRow[],
      products: (prods.data ?? []) as BandProduct[],
      crateTypes: (types.data ?? []) as CrateType[],
      dateEditable: Boolean(setting("weighing.operators_can_edit_date")?.value ?? false),
      futureDays: Number(setting("weighing.future_days")?.value ?? 1),
    };
  }, []);

  const [classId, setClassId] = useState<number | null>(null);
  const [productId, setProductId] = useState<number | null>(null);
  const [crateTypeId, setCrateTypeId] = useState<number | null>(null);
  const [weight, setWeight] = useState("");
  const [heads, setHeads] = useState("15");
  const [prodDate, setProdDate] = useState(today);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [dateEditable, setDateEditable] = useState<boolean | null>(null);

  // Print controls from the live screen: label size, fill space, auto-print.
  const [labelSize, setLabelSize] = useState("5x3");
  const [fillSpace, setFillSpace] = useState(false);
  const [autoPrint, setAutoPrint] = useState(true);

  // Today's records panel: search / SKU filter / multi-select delete.
  const [recSearch, setRecSearch] = useState("");
  const [recSku, setRecSku] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());

  type Rec = { id: number; crate_no: string; sku: string; heads: number | null; net_weight_kg: string; weighed_at: string };
  const [records, setRecords] = useState<Rec[]>([]);
  const weightRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!data) return;
    setClassId((c) => c ?? data.classes[0]?.id ?? null);
    setCrateTypeId((c) => c ?? data.crateTypes[0]?.id ?? null);
    setDateEditable((v) => v ?? data.dateEditable);
  }, [data]);

  const banded = useMemo(
    () => (data?.products ?? []).filter((p) => p.class_id === classId),
    [data, classId]
  );
  useEffect(() => {
    if (banded.length && !banded.some((p) => p.id === productId)) setProductId(banded[0].id);
  }, [banded, productId]);

  const loadRecords = useCallback(async () => {
    let q = sb()
      .from("crates")
      .select("id, crate_no, heads, net_weight_kg, weighed_at, products(sku)")
      .gte("weighed_at", dayStart).eq("is_voided", false)
      .order("weighed_at", { ascending: false }).limit(200);
    if (profile?.id) q = q.eq("weighed_by", profile.id);
    const { data: rows } = await q;
    setRecords((rows ?? []).map((r) => ({
      id: r.id as number, crate_no: r.crate_no as string,
      sku: (r.products as { sku?: string } | null)?.sku ?? "",
      heads: r.heads as number | null,
      net_weight_kg: r.net_weight_kg as string,
      weighed_at: r.weighed_at as string,
    })));
    setSelected(new Set());
  }, [dayStart, profile?.id]);

  useEffect(() => { void loadRecords(); }, [loadRecords]);

  if (loading) return <Spinner />;
  if (error) return <ErrorBox message={error} />;
  if (!data) return null;

  const selectedProduct = banded.find((p) => p.id === productId);
  const crateType = data.crateTypes.find((c) => c.id === crateTypeId);
  const tare = Number(crateType?.tare_kg ?? 0);
  const net = weight ? Math.max(0, Number(weight) - tare) : 0;
  const headCount = Number(heads) || 0;
  const perHead = headCount > 0 && net > 0 ? net / headCount : 0;
  const lo = Number(selectedProduct?.band_min_kg ?? 0);
  const hi = Number(selectedProduct?.band_max_kg ?? 0);
  const outOfBand = perHead > 0 && lo > 0 && hi > 0 && (perHead < lo || perHead > hi);

  /** Browser-print labels. Sizes follow the live dropdown (inches). */
  async function printLabels(list: Array<{ crate_no: string; sku: string; net_weight_kg: string; heads: number | null }>) {
    if (!list.length) return;
    const [w, h] = labelSize.split("x").map(Number);
    // Every weighing generates a QR code — the label carries it so the scan
    // stations can read the crate straight off the printout.
    const qrs = await Promise.all(list.map((r) =>
      QRCode.toDataURL(r.crate_no, { margin: 0, width: 220 }).catch(() => "")));
    const win = window.open("", "_blank", "width=480,height=640");
    if (!win) return;
    win.document.write(`<!doctype html><html><head><title>Labels</title><style>
      @page { size: ${w}in ${h}in; margin: 0; }
      body { margin: 0; font-family: ui-sans-serif, system-ui, sans-serif; }
      .label { width: ${w}in; height: ${h}in; padding: 0.15in; box-sizing: border-box;
               display: flex; flex-direction: column; justify-content: ${fillSpace ? "space-between" : "flex-start"};
               page-break-after: always; }
      .top { display: flex; justify-content: space-between; align-items: flex-start; gap: 0.1in; }
      .qr { width: ${Math.min(w, h) * 0.42}in; height: ${Math.min(w, h) * 0.42}in; }
      .crate { font-size: ${w >= 4 ? "20pt" : "14pt"}; font-weight: 700; letter-spacing: 0.5px; }
      .row { font-size: ${w >= 4 ? "16pt" : "11pt"}; margin-top: 0.06in; }
      .big { font-size: ${w >= 4 ? "28pt" : "18pt"}; font-weight: 700; }
    </style></head><body>` +
      list.map((r, i) => `<div class="label">
        <div class="top">
          <div>
            <div class="crate">${r.crate_no}</div>
            <div class="row">SKU <b>${r.sku}</b> · Heads <b>${r.heads ?? ""}</b></div>
            <div class="big">${Number(r.net_weight_kg).toFixed(2)} kg</div>
          </div>
          ${qrs[i] ? `<img class="qr" src="${qrs[i]}" alt="QR ${r.crate_no}" />` : ""}
        </div>
        <div class="row">${new Date().toLocaleString("en-PH")}</div>
      </div>`).join("") + "</body></html>");
    win.document.close();
    win.focus();
    win.print();
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!productId || !crateTypeId) return;
    setSaving(true);
    const res = await rpc<RpcResult>("rpc_save_weighing", {
      p_product_id: productId,
      p_crate_type_id: crateTypeId,
      p_production_date: prodDate,
      p_weight_kg: Number(weight),
      p_heads: Number(heads),
    });
    setSaving(false);
    setMsg({ ok: res.ok, text: res.ok ? `Saved ${res.crateNo} · ${kg(res.netKg as number)} kg` : res.message });
    if (res.ok) {
      if (autoPrint && res.crateNo) {
        void printLabels([{ crate_no: String(res.crateNo), sku: selectedProduct?.band_code ?? "",
          net_weight_kg: String(res.netKg ?? net), heads: headCount }]);
      }
      setWeight(""); weightRef.current?.focus(); void loadRecords();
    }
  }

  async function toggleUnlock() {
    const next = !dateEditable;
    const r = await rpc<RpcResult>("rpc_set_weighing_date_unlock", { p_unlocked: next });
    setMsg({ ok: Boolean(r.ok), text: String(r.message ?? "") });
    if (r.ok) setDateEditable(next);
  }

  async function deleteSelected() {
    if (!selected.size) return;
    let okCount = 0; let firstErr = "";
    for (const id of selected) {
      const r = await rpc<RpcResult>("rpc_delete_weighing", { p_crate_id: id });
      if (r.ok) okCount += 1; else if (!firstErr) firstErr = r.message;
    }
    setMsg({ ok: okCount > 0, text: firstErr && okCount === 0 ? firstErr : `Deleted ${okCount} record(s).` });
    void loadRecords();
  }

  const shown = records.filter((r) =>
    (!recSku || r.sku === recSku) &&
    (!recSearch.trim() || r.crate_no.toLowerCase().includes(recSearch.trim().toLowerCase())));
  const skus = [...new Set(records.map((r) => r.sku))].sort();
  const totalWeight = records.reduce((a, r) => a + Number(r.net_weight_kg), 0);
  const allShownSelected = shown.length > 0 && shown.every((r) => selected.has(r.id));

  const toggleStyles = (on: boolean) =>
    `relative inline-flex h-5 w-9 cursor-pointer items-center rounded-full transition ${on ? "bg-emerald-500" : "bg-slate-300"}`;

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <form onSubmit={save} className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-3 flex items-center gap-2">
          <span className="text-xl">🐔</span>
          <h2 className="text-lg font-semibold text-slate-900">Weighing Entry</h2>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <label className="flex items-center gap-2 text-slate-600">
            Label size
            <select className={`${inputClass} !w-28 !py-1`} value={labelSize} onChange={(e) => setLabelSize(e.target.value)}>
              <option value="5x3">5 × 3 in</option><option value="4x3">4 × 3 in</option>
              <option value="4x2">4 × 2 in</option><option value="3x2">3 × 2 in</option>
              <option value="2x2">2 × 2 in</option><option value="4x6">4 × 6 in</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-slate-600">
            Fill space
            <button type="button" className={toggleStyles(fillSpace)} onClick={() => setFillSpace((v) => !v)}>
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition ${fillSpace ? "translate-x-4" : "translate-x-0.5"}`} />
            </button>
          </label>
          <label className="flex items-center gap-2 text-slate-600">
            Auto-print
            <button type="button" className={toggleStyles(autoPrint)} onClick={() => setAutoPrint((v) => !v)}>
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition ${autoPrint ? "translate-x-4" : "translate-x-0.5"}`} />
            </button>
          </label>
        </div>

        <div className="mb-6 rounded-lg bg-slate-100 px-6 py-8 text-center">
          <div className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">Live weight from scale</div>
          <div className="mt-2 text-5xl font-bold tabnum text-slate-800">-- <span className="text-3xl">kg</span></div>
          <div className="mt-1 text-xs text-slate-400">Waiting for scale…</div>
        </div>

        <div className="mb-5 grid gap-4 sm:grid-cols-3">
          <div>
            <Field label="Production Date">
              <input type="date" className={inputClass} value={prodDate} onChange={(e) => setProdDate(e.target.value)} />
            </Field>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${dateEditable ? "bg-sky-100 text-sky-700" : "bg-slate-200 text-slate-600"}`}>
                {dateEditable ? "🔓 Editable" : "🔒 Locked to today"}
              </span>
              <span className="text-[11px] text-slate-400">can set up to {data.futureDays === 1 ? "tomorrow" : `${data.futureDays} days ahead`}</span>
            </div>
            {can("bd.weighing.unlock_date") && (
              <button type="button" onClick={() => void toggleUnlock()}
                className="mt-1.5 rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50">
                {dateEditable ? "Lock operators" : "Unlock operators"}
              </button>
            )}
          </div>
          <Field label="Class / Band">
            <select className={inputClass} value={classId ?? ""} onChange={(e) => setClassId(Number(e.target.value))}>
              {data.classes.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
            </select>
          </Field>
          <Field label="SKU (band)">
            <select className={`${inputClass} bg-emerald-50 font-medium text-emerald-900 ring-emerald-300`}
              value={productId ?? ""} onChange={(e) => setProductId(Number(e.target.value))}>
              {banded.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.band_code} · {Number(p.band_min_kg).toFixed(2)}-{Number(p.band_max_kg).toFixed(2)}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="mb-5 grid gap-4 sm:grid-cols-3">
          <Field label="Weight (kg)">
            <input ref={weightRef} className={`${inputClass} tabnum`} value={weight} inputMode="decimal"
              required autoFocus placeholder="0.00" onChange={(e) => setWeight(e.target.value)} />
          </Field>
          <Field label="Crate Type">
            <select className={inputClass} value={crateTypeId ?? ""} onChange={(e) => {
              const id = Number(e.target.value); setCrateTypeId(id);
              const ct = data.crateTypes.find((c) => c.id === id);
              if (ct?.default_heads) setHeads(String(ct.default_heads));
            }}>
              {data.crateTypes.map((c) => (
                <option key={c.id} value={c.id}>{c.name}{Number(c.tare_kg) > 0 ? ` (tare ${c.tare_kg} kg)` : ""}</option>
              ))}
            </select>
          </Field>
          <Field label="Heads">
            <input className={`${inputClass} tabnum`} value={heads} inputMode="numeric" required
              onChange={(e) => setHeads(e.target.value)} />
          </Field>
        </div>

        {net > 0 && (
          <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-1 rounded-lg bg-slate-50 px-4 py-2.5 text-sm">
            <span className="text-slate-500">Net <strong className="tabnum text-slate-800">{kg(net)} kg</strong></span>
            <span className="text-slate-500">
              Per head <strong className={`tabnum ${outOfBand ? "text-rose-600" : "text-slate-800"}`}>{perHead.toFixed(3)} kg</strong>
            </span>
            {outOfBand && (
              <span className="text-xs font-medium text-rose-600">
                ⚠ Outside band {lo.toFixed(2)}–{hi.toFixed(2)} — check the SKU
              </span>
            )}
          </div>
        )}

        {msg && (
          <div className={`mb-4 rounded-lg px-3 py-2 text-sm ring-1 ring-inset ${msg.ok ? "bg-emerald-50 text-emerald-800 ring-emerald-200" : "bg-rose-50 text-rose-700 ring-rose-200"}`}>
            {msg.text}
          </div>
        )}

        <button type="submit" disabled={saving || !can("bd.weighing.manage")}
          title={can("bd.weighing.manage") ? undefined : "You don't have permission to record weighings"}
          className="w-full rounded-lg bg-blue-600 px-4 py-3.5 text-base font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-60">
          {saving ? "Saving…" : "💾 Save & Log"}
        </button>
      </form>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-slate-900">Today's records</h2>
            <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-600">
              <span className="h-2 w-2 rounded-full bg-emerald-500" /> Live
            </span>
          </div>
          <p className="mt-0.5 text-xs text-slate-500">{num(records.length)} record(s) · {kg(totalWeight, 3)} kg total</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input className={`${inputClass} !w-44`} placeholder="🔍 Search / scan crate…" value={recSearch}
              onChange={(e) => setRecSearch(e.target.value)} />
            <select className={`${inputClass} !w-32`} value={recSku} onChange={(e) => setRecSku(e.target.value)}>
              <option value="">All SKUs</option>
              {skus.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <button type="button" disabled={shown.length === 0}
              onClick={() => void printLabels(shown)}
              className="rounded-lg bg-emerald-100 px-3 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-200 disabled:opacity-50">
              🖨 Print All
            </button>
            <button type="button" disabled={selected.size === 0 || !can("bd.weighing.delete")}
              onClick={() => void deleteSelected()}
              className="rounded-lg bg-rose-100 px-3 py-2 text-sm font-medium text-rose-700 hover:bg-rose-200 disabled:opacity-50">
              🗑 Delete ({selected.size})
            </button>
          </div>
        </div>
        <div className="thin-scroll max-h-[520px] overflow-y-auto">
          <DataTable
            rows={shown as unknown as Array<Record<string, unknown>>}
            rowKey={(r) => String(r.id)}
            empty="No records yet today — save a weight to start logging."
            columns={[
              {
                key: "_sel",
                header: "",
                render: (r) => (
                  <input type="checkbox" checked={selected.has(Number(r.id))}
                    onChange={(e) => setSelected((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(Number(r.id)); else next.delete(Number(r.id));
                      return next;
                    })} />
                ),
              },
              { key: "crate_no", header: "Crate", render: (r) => <span className="font-mono text-xs">{String(r.crate_no)}</span> },
              { key: "sku", header: "SKU" },
              { key: "heads", header: "Heads", align: "right" },
              { key: "net_weight_kg", header: "Net kg", align: "right", render: (r) => kg(r.net_weight_kg as string) },
              { key: "weighed_at", header: "Time", align: "right", render: (r) => new Date(String(r.weighed_at)).toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" }) },
            ] as Column<Record<string, unknown>>[]}
          />
        </div>
        {shown.length > 0 && (
          <div className="border-t border-slate-200 px-5 py-2">
            <label className="flex items-center gap-2 text-xs text-slate-500">
              <input type="checkbox" checked={allShownSelected}
                onChange={(e) => setSelected(e.target.checked ? new Set(shown.map((r) => r.id)) : new Set())} />
              Select all shown
            </label>
          </div>
        )}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- Scan Station */

export function ScanStation() {
  const [code, setCode] = useState("");
  const [log, setLog] = useState<Array<RpcResult & { at: number }>>([]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setInterval(() => {
      if (document.activeElement?.tagName !== "INPUT") inputRef.current?.focus();
    }, 1200);
    return () => clearInterval(t);
  }, []);

  async function scan(e: React.FormEvent) {
    e.preventDefault();
    const value = code.trim();
    if (!value) return;
    setBusy(true);
    const res = await rpc<RpcResult>("rpc_move_crate", {
      p_crate_no: value,
      p_to_status: "warehouse",
      p_permission: "bd.scan.use",
      p_expect_from: ["production"],
      p_module: "Basic Dressing",
    });
    setBusy(false);
    setLog((prev) => [{ ...res, at: Date.now() }, ...prev].slice(0, 200));
    setCode("");
    inputRef.current?.focus();
  }

  const ok = log.filter((l) => l.ok).length;
  const bad = log.length - ok;
  const wt = log.filter((l) => l.ok).reduce((s, l) => s + Number(l.weightKg ?? 0), 0);
  const last = log[0];

  return (
    <>
      <PageHeader title="BD Scan Station"
        subtitle="Scan crates off the dressing line to receive them into the warehouse." />
      <div className="grid gap-6 xl:grid-cols-2">
        <form onSubmit={scan} className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">Receive into warehouse</h2>
          <p className="mt-1 text-sm text-slate-500">
            The lifecycle is enforced in the database, so an out-of-order scan is refused.
          </p>
          <div className="mt-5">
            <label className="mb-1.5 block text-sm font-semibold text-slate-700">Scan crate barcode</label>
            <input ref={inputRef} value={code} autoFocus placeholder="PMAI-20260813-0001-P1"
              onChange={(e) => setCode(e.target.value)}
              className="w-full rounded-lg border-0 px-4 py-4 text-center font-mono text-lg tracking-wider ring-2 ring-inset ring-slate-300 focus:ring-brand-500" />
          </div>
          <button type="submit" disabled={busy || !code.trim()}
            className="mt-4 w-full rounded-lg bg-brand-600 px-4 py-3 text-base font-semibold text-white shadow-sm hover:bg-brand-700 disabled:opacity-50">
            {busy ? "Working…" : "Receive crate"}
          </button>

          {last && (
            <div className={`mt-5 rounded-xl px-5 py-4 ring-1 ring-inset ${last.ok ? "bg-emerald-50 text-emerald-900 ring-emerald-200" : "bg-rose-50 text-rose-900 ring-rose-200"}`}>
              <div className="flex items-center gap-2 text-base font-semibold">
                <span>{last.ok ? "✓" : "✕"}</span><span>{last.message}</span>
              </div>
              {last.crateNo && (
                <div className="mt-1 font-mono text-xs opacity-70">
                  {last.crateNo}{last.sku ? ` · ${last.sku}` : ""}{last.weightKg ? ` · ${kg(last.weightKg)} kg` : ""}
                </div>
              )}
            </div>
          )}
        </form>

        <Card title="This session">
          <div className="mb-4 grid grid-cols-3 gap-3">
            <div className="rounded-lg bg-emerald-50 px-3 py-2.5 text-center">
              <div className="text-2xl font-semibold tabnum text-emerald-700">{num(ok)}</div>
              <div className="text-[11px] uppercase tracking-wide text-emerald-600">Accepted</div>
            </div>
            <div className="rounded-lg bg-rose-50 px-3 py-2.5 text-center">
              <div className="text-2xl font-semibold tabnum text-rose-700">{num(bad)}</div>
              <div className="text-[11px] uppercase tracking-wide text-rose-600">Rejected</div>
            </div>
            <div className="rounded-lg bg-slate-100 px-3 py-2.5 text-center">
              <div className="text-2xl font-semibold tabnum text-slate-700">{kg(wt)}</div>
              <div className="text-[11px] uppercase tracking-wide text-slate-500">kg scanned</div>
            </div>
          </div>
          <div className="thin-scroll max-h-[420px] overflow-y-auto rounded-lg border border-slate-200">
            {log.length === 0 ? (
              <p className="px-4 py-16 text-center text-sm text-slate-400">Nothing scanned yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {log.map((l, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-sm">
                        <span className={l.ok ? "text-emerald-600" : "text-rose-600"}>{l.ok ? "✓" : "✕"}</span>
                        <span className="truncate text-slate-700">{l.message}</span>
                      </div>
                      {l.crateNo && <div className="truncate font-mono text-[11px] text-slate-400">{l.crateNo}</div>}
                    </div>
                    <span className="shrink-0 text-xs tabnum text-slate-400">{l.weightKg ? `${kg(l.weightKg)} kg` : ""}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>
    </>
  );
}

/* --------------------------------------------------------------- Storage Map */

export function StorageMap() {
  const [roomId, setRoomId] = useState<number | null>(null);
  const { data, error, loading } = useLoad(async () => {
    const { data: rooms, error: e1 } = await sb()
      .from("storage_rooms").select("id, code, name, kind, room_no, is_available, capacity_pallets")
      .eq("is_active", true).order("sort_order");
    if (e1) throw new Error(e1.message);
    return rooms ?? [];
  }, []);

  useEffect(() => { if (data?.length && roomId === null) setRoomId(data[0].id); }, [data, roomId]);

  const slots = useLoad(async () => {
    if (!roomId) return [];
    const { data: rows, error: e } = await sb()
      .from("v_storage_map")
      .select("aisle_code, aisle_side, aisle_row, location_id, slot_code, level_no, deep_no, is_occupied, pallet_no, crate_count, total_weight_kg")
      .eq("room_id", roomId);
    if (e) throw new Error(e.message);
    return rows ?? [];
  }, [roomId]);

  if (loading) return <Spinner />;
  if (error) return <ErrorBox message={error} />;
  const room = (data ?? []).find((r) => r.id === roomId);

  const rows = new Map<number, { left?: typeof group; right?: typeof group }>();
  type Group = { code: string; side: string; row: number; slots: Array<Record<string, unknown>> };
  let group: Group;
  const aisles = new Map<string, Group>();
  for (const s of (slots.data ?? []) as Array<Record<string, unknown>>) {
    const key = String(s.aisle_code);
    if (!aisles.has(key))
      aisles.set(key, { code: key, side: String(s.aisle_side), row: Number(s.aisle_row), slots: [] });
    aisles.get(key)!.slots.push(s);
  }
  for (const a of aisles.values()) {
    if (!rows.has(a.row)) rows.set(a.row, {});
    const e = rows.get(a.row)! as { left?: Group; right?: Group };
    if (a.side === "left") e.left = a; else e.right = a;
  }
  const rowKeys = [...rows.keys()].sort((a, b) => a - b);
  const total = (slots.data ?? []).length;
  const occupied = (slots.data ?? []).filter((s) => (s as Record<string, unknown>).is_occupied).length;

  return (
    <>
      <PageHeader title="Storage Map" subtitle="Slot availability by room · aisle · level · deep" />

      <Card className="mb-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <select className={`${inputClass} w-auto font-medium`} value={roomId ?? ""}
              onChange={(e) => setRoomId(Number(e.target.value))}>
              {(data ?? []).map((r) => (<option key={r.id} value={r.id}>{r.name}</option>))}
            </select>
            <Badge tone="blue">❄ {room?.kind?.replace(/_/g, " ")}</Badge>
            <Badge tone={room?.is_available ? "green" : "slate"}>{room?.is_available ? "ON" : "OFF"}</Badge>
          </div>
          <div className="flex items-center gap-5 text-sm">
            <span className="text-slate-500">Available <strong className="tabnum text-emerald-600">{num(total - occupied)}</strong> / {num(total)}</span>
            <span className="text-slate-500">Occupied <strong className="tabnum text-slate-800">{num(occupied)}</strong></span>
          </div>
        </div>
      </Card>

      <Card>
        {!room?.is_available && (
          <div className="mb-5 rounded-lg bg-slate-100 px-4 py-3 text-sm text-slate-600">
            This room is <strong>OFF</strong> — not available for putting pallets away.
          </div>
        )}
        <p className="mb-6 rounded-lg bg-slate-50 px-4 py-3 text-xs leading-relaxed text-slate-600">
          <strong>How to read this:</strong> each grid is one aisle drawn as a schematic.
          <br />↕ <strong>Rows = Level</strong> (top row = highest) · ↔ <strong>Columns = Deep</strong>
          (column 1 = front, where the forklift loads).
        </p>

        {slots.loading ? <Spinner /> : (
          <div className="space-y-8">
            {rowKeys.map((rk) => {
              const pair = rows.get(rk)!;
              return (
                <div key={rk} className="flex items-start justify-center">
                  <AisleGrid aisle={pair.left as Group | undefined} />
                  <div className="mx-4 flex h-40 w-8 items-center justify-center self-center">
                    <span className="rotate-90 whitespace-nowrap text-[9px] font-semibold uppercase tracking-[0.2em] text-slate-300">Aisle</span>
                  </div>
                  <AisleGrid aisle={pair.right as Group | undefined} />
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </>
  );
}

function AisleGrid({ aisle }: { aisle?: { code: string; slots: Array<Record<string, unknown>> } }) {
  if (!aisle) return <div className="w-[220px]" />;
  const free = aisle.slots.filter((s) => !s.is_occupied).length;
  const maxLevel = Math.max(...aisle.slots.map((s) => Number(s.level_no)), 1);
  const maxDeep = Math.max(...aisle.slots.map((s) => Number(s.deep_no)), 1);
  const byPos = new Map(aisle.slots.map((s) => [`${s.level_no}-${s.deep_no}`, s]));

  return (
    <div className="w-[220px]">
      <div className="text-center">
        <div className="text-base font-semibold text-slate-700">{aisle.code}</div>
        <div className="text-[11px] text-slate-400">{free} free · {maxDeep} deep</div>
      </div>
      <table className="mt-2 w-full border-separate border-spacing-1">
        <tbody>
          {Array.from({ length: maxLevel }, (_, i) => maxLevel - i).map((lv) => (
            <tr key={lv}>
              <td className="w-8 text-[10px] text-slate-400">L{String(lv).padStart(2, "0")}</td>
              {Array.from({ length: maxDeep }, (_, i) => i + 1).map((dp) => {
                const s = byPos.get(`${lv}-${dp}`);
                if (!s) return <td key={dp} />;
                return (
                  <td key={dp}>
                    <div title={s.is_occupied
                      ? `${s.slot_code}\n${s.pallet_no} · ${s.crate_count} crates`
                      : `${s.slot_code} — empty`}
                      className={`flex h-9 w-full items-center justify-center rounded text-xs font-medium ${
                        s.is_occupied ? "bg-slate-300 text-slate-600" : "bg-emerald-200 text-emerald-800"}`}>
                      {String(s.deep_no)}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------- Stock on Hand */

export function StockOnHand() {
  const { data, error, loading } = useLoad(async () => {
    const { data: rows, error: e } = await sb()
      .from("v_stock_on_hand_by_date")
      .select("section, sku, production_date, age_days, crate_count, head_count, total_weight_kg")
      .order("sku");
    if (e) throw new Error(e.message);
    return rows ?? [];
  }, []);

  if (loading) return <Spinner />;
  if (error) return <ErrorBox message={error} />;

  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const dates = [...new Set(rows.map((r) => String(r.production_date)))].sort();
  const ageOf = new Map(rows.map((r) => [String(r.production_date), Number(r.age_days)]));
  const totals = rows.reduce<{ crates: number; heads: number; wt: number }>(
    (a, r) => ({
      crates: a.crates + Number(r.crate_count),
      heads: a.heads + Number(r.head_count),
      wt: a.wt + Number(r.total_weight_kg),
    }), { crates: 0, heads: 0, wt: 0 });

  const bySku = new Map<string, Map<string, Record<string, unknown>>>();
  for (const r of rows) {
    const sku = String(r.sku);
    if (!bySku.has(sku)) bySku.set(sku, new Map());
    bySku.get(sku)!.set(String(r.production_date), r);
  }

  return (
    <>
      <PageHeader title="Stock on Hand"
        subtitle="What's physically in the warehouse, per SKU and production date. Includes basic-dressing crates (in storage/warehouse) and FPS finished goods received back." />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Crates on Hand" value={num(totals.crates)} tone="blue" />
        <StatCard label="Total Heads" value={num(totals.heads)} tone="indigo" />
        <StatCard label="Total Weight" value={`${kg(totals.wt)} kg`} tone="green" />
        <StatCard label="SKUs · Prod. Dates" value={`${bySku.size} · ${dates.length}`} />
      </div>

      <Card padded={false}>
        {rows.length === 0 ? (
          <p className="px-5 py-14 text-center text-sm text-slate-400">
            No stock on hand yet. Weigh and receive crates to populate this report.
          </p>
        ) : (
          <div className="thin-scroll overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr>
                  <th rowSpan={2} className="sticky left-0 z-10 border-b border-r border-slate-200 bg-slate-50 px-4 py-2 text-left text-xs font-semibold uppercase text-slate-600">SKU</th>
                  {dates.map((d) => (
                    <th key={d} colSpan={3} className="border-b border-r border-slate-200 bg-slate-50 px-4 py-2 text-center text-xs font-semibold text-slate-700">
                      {dateStr(d)}<div className="text-emerald-600">Day {ageOf.get(d)}</div>
                    </th>
                  ))}
                </tr>
                <tr className="text-[10px] font-semibold uppercase text-slate-500">
                  {dates.map((d) => (
                    <>
                      <th key={d + "c"} className="border-b border-slate-200 bg-slate-50 px-3 py-1.5 text-right">Crate</th>
                      <th key={d + "h"} className="border-b border-slate-200 bg-slate-50 px-3 py-1.5 text-right">Head</th>
                      <th key={d + "w"} className="border-b border-r border-slate-200 bg-slate-50 px-3 py-1.5 text-right">Weight</th>
                    </>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...bySku.entries()].map(([sku, dateMap]) => (
                  <tr key={sku} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="sticky left-0 z-10 border-r border-slate-200 bg-white px-4 py-2 font-semibold text-slate-800">{sku}</td>
                    {dates.map((d) => {
                      const c = dateMap.get(d);
                      return (
                        <>
                          <td key={d + "c"} className="px-3 py-2 text-right tabnum text-slate-600">{c ? num(c.crate_count as number) : ""}</td>
                          <td key={d + "h"} className="px-3 py-2 text-right tabnum text-slate-600">{c ? num(c.head_count as number) : ""}</td>
                          <td key={d + "w"} className="border-r border-slate-200 px-3 py-2 text-right tabnum text-slate-500">{c ? kg(c.total_weight_kg as string) : ""}</td>
                        </>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

/* --------------------------------------------------------------- Activity log */

export function ActivityLog() {
  const { data, error, loading } = useLoad(async () => {
    const { data: rows, error: e } = await sb()
      .from("activity_logs")
      .select("created_at, module, action, description, users(full_name)")
      .order("created_at", { ascending: false }).limit(300);
    if (e) throw new Error(e.message);
    return rows ?? [];
  }, []);

  if (loading) return <Spinner />;
  if (error) return <ErrorBox message={error} />;

  return (
    <>
      <PageHeader title="User Activity Log" subtitle="Every action recorded in the system." />
      <Card padded={false}>
        <DataTable
          rows={(data ?? []) as unknown as Array<Record<string, unknown>>}
          empty="Nothing logged yet."
          columns={[
            { key: "created_at", header: "When", render: (r) => dateTimeStr(r.created_at as string) },
            { key: "user", header: "User", render: (r) => (r.users as { full_name?: string } | null)?.full_name ?? "—" },
            { key: "module", header: "Module", render: (r) => <Badge>{String(r.module)}</Badge> },
            { key: "action", header: "Action", render: (r) => <Badge tone="blue">{String(r.action)}</Badge> },
            { key: "description", header: "Description" },
          ] as Column<Record<string, unknown>>[]}
        />
      </Card>
    </>
  );
}

/* ------------------------------------------------------------------- Account */

export function Account() {
  const { profile } = useSession();
  const [pw, setPw] = useState({ next: "", confirm: "" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function change(e: React.FormEvent) {
    e.preventDefault();
    if (pw.next !== pw.confirm) { setMsg({ ok: false, text: "The new passwords do not match." }); return; }
    if (pw.next.length < 10) { setMsg({ ok: false, text: "Use at least 10 characters." }); return; }
    setBusy(true);
    const { error } = await sb().auth.updateUser({ password: pw.next });
    setBusy(false);
    setMsg(error ? { ok: false, text: error.message } : { ok: true, text: "Password changed." });
    if (!error) setPw({ next: "", confirm: "" });
  }

  return (
    <>
      <PageHeader title="My Account" subtitle="Your sign-in details and password." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Profile">
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between"><dt className="text-slate-500">Name</dt><dd className="font-medium">{profile?.fullName}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Email</dt><dd>{profile?.email}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Role</dt><dd><Badge tone="blue">{profile?.roleName}</Badge></dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Department</dt><dd>{profile?.department ?? "—"}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Last sign-in</dt><dd>{dateTimeStr(profile?.lastLoginAt)}</dd></div>
          </dl>
        </Card>

        <Card title="Change password">
          <form onSubmit={change} className="max-w-md space-y-4">
            {msg && (
              <div className={`rounded-lg px-3 py-2 text-sm ring-1 ring-inset ${msg.ok ? "bg-emerald-50 text-emerald-800 ring-emerald-200" : "bg-rose-50 text-rose-700 ring-rose-200"}`}>
                {msg.text}
              </div>
            )}
            <Field label="New password" hint="At least 10 characters.">
              <input type="password" className={inputClass} value={pw.next} required
                autoComplete="new-password" onChange={(e) => setPw({ ...pw, next: e.target.value })} />
            </Field>
            <Field label="Confirm new password">
              <input type="password" className={inputClass} value={pw.confirm} required
                autoComplete="new-password" onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
            </Field>
            <Button type="submit" disabled={busy}>{busy ? "Changing…" : "Change password"}</Button>
          </form>
        </Card>
      </div>
    </>
  );
}

/* ------------------------------------------------------------- Not yet ported */

export function ComingSoon({ title }: { title: string }) {
  return (
    <>
      <PageHeader title={title} />
      <Card>
        <div className="py-10 text-center">
          <p className="text-sm font-medium text-slate-700">This screen isn&apos;t in the browser build yet.</p>
          <p className="mx-auto mt-2 max-w-lg text-sm text-slate-500">
            It exists and is tested in the full server build (the Next.js app in this repo).
            Porting it here is mechanical — the database, permissions and write API it needs
            are already live.
          </p>
        </div>
      </Card>
    </>
  );
}
