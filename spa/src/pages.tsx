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
  const today = new Date().toISOString().slice(0, 10);
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);

  const { data, error, loading } = useLoad(async () => {
    const [weigh, fps, crates, pallets, received] = await Promise.all([
      sb().from("weighing_records").select("net_weight_kg, heads")
        .gte("weighed_at", dayStart.toISOString()).eq("is_deleted", false).limit(2000),
      sb().from("fps_outputs").select("weight_kg").gte("produced_at", dayStart.toISOString()).limit(2000),
      sb().from("crates").select("status").in("status", ["warehouse", "storage", "cutting"])
        .eq("is_voided", false).limit(5000),
      sb().from("pallets").select("id, built_at").in("status", ["open", "stored", "closed"]).limit(2000),
      sb().from("crates")
        .select("crate_no, batch_no, status, updated_at, products(sku), locations(code)")
        .eq("status", "warehouse").eq("is_voided", false)
        .order("updated_at", { ascending: false }).limit(15),
    ]);
    return {
      weigh: weigh.data ?? [], fps: fps.data ?? [], crates: crates.data ?? [],
      pallets: pallets.data ?? [], received: received.data ?? [],
    };
  }, []);

  if (loading) return <Spinner />;
  if (error) return <ErrorBox message={error} />;
  const d = data!;

  const wEntries = d.weigh.length;
  const wKg = d.weigh.reduce((a, r) => a + Number((r as Record<string, unknown>).net_weight_kg ?? 0), 0);
  const wHeads = d.weigh.reduce((a, r) => a + Number((r as Record<string, unknown>).heads ?? 0), 0);
  const fEntries = d.fps.length;
  const fKg = d.fps.reduce((a, r) => a + Number((r as Record<string, unknown>).weight_kg ?? 0), 0);
  const byStatus = (s: string) => d.crates.filter((c) => (c as Record<string, unknown>).status === s).length;
  const ageDays = (r: Record<string, unknown>) =>
    Math.floor((Date.now() - new Date(String(r.built_at)).getTime()) / 86_400_000);
  const day4 = d.pallets.filter((p) => ageDays(p as Record<string, unknown>) >= 4).length;
  const day3 = d.pallets.filter((p) => ageDays(p as Record<string, unknown>) >= 3).length;
  const dateStrLong = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">Warehouse Dashboard</h1>
        <span className="text-sm text-slate-500">{dateStrLong}</span>
      </div>

      {day4 > 0 && (
        <a href="#/reports/pallets"
          className="mb-2 block rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 hover:bg-amber-100">
          ⏳ {num(day4)} pallet(s) have been in storage <b>4 days</b> — decide: <b>Lock</b> (hold for sale) or <b>Send to FPS</b>.
        </a>
      )}
      {day3 > 0 && (
        <a href="#/reports/pallets"
          className="mb-4 block rounded-lg border border-rose-300 bg-rose-50 px-4 py-2.5 text-sm text-rose-800 hover:bg-rose-100">
          🔔 {num(day3)} pallet(s) have been in storage <b>3+ days</b> (by production date) — tap to review.
        </a>
      )}

      <div className="mb-5 rounded-2xl bg-slate-900 px-6 py-5 text-white shadow">
        <div className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">
          Today's Transactions · {dateStrLong}
        </div>
        <div className="mt-1.5 flex items-baseline gap-2">
          <span className="text-4xl font-bold tabnum">{kg(wKg + fKg)}</span>
          <span className="text-slate-300">kg total output</span>
        </div>
        <div className="mt-1 text-xs text-slate-400">{num(wEntries + fEntries)} entries · {num(wHeads)} heads</div>
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        {[
          { icon: "⚖️", tone: "bg-indigo-600", title: "Weighing Entry Output", entries: wEntries, wt: wKg, heads: wHeads, accent: "border-indigo-500 text-indigo-700" },
          { icon: "🏭", tone: "bg-purple-600", title: "Total FPS Output", entries: fEntries, wt: fKg, heads: 0, accent: "border-purple-500 text-purple-700" },
        ].map((c) => (
          <div key={c.title} className={`rounded-xl border-l-4 ${c.accent.split(" ")[0]} border border-slate-200 bg-white p-5 shadow-sm`}>
            <div className="flex items-center gap-3">
              <span className={`flex h-10 w-10 items-center justify-center rounded-lg ${c.tone} text-lg`}>{c.icon}</span>
              <div>
                <div className={`text-sm font-semibold ${c.accent.split(" ")[1]}`}>{c.title}</div>
                <div className="text-xs text-slate-400">{num(c.entries)} entries today</div>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-4">
              <div>
                <div className="text-xs text-slate-400">Total Weight</div>
                <div className="text-2xl font-bold tabnum text-slate-900">{kg(c.wt)} <span className="text-sm font-normal text-slate-400">kg</span></div>
              </div>
              <div>
                <div className="text-xs text-slate-400">Total Heads</div>
                <div className="text-2xl font-bold tabnum text-slate-900">{num(c.heads)}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-slate-400">Crate Status</div>
      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        {[
          { label: "In Warehouse", n: byStatus("warehouse"), sub: "crates pending assignment", tone: "text-amber-600 border-amber-400" },
          { label: "In Storage", n: byStatus("storage"), sub: "crates assigned to rack", tone: "text-blue-600 border-blue-400" },
          { label: "Sent to Cutting", n: byStatus("cutting"), sub: "crates in cutting queue →", tone: "text-emerald-600 border-emerald-400" },
        ].map((c) => (
          <div key={c.label} className={`rounded-xl border border-slate-200 border-l-4 ${c.tone.split(" ")[1]} bg-white p-4 shadow-sm`}>
            <div className="text-sm text-slate-600">{c.label}</div>
            <div className={`mt-1 text-3xl font-bold tabnum ${c.tone.split(" ")[0]}`}>{num(c.n)}</div>
            <div className="mt-1 text-xs text-slate-400">{c.sub}</div>
          </div>
        ))}
      </div>

      <Card title="📋 Received Stock" padded={false}>
        <DataTable
          rows={d.received as unknown as Array<Record<string, unknown>>}
          empty="No stock received yet."
          columns={[
            { key: "crate_no", header: "Crate Code", render: (r) => <span className="font-mono text-xs">{String(r.crate_no)}</span> },
            { key: "batch_no", header: "Batch", render: (r) => String(r.batch_no ?? "—") },
            { key: "sku", header: "SKU", render: (r) => String((r.products as Record<string, unknown> | null)?.sku ?? "—") },
            { key: "status", header: "Status", render: (r) => String(r.status) },
            { key: "location", header: "Location", render: (r) => String((r.locations as Record<string, unknown> | null)?.code ?? "—") },
            { key: "updated_at", header: "Received", render: (r) => dateTimeStr(String(r.updated_at)) },
            { key: "_a", header: "Action", render: () => <a className="text-sm font-medium text-brand-700 hover:underline" href="#/wh/pallet-creation">Palletize →</a> },
          ] as Column<Record<string, unknown>>[]}
        />
      </Card>
    </>
  );
}

type ClassRow = { id: number; code: string; name: string };
type BandProduct = { id: number; sku: string; band_code: string; band_min_kg: string; band_max_kg: string; class_id: number };
type CrateType = { id: number; name: string; tare_kg: string; default_heads: number | null };

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

  type Rec = { id: number; crate_no: string; sku: string; heads: number | null; net_weight_kg: string; weighed_at: string; group?: string; ctype?: string; date?: string };
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

  // Live behaviour: the inputted weight automatically selects the SKU band.
  // Per-head = (weight - tare) / heads, matched against the band ranges of the
  // selected class. Gap values (e.g. 0.795 between 0.79 and 0.80) resolve to
  // the band whose decade contains them; exactly 0.80 lands in A08.
  useEffect(() => {
    if (!data || !banded.length) return;
    const ct = data.crateTypes.find((c) => c.id === crateTypeId);
    const netW = Math.max(0, Number(weight) - Number(ct?.tare_kg ?? 0));
    const hc = Number(heads) || 0;
    if (!(netW > 0 && hc > 0)) return;
    const ph = netW / hc;
    const match =
      banded.find((p) => ph >= Number(p.band_min_kg) && ph <= Number(p.band_max_kg)) ??
      banded.find((p) => ph >= Number(p.band_min_kg) && ph < Number(p.band_min_kg) + 0.1);
    if (match && match.id !== productId) setProductId(match.id);
  }, [weight, heads, crateTypeId, banded, data, productId]);

  const loadRecords = useCallback(async () => {
    let q = sb()
      .from("crates")
      .select("id, crate_no, heads, net_weight_kg, weighed_at, production_date, products(sku), crate_types(name)")
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
      group: /^[ABC]/.test(String((r.products as { sku?: string } | null)?.sku ?? ""))
        ? `Class ${String((r.products as { sku?: string } | null)?.sku)[0]}` : "",
      ctype: String((r.crate_types as { name?: string } | null)?.name ?? "").replace(/ crate$/i, ""),
      date: String(r.production_date ?? ""),
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
  /** PMAI label format: QR left, divider, then crate no / SKU / group /
   *  weight / date / heads. Sizes follow the label-size dropdown (inches). */
  async function printLabels(list: Array<{
    crate_no: string; sku: string; group?: string; net_weight_kg: string;
    heads: number | null; ctype?: string; date?: string;
  }>) {
    if (!list.length) return;
    const [w, h] = labelSize.split("x").map(Number);
    const qrs = await Promise.all(list.map((r) =>
      QRCode.toDataURL(r.crate_no, { margin: 0, width: 280 }).catch(() => "")));
    const win = window.open("", "_blank", "width=520,height=660");
    if (!win) return;
    const big = w >= 4;
    win.document.write(`<!doctype html><html><head><title>Labels</title><style>
      @page { size: ${w}in ${h}in; margin: 0; }
      body { margin: 0; font-family: Arial, ui-sans-serif, sans-serif; color: #000; }
      .label { width: ${w}in; height: ${h}in; box-sizing: border-box; padding: 0.12in;
               display: flex; align-items: ${fillSpace ? "stretch" : "flex-start"}; gap: 0.14in;
               page-break-after: always; }
      .qr { width: ${Math.min(w * 0.38, h * 0.62)}in; height: ${Math.min(w * 0.38, h * 0.62)}in; margin-top: 0.08in; }
      .divider { width: 2.5px; background: #000; align-self: stretch; }
      .details { flex: 1; min-width: 0; }
      .crate { font-size: ${big ? "15pt" : "10pt"}; font-weight: 800; letter-spacing: 0.3px; }
      .lbl { font-size: ${big ? "8pt" : "6pt"}; font-weight: 700; letter-spacing: 1px; }
      .skuwrap { border-left: 3.5px solid #000; padding-left: 0.07in; margin-top: 0.07in; }
      .sku { font-size: ${big ? "20pt" : "13pt"}; font-weight: 800; line-height: 1.05; }
      .row { margin-top: 0.05in; font-size: ${big ? "11pt" : "8pt"}; }
      .row b.hero { font-size: ${big ? "18pt" : "12pt"}; }
    </style></head><body>` +
      list.map((r, i2) => `<div class="label">
        ${qrs[i2] ? `<img class="qr" src="${qrs[i2]}" alt="QR" />` : ""}
        <div class="divider"></div>
        <div class="details">
          <div class="crate">${r.crate_no}</div>
          <div class="skuwrap"><div class="lbl">SKU</div><div class="sku">${r.sku}</div></div>
          <div class="row"><span class="lbl">GROUP</span> <b>${r.group ?? ""}</b></div>
          <div class="row"><span class="lbl">WEIGHT</span> <b class="hero">${Number(r.net_weight_kg).toFixed(2)} kg</b></div>
          <div class="row"><span class="lbl">DATE</span> <b>${r.date ?? new Date().toISOString().slice(0, 10)}</b></div>
          <div class="row"><span class="lbl">HEADS</span> <b>${r.heads ?? ""}${r.ctype ? ` (${r.ctype})` : ""}</b></div>
        </div>
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
        void printLabels([{
          crate_no: String(res.crateNo),
          sku: selectedProduct?.band_code ?? "",
          group: data?.classes.find((c) => c.id === classId)?.name ?? "",
          net_weight_kg: String(res.netKg ?? net),
          heads: headCount,
          ctype: crateType?.name?.replace(/ crate$/i, ""),
          date: prodDate,
        }]);
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
              { key: "_n", header: "#", render: (r) => String(shown.indexOf(r as unknown as Rec) + 1) },
              { key: "weighed_at", header: "Time", render: (r) => new Date(String(r.weighed_at)).toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" }) },
              { key: "crate_no", header: "Batch", render: (r) => <span className="font-mono text-xs">{String(r.crate_no).replace(/-P\d+$/, "")}</span> },
              { key: "sku", header: "SKU", render: (r) => <span className="font-semibold text-emerald-700">{String(r.sku)}</span> },
              { key: "net_weight_kg", header: "Weight", align: "right", render: (r) => kg(r.net_weight_kg as string, 3) },
              { key: "heads", header: "Heads", align: "right" },
              {
                key: "_act", header: "", render: (r) => (
                  <span className="flex items-center gap-2">
                    <button type="button" title="Re-print label" className="hover:opacity-70"
                      onClick={() => void printLabels([r as unknown as Rec])}>🖨</button>
                    <button type="button" title="Delete record" disabled={!can("bd.weighing.delete")}
                      className="text-slate-400 hover:text-rose-600 disabled:opacity-30"
                      onClick={() => {
                        void (async () => {
                          const res2 = await rpc<RpcResult>("rpc_delete_weighing", { p_crate_id: Number(r.id) });
                          setMsg({ ok: res2.ok, text: res2.ok ? `Deleted ${String(r.crate_no)}` : res2.message });
                          void loadRecords();
                        })();
                      }}>✕</button>
                  </span>
                ),
              },
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
  const [palletId, setPalletId] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: pallets, reload: reloadPallets } = useLoad(async () => {
    const { data: rows2 } = await sb().from("pallets")
      .select("id,pallet_no,crate_count").eq("status", "open")
      .order("id", { ascending: false }).limit(25);
    return rows2 ?? [];
  }, []);

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
    let res = await rpc<RpcResult>("rpc_move_crate", {
      p_crate_no: value,
      p_to_status: "warehouse",
      p_permission: "bd.scan.use",
      p_expect_from: ["production"],
      p_module: "Basic Dressing",
    });
    // Packing onto a pallet after receiving, when a target pallet is chosen.
    if (res.ok && palletId) {
      const packed = await rpc<RpcResult>("rpc_add_crate_to_pallet", {
        p_crate_no: value, p_pallet_id: Number(palletId),
      });
      res = packed.ok
        ? { ...res, message: `${res.message} → packed onto pallet` }
        : { ...res, message: `Received, but not packed: ${packed.message}` };
      void reloadPallets();
    }
    setBusy(false);
    setLog((prev) => [{ ...res, at: Date.now() }, ...prev].slice(0, 300));
    setCode("");
    inputRef.current?.focus();
  }

  async function newPallet() {
    const r = await rpc<RpcResult>("rpc_open_pallet", { p_kind: "bd" });
    if (r.ok) {
      await reloadPallets();
      const id = Number((r as Record<string, unknown>).palletId ?? (r as Record<string, unknown>).pallet_id ?? 0);
      if (id) setPalletId(String(id));
    }
    setLog((prev) => [{ ...r, at: Date.now() }, ...prev].slice(0, 300));
  }

  const accepted = log.filter((l) => l.ok).length;
  const skipped = log.length - accepted;

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-medium text-emerald-700">
          <span className={`h-2.5 w-2.5 animate-pulse rounded-full ${busy ? "bg-amber-400" : "bg-emerald-500"}`} />
          {busy ? "Working…" : <span><span className="animate-pulse font-semibold">Ready</span> — scan a QR code</span>}
        </div>
        <div className="flex items-center gap-5 text-sm text-slate-600">
          <span>Total: <strong>{num(log.length)}</strong></span>
          <span>Accepted: <strong className="text-emerald-700">{num(accepted)}</strong></span>
          <span>Skipped: <strong className="text-rose-600">{num(skipped)}</strong></span>
          <button type="button" onClick={() => setLog([])}
            className="rounded-full border border-slate-300 px-3 py-1 text-xs text-slate-500 hover:bg-slate-50">
            Clear Log
          </button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
        <span className="flex items-center gap-1.5 text-slate-600">📦 Add to pallet:</span>
        <select className={`${inputClass} !w-64`} value={palletId} onChange={(e) => setPalletId(e.target.value)}>
          <option value="">— No pallet (just receive) —</option>
          {(pallets ?? []).map((p) => (
            <option key={String((p as Record<string, unknown>).id)} value={String((p as Record<string, unknown>).id)}>
              Pallet {String((p as Record<string, unknown>).pallet_no)} ({num(Number((p as Record<string, unknown>).crate_count ?? 0))})
            </option>
          ))}
        </select>
        <button type="button" onClick={() => void newPallet()}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
          + New pallet
        </button>
        <span className="text-xs text-slate-400">
          {palletId
            ? "Each accepted crate is packed onto the selected pallet (cap 24 — a reason is required beyond that)."
            : "Crates will be received only — not packed onto a pallet."}
        </span>
      </div>

      <form onSubmit={scan}>
        <input ref={inputRef} value={code} autoFocus
          placeholder="Ready — scan a crate QR code"
          onChange={(e) => setCode(e.target.value)}
          className="w-full rounded-xl border-0 px-5 py-4 font-mono text-base ring-2 ring-inset ring-emerald-400 placeholder:text-slate-400 focus:ring-emerald-500" />
      </form>

      {log.length === 0 ? (
        <div className="mt-16 text-center">
          <div className="mx-auto mb-3 grid h-12 w-12 grid-cols-2 gap-1 opacity-30">
            <span className="border-2 border-slate-500" /><span className="border-2 border-slate-500" />
            <span className="border-2 border-slate-500" /><span />
          </div>
          <p className="text-base font-semibold text-slate-600">Ready to scan</p>
          <p className="mt-1 text-sm text-slate-400">
            Each crate is accepted automatically — already-received crates will be flagged
          </p>
        </div>
      ) : (
        <div className="thin-scroll mt-5 max-h-[480px] overflow-y-auto rounded-xl border border-slate-200 bg-white">
          <ul className="divide-y divide-slate-100">
            {log.map((l, i2) => (
              <li key={i2} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-sm">
                    <span className={l.ok ? "text-emerald-600" : "text-rose-600"}>{l.ok ? "✓" : "✕"}</span>
                    <span className="truncate text-slate-700">{l.message}</span>
                  </div>
                  {l.crateNo && <div className="truncate font-mono text-[11px] text-slate-400">{l.crateNo}{l.sku ? ` · ${l.sku}` : ""}</div>}
                </div>
                <span className="shrink-0 text-xs tabnum text-slate-400">
                  {l.weightKg ? `${kg(l.weightKg)} kg` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
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
