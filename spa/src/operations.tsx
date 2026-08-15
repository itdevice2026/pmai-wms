/**
 * Interactive screens for the browser build: picklist, issuance, dispatch,
 * pallet management, planning and system administration.
 *
 * Reads go through PostgREST (RLS-gated); every write goes through an rpc_*
 * SECURITY DEFINER function from db/011 and db/015 — the browser holds no
 * table write grants, so nothing here can bypass a permission, a lifecycle
 * rule or a period lock.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { rpc, sb } from "./supabase";
import {
  Badge, Button, Card, DataTable, ErrorBox, Field, PageHeader, Spinner, inputClass,
} from "./ui";
import type { Column } from "./ui";
import { dateStr, dateTimeStr, kg, num } from "./format";

type Row = Record<string, unknown>;

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

async function rows<T = Row>(q: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as T[];
}

/** One-line action result, styled by outcome. */
function Result({ r }: { r: { ok: boolean; message: string } | null }) {
  if (!r) return null;
  return (
    <p className={`mt-2 text-sm ${r.ok ? "text-emerald-700" : "text-red-600"}`}>{r.message}</p>
  );
}

/** Scan/entry box that submits on Enter and keeps focus, like the stations. */
function ScanBox({ onScan, placeholder }: { onScan: (code: string) => void; placeholder?: string }) {
  const [code, setCode] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (code.trim()) onScan(code.trim());
        setCode("");
        ref.current?.focus();
      }}
    >
      <input ref={ref} className={inputClass} value={code} autoFocus
        placeholder={placeholder ?? "Scan or type a crate number…"}
        onChange={(e) => setCode(e.target.value)} />
    </form>
  );
}

/* ================================================================ Picklist */

export function Picklist() {
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [customerId, setCustomerId] = useState("");
  const [strategy, setStrategy] = useState("fefo");
  const [productId, setProductId] = useState("");
  const [requiredKg, setRequiredKg] = useState("");
  const [cancelReason, setCancelReason] = useState("");

  const { data, error, loading, reload } = useLoad(async () => {
    const [lists, customers, products] = await Promise.all([
      rows(sb().from("picklists")
        .select("id,picklist_no,status,strategy,total_weight_kg,picked_weight_kg,created_at,customers(name)")
        .order("id", { ascending: false }).limit(40)),
      rows(sb().from("customers").select("id,name").eq("is_active", true).order("name")),
      rows(sb().from("products").select("id,sku").eq("is_active", true).order("sku").limit(300)),
    ]);
    return { lists, customers, products };
  }, []);

  async function act(fn: string, args: Record<string, unknown>) {
    const r = await rpc(fn, args);
    setResult({ ok: Boolean(r.ok), message: String(r.message ?? "") });
    if (r.ok) reload();
    return r;
  }

  if (loading) return <Spinner />;
  if (error) return <ErrorBox message={error} />;
  const { lists, customers, products } = data!;
  const active = lists.find((l) => Number(l.id) === activeId);

  const columns: Column<Row>[] = [
    { key: "picklist_no", header: "Picklist" },
    { key: "customer", header: "Customer", render: (r) => String((r.customers as Row | null)?.name ?? "—") },
    { key: "status", header: "Status", render: (r) => <Badge>{String(r.status)}</Badge> },
    { key: "strategy", header: "Strategy" },
    { key: "total_weight_kg", header: "Required (kg)", align: "right", render: (r) => kg(Number(r.total_weight_kg ?? 0)) },
    { key: "picked_weight_kg", header: "Picked (kg)", align: "right", render: (r) => kg(Number(r.picked_weight_kg ?? 0)) },
    { key: "created_at", header: "Created", render: (r) => dateTimeStr(String(r.created_at)) },
    {
      key: "_sel", header: "", render: (r) => (
        <button className="text-sm font-medium text-brand-700 hover:underline"
          onClick={() => setActiveId(Number(r.id))}>
          {Number(r.id) === activeId ? "Selected" : "Open"}
        </button>
      ),
    },
  ];

  return (
    <>
      <PageHeader title="Picklist" subtitle="Open a picklist, add SKU lines, then scan crates to pick them. Cancelling requires a reason." />
      <div className="mb-5 grid gap-4 lg:grid-cols-2">
        <Card title="New picklist">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Customer">
              <select className={inputClass} value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                <option value="">Choose…</option>
                {customers.map((c) => <option key={String(c.id)} value={String(c.id)}>{String(c.name)}</option>)}
              </select>
            </Field>
            <Field label="Strategy">
              <select className={inputClass} value={strategy} onChange={(e) => setStrategy(e.target.value)}>
                <option value="fefo">FEFO (expiry first)</option>
                <option value="fifo">FIFO (oldest first)</option>
              </select>
            </Field>
            <Button onClick={async () => {
              const r = await act("rpc_create_picklist", { p_customer_id: Number(customerId) || null, p_strategy: strategy });
              if (r.ok && r.picklistId) setActiveId(Number(r.picklistId));
            }}>Create</Button>
          </div>
        </Card>

        <Card title={active ? `Working on ${String(active.picklist_no)}` : "No picklist selected"}>
          {active ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-end gap-2">
                <Field label="SKU">
                  <select className={inputClass} value={productId} onChange={(e) => setProductId(e.target.value)}>
                    <option value="">Choose…</option>
                    {products.map((p) => <option key={String(p.id)} value={String(p.id)}>{String(p.sku)}</option>)}
                  </select>
                </Field>
                <Field label="Required (kg)">
                  <input className={inputClass} type="number" step="0.01" min="0" value={requiredKg}
                    onChange={(e) => setRequiredKg(e.target.value)} />
                </Field>
                <Button onClick={() => act("rpc_add_picklist_line",
                  { p_picklist_id: activeId, p_product_id: Number(productId) || null, p_required_kg: Number(requiredKg) || 0 })}>
                  Add line
                </Button>
              </div>
              <Field label="Scan to pick">
                <ScanBox onScan={(code) => act("rpc_scan_pick", { p_crate_no: code, p_picklist_id: activeId })} />
              </Field>
              <div className="flex flex-wrap items-end gap-2">
                <Button onClick={() => act("rpc_complete_picklist", { p_picklist_id: activeId })}>Complete</Button>
                <Field label="Cancel reason">
                  <input className={inputClass} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)}
                    placeholder="Required to cancel" />
                </Field>
                <Button variant="danger"
                  onClick={() => act("rpc_cancel_picklist", { p_picklist_id: activeId, p_reason: cancelReason })}>
                  Cancel picklist
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-500">Create a picklist or press Open on one below.</p>
          )}
          <Result r={result} />
        </Card>
      </div>
      <Card padded={false}>
        <DataTable columns={columns} rows={lists} empty="No picklists yet." />
      </Card>
    </>
  );
}

/* ================================================================ Issuance */

export function Issuance() {
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [purpose, setPurpose] = useState("fps");
  const [customerId, setCustomerId] = useState("");
  const [destinationId, setDestinationId] = useState("");

  const { data, error, loading, reload } = useLoad(async () => {
    const [lists, customers, destinations] = await Promise.all([
      rows(sb().from("issuances")
        .select("id,issuance_no,purpose,status,crate_count,total_weight_kg,created_at:issue_date,customers(name),issuance_destinations(name)")
        .order("id", { ascending: false }).limit(40)),
      rows(sb().from("customers").select("id,name").eq("is_active", true).order("name")),
      rows(sb().from("issuance_destinations").select("id,name").eq("is_active", true).order("sort_order")),
    ]);
    return { lists, customers, destinations };
  }, []);

  async function act(fn: string, args: Record<string, unknown>) {
    const r = await rpc(fn, args);
    setResult({ ok: Boolean(r.ok), message: String(r.message ?? "") });
    if (r.ok) reload();
    return r;
  }

  if (loading) return <Spinner />;
  if (error) return <ErrorBox message={error} />;
  const { lists, customers, destinations } = data!;
  const active = lists.find((l) => Number(l.id) === activeId);

  const columns: Column<Row>[] = [
    { key: "issuance_no", header: "Issuance" },
    { key: "purpose", header: "Purpose", render: (r) => <Badge>{String(r.purpose)}</Badge> },
    { key: "dest", header: "Send To", render: (r) => String((r.issuance_destinations as Row | null)?.name ?? (r.customers as Row | null)?.name ?? "—") },
    { key: "status", header: "Status", render: (r) => <Badge>{String(r.status)}</Badge> },
    { key: "crate_count", header: "Crates", align: "right", render: (r) => num(Number(r.crate_count ?? 0)) },
    { key: "total_weight_kg", header: "Weight (kg)", align: "right", render: (r) => kg(Number(r.total_weight_kg ?? 0)) },
    {
      key: "_sel", header: "", render: (r) => (
        <button className="text-sm font-medium text-brand-700 hover:underline"
          onClick={() => setActiveId(Number(r.id))}>
          {Number(r.id) === activeId ? "Selected" : "Open"}
        </button>
      ),
    },
  ];

  return (
    <>
      <PageHeader title="Issuance" subtitle="Issue stock out of the warehouse to an FPS process queue, cutting, or a customer." />
      <div className="mb-5 grid gap-4 lg:grid-cols-2">
        <Card title="New issuance">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Purpose">
              <select className={inputClass} value={purpose} onChange={(e) => setPurpose(e.target.value)}>
                <option value="fps">FPS</option>
                <option value="cutting">Cutting</option>
                <option value="customer">Customer</option>
                <option value="sample">Sample</option>
                <option value="disposal">Disposal</option>
              </select>
            </Field>
            <Field label="Send Issuance To">
              <select className={inputClass} value={destinationId} onChange={(e) => setDestinationId(e.target.value)}>
                <option value="">—</option>
                {destinations.map((d) => <option key={String(d.id)} value={String(d.id)}>{String(d.name)}</option>)}
              </select>
            </Field>
            {purpose === "customer" && (
              <Field label="Customer">
                <select className={inputClass} value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                  <option value="">Choose…</option>
                  {customers.map((c) => <option key={String(c.id)} value={String(c.id)}>{String(c.name)}</option>)}
                </select>
              </Field>
            )}
            <Button onClick={async () => {
              const r = await act("rpc_create_issuance", {
                p_purpose: purpose,
                p_customer_id: customerId ? Number(customerId) : null,
                p_destination_id: destinationId ? Number(destinationId) : null,
              });
              if (r.ok && r.issuanceId) setActiveId(Number(r.issuanceId));
            }}>Create</Button>
          </div>
        </Card>
        <Card title={active ? `Working on ${String(active.issuance_no)}` : "No issuance selected"}>
          {active ? (
            <div className="space-y-3">
              <Field label="Scan to issue">
                <ScanBox onScan={(code) => act("rpc_scan_issuance", { p_crate_no: code, p_issuance_id: activeId })} />
              </Field>
              <Button onClick={() => act("rpc_complete_issuance", { p_issuance_id: activeId })}>Complete</Button>
            </div>
          ) : (
            <p className="text-sm text-slate-500">Create an issuance or press Open on one below.</p>
          )}
          <Result r={result} />
        </Card>
      </div>
      <Card padded={false}>
        <DataTable columns={columns} rows={lists} empty="No issuances yet." />
      </Card>
    </>
  );
}

/* ================================================================ Dispatch */

export function Dispatch() {
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [customerId, setCustomerId] = useState("");
  const [drNo, setDrNo] = useState("");
  const [plateNo, setPlateNo] = useState("");
  const [driver, setDriver] = useState("");
  const [temp, setTemp] = useState("");

  const { data, error, loading, reload } = useLoad(async () => {
    const [lists, customers] = await Promise.all([
      rows(sb().from("dispatches")
        .select("id,dispatch_no,dispatch_date,status,dr_no,plate_no,total_weight_kg,customers(name)")
        .order("id", { ascending: false }).limit(40)),
      rows(sb().from("customers").select("id,name").eq("is_active", true).order("name")),
    ]);
    return { lists, customers };
  }, []);

  async function act(fn: string, args: Record<string, unknown>) {
    const r = await rpc(fn, args);
    setResult({ ok: Boolean(r.ok), message: String(r.message ?? "") });
    if (r.ok) reload();
    return r;
  }

  if (loading) return <Spinner />;
  if (error) return <ErrorBox message={error} />;
  const { lists, customers } = data!;
  const active = lists.find((l) => Number(l.id) === activeId);

  const columns: Column<Row>[] = [
    { key: "dispatch_no", header: "Dispatch" },
    { key: "customer", header: "Customer", render: (r) => String((r.customers as Row | null)?.name ?? "—") },
    { key: "dispatch_date", header: "Date", render: (r) => dateStr(String(r.dispatch_date)) },
    { key: "status", header: "Status", render: (r) => <Badge>{String(r.status)}</Badge> },
    { key: "plate_no", header: "Plate" },
    { key: "total_weight_kg", header: "Weight (kg)", align: "right", render: (r) => kg(Number(r.total_weight_kg ?? 0)) },
    {
      key: "_sel", header: "", render: (r) => (
        <button className="text-sm font-medium text-brand-700 hover:underline"
          onClick={() => setActiveId(Number(r.id))}>
          {Number(r.id) === activeId ? "Selected" : "Open"}
        </button>
      ),
    },
  ];

  return (
    <>
      <PageHeader title="Dispatch" subtitle="Load picked crates onto a truck, then release with DR number and plate. Only picked crates can be loaded." />
      <div className="mb-5 grid gap-4 lg:grid-cols-2">
        <Card title="New dispatch">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Customer">
              <select className={inputClass} value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                <option value="">Choose…</option>
                {customers.map((c) => <option key={String(c.id)} value={String(c.id)}>{String(c.name)}</option>)}
              </select>
            </Field>
            <Button onClick={async () => {
              const r = await act("rpc_create_dispatch", { p_customer_id: Number(customerId) || null });
              if (r.ok && r.dispatchId) setActiveId(Number(r.dispatchId));
            }}>Create</Button>
          </div>
        </Card>
        <Card title={active ? `Working on ${String(active.dispatch_no)}` : "No dispatch selected"}>
          {active ? (
            <div className="space-y-3">
              <Field label="Scan to load (picked crates only)">
                <ScanBox onScan={(code) => act("rpc_scan_dispatch", { p_crate_no: code, p_dispatch_id: activeId })} />
              </Field>
              <div className="flex flex-wrap items-end gap-2">
                <Field label="DR No."><input className={inputClass} value={drNo} onChange={(e) => setDrNo(e.target.value)} /></Field>
                <Field label="Plate"><input className={inputClass} value={plateNo} onChange={(e) => setPlateNo(e.target.value)} /></Field>
                <Field label="Driver"><input className={inputClass} value={driver} onChange={(e) => setDriver(e.target.value)} /></Field>
                <Field label="Truck °C"><input className={inputClass} type="number" step="0.1" value={temp} onChange={(e) => setTemp(e.target.value)} /></Field>
                <Button onClick={() => act("rpc_release_dispatch", {
                  p_dispatch_id: activeId, p_dr_no: drNo, p_plate_no: plateNo,
                  p_driver: driver || null, p_truck_temp_c: temp === "" ? null : Number(temp),
                })}>Release</Button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-500">Create a dispatch or press Open on one below.</p>
          )}
          <Result r={result} />
        </Card>
      </div>
      <Card padded={false}>
        <DataTable columns={columns} rows={lists} empty="No dispatches yet." />
      </Card>
    </>
  );
}

/* ==================================================== BD Pallet Creation */

export function PalletCreation() {
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [palletId, setPalletId] = useState<number | null>(null);
  const [palletNo, setPalletNo] = useState<string | null>(null);
  const [slotId, setSlotId] = useState("");

  const { data, error, loading, reload } = useLoad(async () => {
    const [crates, slots, openPallets] = await Promise.all([
      rows(sb().from("crates")
        .select("crate_no,warehouse_code,production_date,heads,net_weight_kg,products(sku)")
        .is("pallet_id", null).eq("is_voided", false).eq("status", "warehouse")
        .order("production_date").limit(200)),
      rows(sb().from("locations").select("id,code").eq("is_slot", true).eq("is_active", true)
        .order("code").limit(300)),
      rows(sb().from("pallets").select("id,pallet_no,crate_count").eq("status", "open")
        .order("id", { ascending: false }).limit(20)),
    ]);
    return { crates, slots, openPallets };
  }, []);

  async function act(fn: string, args: Record<string, unknown>) {
    const r = await rpc(fn, args);
    setResult({ ok: Boolean(r.ok), message: String(r.message ?? "") });
    if (r.ok) reload();
    return r;
  }

  if (loading) return <Spinner />;
  if (error) return <ErrorBox message={error} />;
  const { crates, slots, openPallets } = data!;

  const columns: Column<Row>[] = [
    { key: "crate_no", header: "Crate Code" },
    { key: "warehouse_code", header: "Warehouse Code", render: (r) => String(r.warehouse_code ?? "—") },
    { key: "sku", header: "SKU", render: (r) => String((r.products as Row | null)?.sku ?? "—") },
    { key: "production_date", header: "Prod. Date", render: (r) => dateStr(String(r.production_date)) },
    { key: "heads", header: "Heads", align: "right", render: (r) => num(Number(r.heads ?? 0)) },
    { key: "net_weight_kg", header: "Weight (kg)", align: "right", render: (r) => kg(Number(r.net_weight_kg ?? 0)) },
  ];

  return (
    <>
      <PageHeader title="BD Pallet Creation" subtitle="Open a pallet, scan un-palletized crates onto it, then close it into a storage slot. Pallets cap at 24 crates." />
      <Card className="mb-5">
        <div className="flex flex-wrap items-end gap-3">
          <Button onClick={async () => {
            const r = await act("rpc_open_pallet", { p_kind: "bd" });
            if (r.ok) { setPalletId(Number(r.palletId ?? r.pallet_id ?? 0) || null); setPalletNo(String(r.palletNo ?? r.pallet_no ?? "")); }
          }}>＋ New pallet</Button>
          <Field label="Or continue an open pallet">
            <select className={inputClass} value={palletId ?? ""} onChange={(e) => {
              const id = Number(e.target.value) || null;
              setPalletId(id);
              setPalletNo(String(openPallets.find((p) => Number(p.id) === id)?.pallet_no ?? ""));
            }}>
              <option value="">Choose…</option>
              {openPallets.map((p) => (
                <option key={String(p.id)} value={String(p.id)}>
                  {String(p.pallet_no)} ({num(Number(p.crate_count ?? 0))} crates)
                </option>
              ))}
            </select>
          </Field>
          {palletId && (
            <>
              <Field label={`Scan crate onto ${palletNo}`}>
                <ScanBox onScan={(code) => act("rpc_add_crate_to_pallet", { p_crate_no: code, p_pallet_id: palletId })} />
              </Field>
              <Field label="Close into slot">
                <select className={inputClass} value={slotId} onChange={(e) => setSlotId(e.target.value)}>
                  <option value="">Choose slot…</option>
                  {slots.map((s) => <option key={String(s.id)} value={String(s.id)}>{String(s.code)}</option>)}
                </select>
              </Field>
              <Button onClick={() => act("rpc_close_pallet", { p_pallet_id: palletId, p_slot_id: Number(slotId) || null })}>
                Close pallet
              </Button>
            </>
          )}
        </div>
        <Result r={result} />
      </Card>
      <Card title={`Un-palletized crates (${crates.length})`} padded={false}>
        <DataTable columns={columns} rows={crates} empty="No un-palletized crates in the warehouse." />
      </Card>
    </>
  );
}

/* ============================================== Location / Pallet Transfer */

export function LocationTransfer() {
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [crateNo, setCrateNo] = useState("");
  const [targetPallet, setTargetPallet] = useState("");
  const [mergeSources, setMergeSources] = useState<number[]>([]);
  const [mergeTarget, setMergeTarget] = useState("");

  const { data, error, loading, reload } = useLoad(async () =>
    rows(sb().from("pallets")
      .select("id,pallet_no,status,crate_count,total_weight_kg")
      .in("status", ["open", "stored", "closed"])
      .order("id", { ascending: false }).limit(150)), []);

  async function act(fn: string, args: Record<string, unknown>) {
    const r = await rpc(fn, args);
    setResult({ ok: Boolean(r.ok), message: String(r.message ?? "") });
    if (r.ok) reload();
  }

  if (loading) return <Spinner />;
  if (error) return <ErrorBox message={error} />;
  const pallets = data!;

  return (
    <>
      <PageHeader title="Location Transfer" subtitle="Move crates between pallets, or merge whole pallets into one." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Move a crate">
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Crate number">
              <input className={inputClass} value={crateNo} onChange={(e) => setCrateNo(e.target.value)}
                placeholder="PMAI-20260815-0001-P1" />
            </Field>
            <Field label="Destination pallet">
              <select className={inputClass} value={targetPallet} onChange={(e) => setTargetPallet(e.target.value)}>
                <option value="">— remove from pallet —</option>
                {pallets.map((p) => (
                  <option key={String(p.id)} value={String(p.id)}>
                    {String(p.pallet_no)} · {num(Number(p.crate_count ?? 0))} crate(s)
                  </option>
                ))}
              </select>
            </Field>
            <Button onClick={() => act("rpc_reassign_crate",
              { p_crate_no: crateNo, p_pallet_id: targetPallet ? Number(targetPallet) : null })}>
              Move Crate →
            </Button>
          </div>
          <Result r={result} />
        </Card>
        <Card title="Merge pallets into one">
          <div className="space-y-2">
            <div className="thin-scroll max-h-56 overflow-y-auto rounded-lg border border-slate-200 p-2">
              {pallets.map((p) => (
                <label key={String(p.id)} className="flex items-center gap-2 py-0.5 text-sm">
                  <input type="checkbox"
                    checked={mergeSources.includes(Number(p.id))}
                    onChange={(e) => setMergeSources((prev) =>
                      e.target.checked ? [...prev, Number(p.id)] : prev.filter((x) => x !== Number(p.id)))} />
                  {String(p.pallet_no)} · {num(Number(p.crate_count ?? 0))} crate(s)
                </label>
              ))}
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Target pallet">
                <select className={inputClass} value={mergeTarget} onChange={(e) => setMergeTarget(e.target.value)}>
                  <option value="">Choose…</option>
                  {pallets.filter((p) => !mergeSources.includes(Number(p.id))).map((p) => (
                    <option key={String(p.id)} value={String(p.id)}>{String(p.pallet_no)}</option>
                  ))}
                </select>
              </Field>
              <Button onClick={() => act("rpc_merge_pallets",
                { p_source_ids: mergeSources, p_target_id: Number(mergeTarget) || null })}>
                Merge into one →
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}

export function PalletTransfer() {
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [search, setSearch] = useState("");
  const [slotByPallet, setSlotByPallet] = useState<Record<string, string>>({});

  const { data, error, loading, reload } = useLoad(async () => {
    const [pallets, slots] = await Promise.all([
      rows(sb().from("pallets")
        .select("id,pallet_no,status,crate_count,total_weight_kg,locations(code)")
        .order("id", { ascending: false }).limit(150)),
      rows(sb().from("locations").select("id,code").eq("is_slot", true).eq("is_active", true)
        .order("code").limit(300)),
    ]);
    return { pallets, slots };
  }, []);

  async function act(fn: string, args: Record<string, unknown>) {
    const r = await rpc(fn, args);
    setResult({ ok: Boolean(r.ok), message: String(r.message ?? "") });
    if (r.ok) reload();
  }

  if (loading) return <Spinner />;
  if (error) return <ErrorBox message={error} />;
  const { pallets, slots } = data!;
  const filtered = pallets.filter((p) =>
    !search.trim() || String(p.pallet_no).toLowerCase().includes(search.trim().toLowerCase()));

  const columns: Column<Row>[] = [
    { key: "pallet_no", header: "Pallet" },
    { key: "status", header: "Status", render: (r) => <Badge>{String(r.status)}</Badge> },
    { key: "loc", header: "Current Location", render: (r) => String((r.locations as Row | null)?.code ?? "—") },
    { key: "crate_count", header: "Crates", align: "right", render: (r) => num(Number(r.crate_count ?? 0)) },
    { key: "total_weight_kg", header: "Weight (kg)", align: "right", render: (r) => kg(Number(r.total_weight_kg ?? 0)) },
    {
      key: "_act", header: "Action", render: (r) => (
        <span className="flex items-center gap-1.5">
          <select className={`${inputClass} !w-40 !py-1`} value={slotByPallet[String(r.id)] ?? ""}
            onChange={(e) => setSlotByPallet((m) => ({ ...m, [String(r.id)]: e.target.value }))}>
            <option value="">Move to slot…</option>
            {slots.map((s) => <option key={String(s.id)} value={String(s.id)}>{String(s.code)}</option>)}
          </select>
          <button className="text-sm font-medium text-brand-700 hover:underline"
            onClick={() => act("rpc_move_pallet",
              { p_pallet_no: String(r.pallet_no), p_slot_id: Number(slotByPallet[String(r.id)]) || null })}>
            Go
          </button>
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader title="Pallet Transfer" subtitle="Move a whole pallet to a different storage slot." />
      <Card className="mb-5">
        <Field label="Pallet Tag">
          <input className={inputClass} value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search pallet number…" />
        </Field>
        <Result r={result} />
      </Card>
      <Card padded={false}>
        <DataTable columns={columns} rows={filtered} empty="No pallets." />
      </Card>
    </>
  );
}

/* ============================================== Planning: Pallet Disposition */

export function PalletDisposition() {
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [dispByPallet, setDispByPallet] = useState<Record<string, string>>({});

  const { data, error, loading, reload } = useLoad(async () =>
    rows(sb().from("pallets")
      .select("id,pallet_no,kind,status,crate_count,total_weight_kg,built_at,disposition,locations(code)")
      .neq("status", "dispatched")
      .order("built_at", { ascending: true }).limit(200)), []);

  async function act(palletId: number, disposition: string) {
    const r = await rpc("rpc_set_pallet_disposition",
      { p_pallet_id: palletId, p_disposition: disposition || null });
    setResult({ ok: Boolean(r.ok), message: String(r.message ?? "") });
    if (r.ok) reload();
  }

  if (loading) return <Spinner />;
  if (error) return <ErrorBox message={error} />;
  const pallets = data!;
  const ageDays = (r: Row) =>
    Math.floor((Date.now() - new Date(String(r.built_at)).getTime()) / 86_400_000);

  const columns: Column<Row>[] = [
    { key: "pallet_no", header: "Pallet No." },
    { key: "kind", header: "Type", render: (r) => <Badge>{String(r.kind)}</Badge> },
    { key: "status", header: "Status", render: (r) => <Badge>{String(r.status)}</Badge> },
    { key: "loc", header: "Storage", render: (r) => String((r.locations as Row | null)?.code ?? "—") },
    { key: "crate_count", header: "Crates", align: "right", render: (r) => num(Number(r.crate_count ?? 0)) },
    { key: "total_weight_kg", header: "Weight", align: "right", render: (r) => kg(Number(r.total_weight_kg ?? 0)) },
    {
      key: "_age", header: "Storage Age", align: "right", render: (r) => {
        const d = ageDays(r);
        // Live thresholds: 3 days = review, 4 days = decide.
        const tone = d >= 4 ? "text-red-600 font-semibold" : d >= 3 ? "text-amber-600 font-medium" : "";
        return <span className={tone}>{d} day{d === 1 ? "" : "s"}</span>;
      },
    },
    { key: "disposition", header: "Disposition", render: (r) => String(r.disposition ?? "—") },
    {
      key: "_tag", header: "Tag as", render: (r) => (
        <span className="flex items-center gap-1.5">
          <select className={`${inputClass} !w-40 !py-1`} value={dispByPallet[String(r.id)] ?? ""}
            onChange={(e) => setDispByPallet((m) => ({ ...m, [String(r.id)]: e.target.value }))}>
            <option value="">Choose…</option>
            <option value="fps">→ FPS</option>
            <option value="direct_issuance">→ Direct Issuance</option>
            <option value="locked">🔒 Lock (hold for sale)</option>
            <option value="dispatch">Dispatch</option>
            <option value="cutting">Cutting</option>
          </select>
          <button className="text-sm font-medium text-brand-700 hover:underline"
            onClick={() => act(Number(r.id), dispByPallet[String(r.id)] ?? "")}>
            Apply
          </button>
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader title="Pallet Disposition"
        subtitle="Decide each pallet's path: FPS, direct issuance (stays in warehouse), lock, dispatch or cutting. Pallets age by production date — 3 days means review, 4 days means decide." />
      <Card className="mb-5"><Result r={result} /></Card>
      <Card padded={false}>
        <DataTable columns={columns} rows={pallets} empty="No pallets awaiting disposition." />
      </Card>
    </>
  );
}

/* ==================================================== System: Locked Records */

const LOCK_ENTITIES = [
  ["weighing_records", "Weighing records"],
  ["crates", "BD crates"],
  ["fps_processings", "FPS records"],
  ["pallets", "Pallets"],
  ["picklists", "Picklists"],
  ["dispatches", "Dispatches"],
  ["live_bird_receipts", "Live bird trucks"],
  ["job_orders", "Job orders"],
] as const;

export function LockedRecords() {
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [entity, setEntity] = useState("crates");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");
  const [basis, setBasis] = useState("production_date");

  const { data, error, loading, reload } = useLoad(async () =>
    rows(sb().from("locked_records")
      .select("id,entity,period_from,period_to,reason,lock_basis,locked_at,is_active")
      .eq("is_active", true).order("locked_at", { ascending: false }).limit(100)), []);

  async function act(fn: string, args: Record<string, unknown>) {
    const r = await rpc(fn, args);
    setResult({ ok: Boolean(r.ok), message: String(r.message ?? "") });
    if (r.ok) reload();
  }

  if (loading) return <Spinner />;
  if (error) return <ErrorBox message={error} />;
  const locks = data!;
  const labelOf = (code: string) => LOCK_ENTITIES.find(([c]) => c === code)?.[1] ?? code;

  const columns: Column<Row>[] = [
    { key: "entity", header: "Entity", render: (r) => labelOf(String(r.entity)) },
    { key: "period_from", header: "From", render: (r) => dateStr(String(r.period_from)) },
    { key: "period_to", header: "To", render: (r) => dateStr(String(r.period_to)) },
    { key: "lock_basis", header: "Basis", render: (r) => <Badge>{String(r.lock_basis)}</Badge> },
    { key: "reason", header: "Reason", render: (r) => String(r.reason ?? "—") },
    { key: "locked_at", header: "Locked", render: (r) => dateTimeStr(String(r.locked_at)) },
    {
      key: "_act", header: "", render: (r) => (
        <button className="text-sm font-medium text-brand-700 hover:underline"
          onClick={() => act("rpc_release_lock", { p_lock_id: Number(r.id) })}>
          🔓 Unlock
        </button>
      ),
    },
  ];

  return (
    <>
      <PageHeader title="Locked Records"
        subtitle="Admin only. Locked records are hidden from the entire system — Stock on Hand, Pallets, reports, everywhere — and live only here. Locking is reversible." />
      <Card title="Lock records" className="mb-5">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Entity">
            <select className={inputClass} value={entity} onChange={(e) => setEntity(e.target.value)}>
              {LOCK_ENTITIES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
            </select>
          </Field>
          <Field label="From"><input type="date" className={inputClass} value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To (cutoff)"><input type="date" className={inputClass} value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          <Field label="Basis">
            <select className={inputClass} value={basis} onChange={(e) => setBasis(e.target.value)}>
              <option value="production_date">Production date</option>
              <option value="created_date">Created date</option>
            </select>
          </Field>
          <Field label="Reason"><input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          <Button onClick={() => act("rpc_create_lock",
            { p_entity: entity, p_from: from || null, p_to: to || null, p_reason: reason || null, p_basis: basis })}>
            🔒 Lock up to cutoff
          </Button>
        </div>
        <Result r={result} />
      </Card>
      <Card title={`Currently locked — ${locks.length} active lock(s)`} padded={false}>
        <DataTable columns={columns} rows={locks} empty="Nothing is locked." />
      </Card>
    </>
  );
}

/* ============================================================ System: RBAC */

export function Rbac() {
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [roleId, setRoleId] = useState<number | null>(null);
  const [overrideUser, setOverrideUser] = useState("");
  const [overridePerm, setOverridePerm] = useState("");
  const [overrideEffect, setOverrideEffect] = useState("grant");

  const { data, error, loading, reload } = useLoad(async () => {
    const [roles, permissions, grants, users, overrides] = await Promise.all([
      rows(sb().from("roles").select("id,code,name,is_active").order("id")),
      rows(sb().from("permissions").select("id,code,module,label").order("code")),
      rows(sb().from("role_permissions").select("role_id,permission_id")),
      rows(sb().from("users").select("id,full_name,email,is_active,has_full_access,roles(name)")
        .eq("is_active", true).order("full_name").limit(200)),
      rows(sb().from("user_permission_overrides").select("user_id,permission_id,effect")),
    ]);
    return { roles, permissions, grants, users, overrides };
  }, []);

  async function act(fn: string, args: Record<string, unknown>) {
    const r = await rpc(fn, args);
    setResult({ ok: Boolean(r.ok), message: String(r.message ?? "") });
    if (r.ok) reload();
  }

  if (loading) return <Spinner />;
  if (error) return <ErrorBox message={error} />;
  const { roles, permissions, grants, users, overrides } = data!;

  const activeRoles = roles.filter((r) => r.is_active !== false);
  const role = activeRoles.find((r) => Number(r.id) === roleId);
  const granted = new Set(
    grants.filter((g) => Number(g.role_id) === roleId).map((g) => Number(g.permission_id)));
  const overrideCount = (userId: unknown) =>
    overrides.filter((o) => String(o.user_id) === String(userId)).length;

  const userColumns: Column<Row>[] = [
    { key: "full_name", header: "Name" },
    { key: "email", header: "Email" },
    { key: "role", header: "Role", render: (r) => String((r.roles as Row | null)?.name ?? "—") },
    {
      key: "_ov", header: "Overrides", align: "right",
      render: (r) => r.has_full_access ? <Badge>full access</Badge> : <>{overrideCount(r.id) || "—"}</>,
    },
  ];

  return (
    <>
      <PageHeader title="RBAC — User Management"
        subtitle="Role permissions plus per-user overrides. Effective access = role grants + user grants − user denies; admin, IT and full-access accounts hold everything." />
      <div className="mb-5 grid gap-4 lg:grid-cols-2">
        <Card title="Role permissions">
          <Field label="Role">
            <select className={inputClass} value={roleId ?? ""} onChange={(e) => setRoleId(Number(e.target.value) || null)}>
              <option value="">Choose…</option>
              {activeRoles.map((r) => <option key={String(r.id)} value={String(r.id)}>{String(r.name)}</option>)}
            </select>
          </Field>
          {role && ["admin", "it"].includes(String(role.code)) && (
            <p className="mt-2 text-sm text-slate-500">{String(role.name)} implicitly holds every permission.</p>
          )}
          {role && !["admin", "it"].includes(String(role.code)) && (
            <div className="thin-scroll mt-3 max-h-96 overflow-y-auto rounded-lg border border-slate-200 p-2">
              {permissions.map((p) => (
                <label key={String(p.id)} className="flex items-center gap-2 py-0.5 text-sm">
                  <input type="checkbox" checked={granted.has(Number(p.id))}
                    onChange={(e) => act("rpc_toggle_role_permission",
                      { p_role_id: roleId, p_permission_id: Number(p.id), p_grant: e.target.checked })} />
                  <span className="font-mono text-xs">{String(p.code)}</span>
                  <span className="text-slate-500">{String(p.label ?? "")}</span>
                </label>
              ))}
            </div>
          )}
        </Card>
        <Card title="Per-user override">
          <div className="flex flex-wrap items-end gap-2">
            <Field label="User">
              <select className={inputClass} value={overrideUser} onChange={(e) => setOverrideUser(e.target.value)}>
                <option value="">Choose…</option>
                {users.map((u) => <option key={String(u.id)} value={String(u.id)}>{String(u.full_name)}</option>)}
              </select>
            </Field>
            <Field label="Permission">
              <select className={inputClass} value={overridePerm} onChange={(e) => setOverridePerm(e.target.value)}>
                <option value="">Choose…</option>
                {permissions.map((p) => <option key={String(p.id)} value={String(p.id)}>{String(p.code)}</option>)}
              </select>
            </Field>
            <Field label="Effect">
              <select className={inputClass} value={overrideEffect} onChange={(e) => setOverrideEffect(e.target.value)}>
                <option value="grant">Grant</option>
                <option value="deny">Deny</option>
                <option value="clear">Clear override</option>
              </select>
            </Field>
            <Button onClick={() => act("rpc_set_user_override", {
              p_user_id: overrideUser || null,
              p_permission_id: Number(overridePerm) || null,
              p_effect: overrideEffect === "clear" ? null : overrideEffect,
            })}>Apply</Button>
          </div>
          <Result r={result} />
        </Card>
      </div>
      <Card title={`Users (${users.length})`} padded={false}>
        <DataTable columns={userColumns} rows={users} empty="No users." />
      </Card>
    </>
  );
}

/* ================================================== Live Bird Receiving */

type Truck = {
  productionDate: string; customerName: string; farmOrigin: string; houseNumber: string;
  plateNo: string; scaleIn: string; scaleOut: string; birds: string;
  doaHeads: string; doaWeight: string;
};
const emptyTruck = (date: string): Truck => ({
  productionDate: date, customerName: "", farmOrigin: "", houseNumber: "",
  plateNo: "", scaleIn: "", scaleOut: "", birds: "", doaHeads: "0", doaWeight: "0",
});
const truckWeight = (t: Truck) => Math.max(0, (Number(t.scaleIn) || 0) - (Number(t.scaleOut) || 0));

export function LiveBirdReceiving() {
  const today = new Date().toISOString().slice(0, 10);
  const [mode, setMode] = useState<"list" | "form">("list");
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [viewDate, setViewDate] = useState<string | null>(null);
  const [sessionDate, setSessionDate] = useState(today);
  const [notes, setNotes] = useState("");
  const [trucks, setTrucks] = useState<Truck[]>([emptyTruck(today)]);
  const [saving, setSaving] = useState(false);

  const { data, error, loading, reload } = useLoad(async () =>
    rows(sb().from("live_bird_receipts")
      .select("id,receipt_no,receipt_date,production_date,customer_name,farm_origin,house_number,plate_no,heads_received,heads_doa,doa_weight_kg,net_weight_kg,ave_weight_kg,users!live_bird_receipts_received_by_fkey(full_name)")
      .order("receipt_date", { ascending: false }).order("id").limit(400)), []);

  if (loading) return <Spinner />;
  if (error) return <ErrorBox message={error} />;
  const receipts = data!;

  const setTruck = (i: number, k: keyof Truck, v: string) =>
    setTrucks((prev) => prev.map((t, j) => (j === i ? { ...t, [k]: v } : t)));

  // Summary across truck cards — mirrors the live form's SUMMARY strip.
  const sum = trucks.reduce(
    (a, t) => {
      const wt = truckWeight(t);
      const birds = Number(t.birds) || 0;
      const doa = Number(t.doaHeads) || 0;
      const doaWt = Number(t.doaWeight) || 0;
      return {
        birds: a.birds + birds, wt: a.wt + wt, doa: a.doa + doa, doaWt: a.doaWt + doaWt,
        fp: a.fp + Math.max(0, birds - doa), fpWt: a.fpWt + Math.max(0, wt - doaWt),
      };
    },
    { birds: 0, wt: 0, doa: 0, doaWt: 0, fp: 0, fpWt: 0 });

  async function saveSession() {
    setSaving(true);
    const r = await rpc("rpc_create_lbr_session", {
      p_receipt_date: sessionDate,
      p_notes: notes || null,
      p_trucks: trucks.map((t) => ({
        production_date: t.productionDate || sessionDate,
        customer_name: t.customerName, farm_origin: t.farmOrigin,
        house_number: t.houseNumber, plate_no: t.plateNo,
        scale_in_kg: Number(t.scaleIn) || 0, scale_out_kg: Number(t.scaleOut) || 0,
        birds: Number(t.birds) || 0, doa_heads: Number(t.doaHeads) || 0,
        doa_weight_kg: Number(t.doaWeight) || 0,
      })),
    });
    setSaving(false);
    setResult({ ok: Boolean(r.ok), message: String(r.message ?? "") });
    if (r.ok) {
      setMode("list");
      setTrucks([emptyTruck(today)]);
      setNotes("");
      reload();
    }
  }

  /* ---------------- entry form: one card per truck, saved all at once */
  if (mode === "form") {
    return (
      <>
        <div className="mb-6 flex items-center gap-3">
          <button className="text-sm text-slate-500 hover:text-slate-800" onClick={() => setMode("list")}>← Back</button>
          <div>
            <h1 className="text-xl font-semibold text-slate-900">New Live Bird Receiving</h1>
            <p className="text-sm text-slate-500">Fill in one card per truck, then save all at once.</p>
          </div>
        </div>

        <Card title="Session" className="mb-4">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Receiving Date *">
              <input type="date" className={inputClass} value={sessionDate} onChange={(e) => setSessionDate(e.target.value)} />
            </Field>
            <Field label="Notes (optional)">
              <input className={`${inputClass} min-w-72`} value={notes} placeholder="Any remarks for this session…"
                onChange={(e) => setNotes(e.target.value)} />
            </Field>
          </div>
        </Card>

        {trucks.map((t, i) => {
          const wt = truckWeight(t);
          const birds = Number(t.birds) || 0;
          const doa = Number(t.doaHeads) || 0;
          const doaWt = Number(t.doaWeight) || 0;
          return (
            <Card key={i} className="mb-4"
              title={`Truck ${i + 1}`}
              action={<span className="text-xs uppercase tracking-wide text-slate-400">
                {t.plateNo ? t.plateNo : "No plate entered"}
                {trucks.length > 1 && (
                  <button className="ml-3 text-rose-600 hover:underline"
                    onClick={() => setTrucks((p) => p.filter((_, j) => j !== i))}>Remove</button>
                )}
              </span>}>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-slate-400">Delivery Info</p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Production Date *">
                  <input type="date" className={inputClass} value={t.productionDate} onChange={(e) => setTruck(i, "productionDate", e.target.value)} />
                </Field>
                <Field label="Customer Name *">
                  <input className={inputClass} value={t.customerName} placeholder="e.g. PMAI" onChange={(e) => setTruck(i, "customerName", e.target.value)} />
                </Field>
                <Field label="Farm Origin *">
                  <input className={inputClass} value={t.farmOrigin} placeholder="e.g. Magalang" onChange={(e) => setTruck(i, "farmOrigin", e.target.value)} />
                </Field>
                <Field label="House Number *">
                  <input className={inputClass} value={t.houseNumber} placeholder="e.g. 1" onChange={(e) => setTruck(i, "houseNumber", e.target.value)} />
                </Field>
                <Field label="Plate No. *">
                  <input className={inputClass} value={t.plateNo} placeholder="e.g. ABC 1234" onChange={(e) => setTruck(i, "plateNo", e.target.value)} />
                </Field>
              </div>
              <p className="mb-2 mt-4 text-[11px] font-semibold uppercase tracking-widest text-slate-400">Weight &amp; Birds</p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <Field label="Truck Scale In (kg) *">
                  <input type="number" min="0" step="0.001" className={inputClass} value={t.scaleIn} placeholder="0.000" onChange={(e) => setTruck(i, "scaleIn", e.target.value)} />
                </Field>
                <Field label="Truck Scale Out (kg) *">
                  <input type="number" min="0" step="0.001" className={inputClass} value={t.scaleOut} placeholder="0.000" onChange={(e) => setTruck(i, "scaleOut", e.target.value)} />
                </Field>
                <Field label="Total Weight (kg)">
                  <input className={`${inputClass} bg-slate-50 text-emerald-700`} readOnly value={kg(wt)} />
                </Field>
                <Field label="Total No. of Birds *">
                  <input type="number" min="0" className={inputClass} value={t.birds} placeholder="0" onChange={(e) => setTruck(i, "birds", e.target.value)} />
                </Field>
                <Field label="ALW (kg/bird)">
                  <input className={`${inputClass} bg-slate-50 text-emerald-700`} readOnly value={kg(birds > 0 ? wt / birds : 0)} />
                </Field>
              </div>
              <p className="mb-2 mt-4 text-[11px] font-semibold uppercase tracking-widest text-slate-400">DOA &amp; For Process</p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="DOA Heads *">
                  <input type="number" min="0" className={inputClass} value={t.doaHeads} onChange={(e) => setTruck(i, "doaHeads", e.target.value)} />
                </Field>
                <Field label="DOA Weight (kg) *">
                  <input type="number" min="0" step="0.01" className={inputClass} value={t.doaWeight} onChange={(e) => setTruck(i, "doaWeight", e.target.value)} />
                </Field>
                <Field label="Total for Process">
                  <input className={`${inputClass} bg-slate-50`} readOnly value={num(Math.max(0, birds - doa))} />
                </Field>
                <Field label="Total for Process Weight (kg)">
                  <input className={`${inputClass} bg-slate-50 text-emerald-700`} readOnly value={kg(Math.max(0, wt - doaWt))} />
                </Field>
              </div>
            </Card>
          );
        })}

        <button
          className="mb-4 w-full rounded-xl border-2 border-dashed border-slate-300 py-3 text-sm font-medium text-slate-500 hover:border-brand-400 hover:text-brand-700"
          onClick={() => setTrucks((p) => [...p, emptyTruck(sessionDate)])}>
          + Add Another Truck
        </button>

        <Card title={`Summary — ${trucks.length} truck(s)`} className="mb-4">
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {([
              ["Total Birds", num(sum.birds), ""],
              ["Total Weight", kg(sum.wt) + " kg", "text-emerald-700"],
              ["Avg. ALW", kg(sum.birds > 0 ? sum.wt / sum.birds : 0) + " kg", "text-emerald-700"],
              ["DOA Heads", num(sum.doa), "text-red-600"],
              ["DOA Weight", kg(sum.doaWt) + " kg", "text-red-600"],
              ["For Process", num(sum.fp), "text-emerald-600"],
              ["For Process Weight", kg(sum.fpWt) + " kg", "text-emerald-600"],
            ] as const).map(([label, value, tone]) => (
              <div key={label} className="rounded-lg bg-slate-50 px-4 py-3">
                <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">{label}</div>
                <div className={`mt-1 text-lg font-semibold ${tone || "text-slate-900"}`}>{value}</div>
              </div>
            ))}
          </div>
          <Result r={result} />
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setMode("list")}>Cancel</Button>
            <Button disabled={saving} onClick={() => void saveSession()}>
              {saving ? "Saving…" : "Save Receiving Session"}
            </Button>
          </div>
        </Card>
      </>
    );
  }

  /* ---------------- list of sessions, grouped by receiving date */
  const sessions = new Map<string, Row[]>();
  for (const r of receipts) {
    const d = String(r.receipt_date);
    if (!sessions.has(d)) sessions.set(d, []);
    sessions.get(d)!.push(r);
  }
  const sessionRows: Row[] = [...sessions.entries()].map(([date, tr]) => {
    const birds = tr.reduce((a, t) => a + Number(t.heads_received ?? 0), 0);
    const doa = tr.reduce((a, t) => a + Number(t.heads_doa ?? 0), 0);
    const wt = tr.reduce((a, t) => a + Number(t.net_weight_kg ?? 0), 0);
    return {
      date, trucks: tr.length, birds, doa, wt,
      alw: birds > 0 ? wt / birds : 0, forProcess: birds - doa,
      receivedBy: [...new Set(tr.map((t) => String((t.users as Row | null)?.full_name ?? "")))].filter(Boolean).join(", "),
    };
  });

  const sessionColumns: Column<Row>[] = [
    { key: "date", header: "Date", render: (r) => dateStr(String(r.date)) },
    { key: "trucks", header: "Trucks", align: "right", render: (r) => num(Number(r.trucks)) },
    { key: "birds", header: "Total Birds", align: "right", render: (r) => <strong>{num(Number(r.birds))}</strong> },
    { key: "wt", header: "Total Weight", align: "right", render: (r) => `${kg(Number(r.wt))} kg` },
    { key: "alw", header: "ALW", align: "right", render: (r) => `${kg(Number(r.alw))} kg` },
    { key: "doa", header: "DOA Heads", align: "right", render: (r) => <span className="font-medium text-red-600">{num(Number(r.doa))}</span> },
    { key: "forProcess", header: "For Process", align: "right", render: (r) => <span className="font-medium text-emerald-600">{num(Number(r.forProcess))}</span> },
    { key: "receivedBy", header: "Received By" },
    {
      key: "_view", header: "", render: (r) => (
        <button className="text-sm font-medium text-brand-700 hover:underline"
          onClick={() => setViewDate(viewDate === String(r.date) ? null : String(r.date))}>
          {viewDate === String(r.date) ? "Hide" : "View →"}
        </button>
      ),
    },
  ];

  const truckColumns: Column<Row>[] = [
    { key: "receipt_no", header: "Receipt" },
    { key: "customer_name", header: "Customer", render: (r) => String(r.customer_name ?? "—") },
    { key: "farm_origin", header: "Farm Origin", render: (r) => String(r.farm_origin ?? "—") },
    { key: "house_number", header: "House", render: (r) => String(r.house_number ?? "—") },
    { key: "plate_no", header: "Plate", render: (r) => String(r.plate_no ?? "—") },
    { key: "heads_received", header: "Birds", align: "right", render: (r) => num(Number(r.heads_received)) },
    { key: "heads_doa", header: "DOA", align: "right", render: (r) => <span className="text-red-600">{num(Number(r.heads_doa))}</span> },
    { key: "doa_weight_kg", header: "DOA (kg)", align: "right", render: (r) => kg(Number(r.doa_weight_kg ?? 0)) },
    { key: "net_weight_kg", header: "Weight (kg)", align: "right", render: (r) => kg(Number(r.net_weight_kg)) },
    { key: "ave_weight_kg", header: "ALW", align: "right", render: (r) => kg(Number(r.ave_weight_kg ?? 0)) },
  ];

  return (
    <>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Live Bird Receiving</h1>
          <p className="mt-1 text-sm text-slate-500">All receiving sessions</p>
        </div>
        <Button onClick={() => { setResult(null); setMode("form"); }}>+ New Session</Button>
      </div>
      {result && mode === "list" && <div className="mb-3"><Result r={result} /></div>}
      <Card padded={false}>
        <DataTable columns={sessionColumns} rows={sessionRows} empty="No receiving sessions yet." />
      </Card>
      {viewDate && (
        <Card title={`Trucks on ${dateStr(viewDate)}`} padded={false} className="mt-5">
          <DataTable columns={truckColumns} rows={sessions.get(viewDate) ?? []} empty="No trucks." />
        </Card>
      )}
    </>
  );
}

/* ======================================================== Byproducts */

function ByproductPanel({ title, category, items, onChanged }: {
  title: string; category: "primary" | "secondary";
  items: Row[]; onChanged: () => void;
}) {
  const [newName, setNewName] = useState("");
  const [names, setNames] = useState<Record<string, string>>({});
  const [actives, setActives] = useState<Record<string, boolean>>({});
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function act(fn: string, args: Record<string, unknown>) {
    const r = await rpc(fn, args);
    setResult({ ok: Boolean(r.ok), message: String(r.message ?? "") });
    if (r.ok) onChanged();
  }

  return (
    <Card title={title} action={<span className="text-xs text-slate-400">{items.length} item(s)</span>}>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-slate-400">Add byproduct</div>
      <div className="mb-4 flex gap-2">
        <input className={inputClass} value={newName} placeholder="e.g. Feet, Neck, Gizzard…"
          onChange={(e) => setNewName(e.target.value)} />
        <Button onClick={async () => {
          await act("rpc_save_byproduct", { p_id: null, p_category: category, p_name: newName });
          setNewName("");
        }}>Add</Button>
      </div>
      <div className="divide-y divide-slate-100">
        {items.map((b) => {
          const id = String(b.id);
          const name = names[id] ?? String(b.name);
          const active = actives[id] ?? Boolean(b.is_active);
          return (
            <div key={id} className="flex items-center gap-3 py-2">
              <input className={inputClass} value={name}
                onChange={(e) => setNames((m) => ({ ...m, [id]: e.target.value }))} />
              <label className="flex items-center gap-1 text-xs text-slate-600">
                <input type="checkbox" checked={active}
                  onChange={(e) => setActives((m) => ({ ...m, [id]: e.target.checked }))} />
                Active
              </label>
              <button className="text-sm font-medium text-brand-700 hover:underline"
                onClick={() => act("rpc_save_byproduct",
                  { p_id: Number(b.id), p_category: category, p_name: name, p_active: active })}>
                Save
              </button>
              <button className="text-sm font-medium text-rose-600 hover:underline"
                onClick={() => act("rpc_delete_byproduct", { p_id: Number(b.id) })}>
                Delete
              </button>
            </div>
          );
        })}
        {items.length === 0 && <p className="py-4 text-sm text-slate-400">None yet.</p>}
      </div>
      <Result r={result} />
    </Card>
  );
}

export function Byproducts() {
  const { data, error, loading, reload } = useLoad(async () =>
    rows(sb().from("byproducts").select("id,category,name,is_active").order("name")), []);

  if (loading) return <Spinner />;
  if (error) return <ErrorBox message={error} />;
  const items = data!;

  return (
    <>
      <PageHeader title="Byproducts"
        subtitle="Manage the Primary & Secondary byproduct SKUs used in Basic Dressing weighing. These fill the byproduct dropdowns at the weighing station." />
      <div className="grid gap-5 lg:grid-cols-2">
        <ByproductPanel title="Primary Byproduct" category="primary"
          items={items.filter((b) => b.category === "primary")} onChanged={reload} />
        <ByproductPanel title="Secondary Byproduct" category="secondary"
          items={items.filter((b) => b.category === "secondary")} onChanged={reload} />
      </div>
    </>
  );
}

/* ================================================== Import Weighing Records */
// eslint-disable-next-line import/no-named-as-default-member
import * as XLSX from "xlsx";

const IMP_HEADERS = ["TRUCK #", "PROD DATE", "PALLET #", "SKU", "CRATES", "QTY HEADS", "QTY KILOS"];

export function ImportWeighing() {
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState<Array<Record<string, string>>>([]);

  function downloadCsvTemplate() {
    const blob = new Blob([IMP_HEADERS.join(",") + "\n"], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "weighing-import-template.csv"; a.click();
  }
  function downloadXlsxTemplate() {
    const ws = XLSX.utils.aoa_to_sheet([IMP_HEADERS]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Weighing");
    XLSX.writeFile(wb, "weighing-import-template.xlsx");
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    setParsed([]); setResult(null);
    if (!f) { setFileName(""); return; }
    setFileName(f.name);
    if (f.size > 10 * 1024 * 1024) {
      setResult({ ok: false, message: "File is over the 10 MB limit." }); return;
    }
    const buf = await f.arrayBuffer();
    const wb = XLSX.read(buf, { cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const grid: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });
    // The header row is found automatically; section titles and blanks skipped.
    const hi = grid.findIndex((row) => {
      const cells = row.map((c) => String(c).trim().toUpperCase());
      return cells.includes("SKU") && cells.some((c) => c.includes("PROD"));
    });
    if (hi < 0) { setResult({ ok: false, message: "Could not find a header row containing SKU and PROD DATE." }); return; }
    const headers = grid[hi].map((c) => String(c).trim().toUpperCase());
    const col = (name: string) => headers.findIndex((h) => h.replace(/\s+/g, " ") === name);
    const idx = {
      truck: col("TRUCK #"), date: headers.findIndex((h) => h.includes("PROD")),
      pallet: col("PALLET #"), sku: col("SKU"), crates: col("CRATES"),
      heads: headers.findIndex((h) => h.includes("HEADS")), kilos: headers.findIndex((h) => h.includes("KILOS")),
    };
    const out: Array<Record<string, string>> = [];
    for (const row of grid.slice(hi + 1)) {
      const get = (n: number) => (n >= 0 ? String(row[n] ?? "").trim() : "");
      const sku = get(idx.sku);
      if (!sku && !get(idx.date) && !get(idx.heads)) continue; // blank / section rows
      let dateRaw = get(idx.date);
      const m = dateRaw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (m) dateRaw = `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
      out.push({
        truck: get(idx.truck), prod_date: dateRaw, pallet: get(idx.pallet),
        sku, crates: get(idx.crates), heads: get(idx.heads), kilos: get(idx.kilos),
      });
    }
    if (!out.length) { setResult({ ok: false, message: "No data rows found under the header." }); return; }
    setParsed(out);
    setResult({ ok: true, message: `${out.length} row(s) ready to import from ${f.name}.` });
  }

  async function doImport() {
    if (!parsed.length) { setResult({ ok: false, message: "Choose a file first." }); return; }
    setBusy(true);
    const r = await rpc("rpc_import_weighings", { p_rows: parsed });
    setBusy(false);
    setResult({ ok: Boolean(r.ok), message: String(r.message ?? "") });
    if (r.ok) setParsed([]);
  }

  const fmt = [
    ["TRUCK #", "No", "Free text / number"],
    ["PROD DATE", "Yes", "date — e.g. 6/21/2026 or 2026-06-21"],
    ["PALLET #", "No", "Pallet number — a pallet is created per number (existing numbers are never reused)"],
    ["SKU", "Yes", "FCA / FCB / FCC + band, e.g. FCA 1.1 (class read from the FC_ letter)"],
    ["CRATES", "No", "Defaults to 1"],
    ["QTY HEADS", "Yes", "Whole number > 0, e.g. 15"],
    ["QTY KILOS", "Yes", "Total crate weight > 0, e.g. 17.9"],
  ];

  return (
    <>
      <PageHeader title="⬆️ Import Weighing Records"
        subtitle="Bulk-upload your manual record sheet (Excel / CSV). Each row becomes a weighing record + crate, grouped onto its pallet — for back-filling production logged by hand." />
      <a href="#/bd/weighing" className="mb-4 inline-block text-sm text-slate-500 hover:text-slate-800">← Back to Weighing</a>

      <Card title="Step 1 — Download a template" className="mb-5">
        <p className="mb-3 text-sm text-slate-500">Fill it in, then upload below. Column order doesn't matter — the header names do.</p>
        <div className="flex gap-2">
          <Button onClick={downloadXlsxTemplate}>⬇ Excel template (.xlsx)</Button>
          <Button variant="secondary" onClick={downloadCsvTemplate}>⬇ CSV template (.csv)</Button>
        </div>
      </Card>

      <Card title="Step 2 — Upload your file" className="mb-5">
        <input type="file" accept=".xlsx,.xls,.csv"
          onChange={(e) => void onFile(e)}
          className="block w-full max-w-xl rounded-lg border border-slate-300 text-sm file:mr-3 file:rounded-l-lg file:border-0 file:bg-brand-600 file:px-4 file:py-2.5 file:text-sm file:font-medium file:text-white" />
        <p className="mt-2 text-xs text-slate-400">Accepted: .xlsx, .xls, .csv · max 10 MB.{fileName ? ` — ${fileName}` : ""}</p>
        <div className="mt-3">
          <Button disabled={busy || !parsed.length} onClick={() => void doImport()}>
            {busy ? "Importing…" : "⬆️ Import file"}
          </Button>
        </div>
        <Result r={result} />
      </Card>

      <Card title="Column format" padded={false}>
        <DataTable
          rows={fmt.map(([c2, req, f2]) => ({ column: c2, required: req, format: f2 }))}
          columns={[
            { key: "column", header: "Column", render: (r) => <b>{String(r.column)}</b> },
            { key: "required", header: "Required", render: (r) => <span className={r.required === "Yes" ? "text-rose-600" : "text-slate-500"}>{String(r.required)}</span> },
            { key: "format", header: "Accepted values / format" },
          ] as Column<Row>[]}
        />
        <ul className="space-y-1.5 px-5 py-4 text-xs text-slate-500">
          <li>• The exact <b>system SKU / band</b> is computed from the class + (QTY KILOS ÷ QTY HEADS), same as the weighing screen — e.g. FCA 1.1 at 17.9 kg ÷ 15 → A11.</li>
          <li>• Rows are <b>grouped by PALLET #</b>: a pallet is created per number and its crates are marked received + packed. An existing pallet number is never reused.</li>
          <li>• Records are dated by <b>PROD DATE</b>, and crate type defaults to <b>Full</b>.</li>
          <li>• The header row is found automatically; section titles (e.g. "BASIC DRESSING") and blank rows are skipped.</li>
          <li>• Validation is <b>all-or-nothing</b>: if any row has an error, nothing is imported. Re-uploading the same file again will create duplicates.</li>
        </ul>
      </Card>
    </>
  );
}

/* ================================================== FPS Entry + Customers */

const FPS_CLASSES = ["Class A", "Class B", "Class C", "FG", "BP", "Class A-NL", "Class B-NL"];

export function FpsEntry() {
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [cls, setCls] = useState("Class A");
  const [prodDate, setProdDate] = useState(new Date().toISOString().slice(0, 10));
  const [expiry, setExpiry] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [weight, setWeight] = useState("");
  const [heads, setHeads] = useState("15");
  const [crateTypeId, setCrateTypeId] = useState("");
  const [autoPrint, setAutoPrint] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [fCust, setFCust] = useState("");
  const [fSku, setFSku] = useState("");

  const { data, error, loading, reload } = useLoad(async () => {
    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
    const [customers, bands, types, recs] = await Promise.all([
      rows(sb().from("customers").select("id,code,name").eq("is_active", true).order("name")),
      rows(sb().from("customer_sku_bands").select("customer_id,band_code,min_kg,max_kg,sort_order").eq("is_active", true)),
      rows(sb().from("crate_types").select("id,name").eq("is_active", true).order("sort_order")),
      rows(sb().from("crates")
        .select("id,crate_no,weighed_at,fps_class,fps_band,net_weight_kg,heads,customers!crates_fps_customer_id_fkey(name)")
        .not("fps_customer_id", "is", null).gte("weighed_at", dayStart.toISOString())
        .eq("is_voided", false).order("weighed_at", { ascending: false }).limit(200)),
    ]);
    return { customers, bands, types, recs };
  }, []);

  useEffect(() => {
    if (!data) return;
    setCrateTypeId((v) => v || String(data.types[0]?.id ?? ""));
    // Generic customer auto-selected for Class A.
    if (!customerId && cls === "Class A") {
      const gen = data.customers.find((c) => String(c.code) === "GENERIC");
      if (gen) setCustomerId(String(gen.id));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, cls]);

  if (loading) return <Spinner />;
  if (error) return <ErrorBox message={error} />;
  const { customers, bands, types, recs } = data!;

  const ph = (Number(weight) || 0) / (Number(heads) || 1);
  const autoSku = weight
    ? bands.filter((b) => String(b.customer_id) === customerId)
        .sort((a, b) => Number(a.sort_order) - Number(b.sort_order))
        .find((b) => ph >= Number(b.min_kg ?? 0) && ph <= Number(b.max_kg ?? 999))?.band_code ?? null
    : null;

  async function save() {
    setSaving(true);
    const r = await rpc("rpc_save_fps_entry", {
      p_class: cls, p_customer_id: Number(customerId) || null, p_prod_date: prodDate,
      p_weight_kg: Number(weight) || 0, p_heads: Number(heads) || 0,
      p_crate_type_id: Number(crateTypeId) || null, p_expiry: expiry || null,
    });
    setSaving(false);
    setResult({ ok: Boolean(r.ok), message: String(r.message ?? "") });
    if (r.ok) {
      if (autoPrint && r.crateNo) {
        const win = window.open("", "_blank", "width=480,height=400");
        if (win) {
          win.document.write(`<pre style="font-family:Arial;font-size:16px;padding:16px">
<b>${String(r.crateNo)}</b>\nSKU ${String(r.sku)} · ${cls}\n${customers.find((c) => String(c.id) === customerId)?.name ?? ""}\n${Number(weight).toFixed(2)} kg · ${heads} heads\n${prodDate}${expiry ? " · exp " + expiry : ""}</pre>`);
          win.document.close(); win.print();
        }
      }
      setWeight(""); reload();
    }
  }

  const shown = recs.filter((r) =>
    (!search.trim() || String(r.crate_no).toLowerCase().includes(search.trim().toLowerCase())) &&
    (!fCust || String((r.customers as Row | null)?.name) === fCust) &&
    (!fSku || String(r.fps_band) === fSku));
  const skus = [...new Set(recs.map((r) => String(r.fps_band ?? "")))].filter(Boolean).sort();

  return (
    <>
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">FPS Entry</h1>
          <p className="mt-0.5 text-sm text-slate-500">Further Processing System — weigh & auto-assign SKU</p>
        </div>
        <div className="flex gap-2">
          <a href="#/wh/fps-receiving" className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">📄 Records</a>
          <a href="#/system/master-data" className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">⚙️ Manage Customers</a>
        </div>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <Field label="Class / Band">
            <select className={inputClass} value={cls} onChange={(e) => setCls(e.target.value)}>
              {FPS_CLASSES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </Field>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Field label="Production Date">
              <input type="date" className={inputClass} value={prodDate} onChange={(e) => setProdDate(e.target.value)} />
            </Field>
            <div>
              <Field label="Expiration Date (optional)">
                <input type="date" className={inputClass} value={expiry} onChange={(e) => setExpiry(e.target.value)} />
              </Field>
              <p className="mt-1 text-[11px] text-slate-400">Left blank → not printed on the label.</p>
            </div>
          </div>
          <div className="mt-3">
            <Field label="Customer">
              <select className={inputClass} value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                <option value="">Select customer…</option>
                {customers.map((c) => <option key={String(c.id)} value={String(c.id)}>{String(c.name)}</option>)}
              </select>
            </Field>
            {cls === "Class A" && <p className="mt-1 text-[11px] text-slate-400">Generic customer (auto-selected for Class A).</p>}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Field label="Weight (kg)">
              <input className={inputClass} inputMode="decimal" value={weight} placeholder="0" onChange={(e) => setWeight(e.target.value)} />
            </Field>
            <Field label="Heads (pcs)">
              <input className={inputClass} inputMode="numeric" value={heads} onChange={(e) => setHeads(e.target.value)} />
            </Field>
          </div>
          <div className="mt-3">
            <Field label="Crate Type">
              <select className={inputClass} value={crateTypeId} onChange={(e) => setCrateTypeId(e.target.value)}>
                {types.map((t) => <option key={String(t.id)} value={String(t.id)}>{String(t.name)}</option>)}
              </select>
            </Field>
          </div>
          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Auto SKU</div>
            {autoSku
              ? <div className="mt-0.5 text-xl font-bold text-emerald-700">{String(autoSku)} <span className="text-xs font-normal text-slate-400">{ph.toFixed(3)} kg/head</span></div>
              : <div className="mt-0.5 text-sm text-rose-500">{weight ? "No customer band matches — falls back to class ladder." : "— Enter a weight."}</div>}
          </div>
          <label className="mt-3 flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={autoPrint} onChange={(e) => setAutoPrint(e.target.checked)} />
            Auto-print label after saving
          </label>
          <Button className="mt-4 w-full py-3" disabled={saving} onClick={() => void save()}>
            {saving ? "Saving…" : "Save Entry"}
          </Button>
          <Result r={result} />
        </Card>

        <Card>
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-base font-bold text-slate-900">Today's FPS Records</div>
              <div className="text-sm text-slate-500">(yours)</div>
            </div>
            <div className="flex max-w-[420px] flex-wrap gap-2">
              <input className={`${inputClass} !w-36`} placeholder="Search crate #…" value={search} onChange={(e) => setSearch(e.target.value)} />
              <select className={`${inputClass} !w-36`} value={fCust} onChange={(e) => setFCust(e.target.value)}>
                <option value="">All customers</option>
                {[...new Set(recs.map((r) => String((r.customers as Row | null)?.name ?? "")))].filter(Boolean).map((n) => <option key={n}>{n}</option>)}
              </select>
              <select className={`${inputClass} !w-28`} value={fSku} onChange={(e) => setFSku(e.target.value)}>
                <option value="">All SKUs</option>
                {skus.map((s) => <option key={s}>{s}</option>)}
              </select>
              <span className="self-center text-sm text-slate-400">{shown.length}</span>
            </div>
          </div>
          <DataTable rows={shown} empty="No FPS entries yet today." headerWhenEmpty
            columns={[
              { key: "_n", header: "#", render: (r) => String(shown.indexOf(r) + 1) },
              { key: "crate_no", header: "Crate #", render: (r) => <span className="font-mono text-xs">{String(r.crate_no)}</span> },
              { key: "weighed_at", header: "Time", render: (r) => new Date(String(r.weighed_at)).toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" }) },
              { key: "fps_class", header: "Class" },
              { key: "cust", header: "Customer", render: (r) => String((r.customers as Row | null)?.name ?? "—") },
              { key: "fps_band", header: "SKU", render: (r) => <b className="text-emerald-700">{String(r.fps_band ?? "—")}</b> },
              { key: "net_weight_kg", header: "Wt", align: "right", render: (r) => kg(Number(r.net_weight_kg)) },
              { key: "heads", header: "Hd", align: "right" },
            ] as Column<Row>[]} />
        </Card>
      </div>
    </>
  );
}

export function FpsCustomers() {
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [newName, setNewName] = useState("");
  const [newBands, setNewBands] = useState<Array<{ code: string; min: string; max: string }>>([{ code: "", min: "", max: "" }]);
  const [edits, setEdits] = useState<Record<string, { name: string; bands: Array<{ code: string; min: string; max: string }> }>>({});

  const { data, error, loading, reload } = useLoad(async () => {
    const [customers, bands] = await Promise.all([
      rows(sb().from("customers").select("id,name").eq("is_active", true).order("name")),
      rows(sb().from("customer_sku_bands").select("customer_id,band_code,min_kg,max_kg,sort_order").order("sort_order")),
    ]);
    return { customers, bands };
  }, []);

  if (loading) return <Spinner />;
  if (error) return <ErrorBox message={error} />;
  const { customers, bands } = data!;

  const stateOf = (id: string, name: string) =>
    edits[id] ?? {
      name,
      bands: bands.filter((b) => String(b.customer_id) === id)
        .map((b) => ({ code: String(b.band_code), min: String(b.min_kg ?? ""), max: String(b.max_kg ?? "") })),
    };
  const setState = (id: string, s: { name: string; bands: Array<{ code: string; min: string; max: string }> }) =>
    setEdits((m) => ({ ...m, [id]: s }));

  async function act(fn: string, args: Record<string, unknown>) {
    const r = await rpc(fn, args);
    setResult({ ok: Boolean(r.ok), message: String(r.message ?? "") });
    if (r.ok) { setEdits({}); reload(); }
  }

  const BandRows = ({ bandsList, onChange }: {
    bandsList: Array<{ code: string; min: string; max: string }>;
    onChange: (b: Array<{ code: string; min: string; max: string }>) => void;
  }) => (
    <>
      {bandsList.map((b, i) => (
        <div key={i} className="mb-1.5 flex gap-1.5">
          <input className={`${inputClass} !w-40`} placeholder="SKU code" value={b.code}
            onChange={(e) => onChange(bandsList.map((x, j) => j === i ? { ...x, code: e.target.value } : x))} />
          <input className={`${inputClass} !w-24`} placeholder="from" value={b.min}
            onChange={(e) => onChange(bandsList.map((x, j) => j === i ? { ...x, min: e.target.value } : x))} />
          <input className={`${inputClass} !w-24`} placeholder="to" value={b.max}
            onChange={(e) => onChange(bandsList.map((x, j) => j === i ? { ...x, max: e.target.value } : x))} />
          <button className="rounded border border-rose-300 px-2 text-rose-600" onClick={() => onChange(bandsList.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      <button className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600"
        onClick={() => onChange([...bandsList, { code: "", min: "", max: "" }])}>+ Add band</button>
    </>
  );

  return (
    <>
      <div className="mb-5 flex items-center justify-between">
        <a href="#/fps/entry" className="rounded border border-slate-300 px-2.5 py-1 text-sm text-slate-600 hover:bg-slate-50">← FPS Entry</a>
        <h1 className="text-lg font-bold text-brand-700">FPS Customers & SKUs</h1>
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(260px,340px)_1fr]">
        <Card title="＋ Add Customer">
          <Field label="Customer name">
            <input className={inputClass} value={newName} onChange={(e) => setNewName(e.target.value)} />
          </Field>
          <div className="mt-3">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-slate-400">SKU bands (per-piece kg)</div>
            <BandRows bandsList={newBands} onChange={setNewBands} />
          </div>
          <Button className="mt-4 w-full" onClick={async () => {
            await act("rpc_save_fps_customer", { p_id: null, p_name: newName, p_bands: newBands });
            setNewName(""); setNewBands([{ code: "", min: "", max: "" }]);
          }}>Save Customer</Button>
          <Result r={result} />
        </Card>
        <div className="space-y-4">
          {customers.map((c) => {
            const id = String(c.id);
            const s = stateOf(id, String(c.name));
            return (
              <Card key={id}
                title={String(c.name)}
                action={<Button className="!px-3 !py-1 text-xs" onClick={() =>
                  act("rpc_save_fps_customer", { p_id: Number(id), p_name: s.name, p_bands: s.bands })}>Save</Button>}>
                <input className={`${inputClass} mb-2 !w-72`} value={s.name}
                  onChange={(e) => setState(id, { ...s, name: e.target.value })} />
                <BandRows bandsList={s.bands} onChange={(b) => setState(id, { ...s, bands: b })} />
                <div className="mt-2">
                  <button className="rounded border border-rose-300 px-2 py-1 text-xs text-rose-600"
                    onClick={() => act("rpc_delete_fps_customer", { p_id: Number(id) })}>Delete customer</button>
                </div>
              </Card>
            );
          })}
        </div>
      </div>
    </>
  );
}

/* ============================================================ FPS Scan Station
 * Keyboard-wedge QR scanner terminal. One input, two behaviours (decided by
 * the database): a Warehouse/Storage crate is moved to FPS; an FPS Entry
 * label is marked received in FPS. Matches the live PMAI screen 1:1.
 */
export function FpsStation() {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastKey, setLastKey] = useState("—");
  const [lastCode, setLastCode] = useState("—");
  const [lastAction, setLastAction] = useState("—");
  const [log, setLog] = useState<Array<Row & { at: number }>>([]);
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
    const res = await rpc("rpc_fps_scan", { p_code: value });
    setBusy(false);
    setLastCode(value);
    setLastAction(String(res.action ?? (res.ok ? "ok" : "skipped")));
    setLog((prev) => [{ ...(res as Row), at: Date.now() }, ...prev].slice(0, 300));
    setCode("");
    inputRef.current?.focus();
  }

  const moved = log.filter((l) => Boolean(l.ok)).length;
  const skipped = log.length - moved;

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <a href="#/fps/entry" className="text-sm text-slate-500 hover:text-slate-800">← FPS</a>
          <span className="text-slate-300">|</span>
          <h1 className="text-lg font-bold text-slate-900">FPS Scan Station</h1>
          <span className="rounded-full border border-violet-300 bg-violet-50 px-2.5 py-0.5 text-[10px] font-semibold tracking-wider text-violet-700">MOVE TO FPS</span>
        </div>
      </div>

      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-medium text-violet-700">
          <span className={`h-2.5 w-2.5 animate-pulse rounded-full ${busy ? "bg-amber-400" : "bg-violet-500"}`} />
          {busy ? "Working…" : <span><span className="animate-pulse font-semibold">Ready</span> — scan a QR code</span>}
        </div>
        <div className="flex items-center gap-5 text-sm text-slate-600">
          <span>Total: <strong>{num(log.length)}</strong></span>
          <span>Moved: <strong className="text-violet-700">{num(moved)}</strong></span>
          <span>Skipped: <strong className="text-amber-600">{num(skipped)}</strong></span>
          <button type="button" onClick={() => setLog([])}
            className="rounded-full border border-slate-300 px-3 py-1 text-xs text-slate-500 hover:bg-slate-50">
            Clear Log
          </button>
        </div>
      </div>

      <div className="-mx-5 mb-4 flex flex-wrap gap-8 bg-slate-100 px-5 py-1.5 font-mono text-xs text-slate-600 lg:-mx-8 lg:px-8">
        <span>last key:&nbsp;&nbsp;{lastKey}</span>
        <span>raw:&nbsp;&nbsp;{code || "—"}</span>
        <span>code:&nbsp;&nbsp;{lastCode}</span>
        <span>last action:&nbsp;&nbsp;{lastAction}</span>
      </div>

      <form onSubmit={scan}>
        <input ref={inputRef} value={code} autoFocus
          placeholder="Ready — scan a crate (→ FPS) or an FPS label (→ received)"
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => setLastKey(e.key === "Enter" ? "Enter" : e.key)}
          className="w-full rounded-xl border-0 px-5 py-4 font-mono text-base ring-2 ring-inset ring-violet-400 placeholder:text-slate-400 focus:ring-violet-500" />
      </form>

      {log.length === 0 ? (
        <div className="mt-24 text-center">
          <div className="mx-auto mb-3 grid h-12 w-12 grid-cols-2 gap-1 opacity-30">
            <span className="rounded border-2 border-slate-500" /><span className="rounded border-2 border-slate-500" />
            <span className="rounded border-2 border-slate-500" /><span />
          </div>
          <p className="text-lg font-semibold text-slate-500">Ready to scan</p>
          <p className="mt-1 text-sm text-slate-400">
            <b className="text-violet-600">Warehouse/Storage</b> crate → moved to FPS · <b className="text-rose-700">FPS label</b> → received in FPS
          </p>
        </div>
      ) : (
        <div className="thin-scroll mt-5 max-h-[480px] overflow-y-auto rounded-xl border border-slate-200 bg-white">
          <ul className="divide-y divide-slate-100">
            {log.map((l, i2) => (
              <li key={i2} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-sm">
                    <span className={l.ok ? "text-violet-600" : "text-amber-600"}>{l.ok ? "✓" : "✕"}</span>
                    <span className="truncate text-slate-700">{String(l.message ?? "")}</span>
                  </div>
                  {Boolean(l.crateNo) && <div className="truncate font-mono text-[11px] text-slate-400">{String(l.crateNo)}{l.sku ? ` · ${String(l.sku)}` : ""}</div>}
                </div>
                <span className="shrink-0 text-xs tabnum text-slate-400">
                  {l.weightKg ? `${kg(Number(l.weightKg))} kg` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

/* ================================================================ FPS Pallets
 * Manage FPS pallets: reassign crates between pallets, print pallet tags,
 * assign a pallet to a storage slot, delete. Mirrors the live PMAI screen —
 * palletizing itself happens at the FPS Receiving Station.
 */
export function FpsPallets() {
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; message: string } | null>(null);
  const [storeFor, setStoreFor] = useState<string>("");   // pallet id showing slot picker
  const [slotSel, setSlotSel] = useState<string>("");
  const [confirmDel, setConfirmDel] = useState<string>(""); // pallet id pending delete confirm
  const [reassign, setReassign] = useState<Record<string, string>>({}); // crate_no -> target

  const { data, error, loading, reload } = useLoad(async () => {
    const pallets = await rows(sb().from("pallets")
      .select("id,pallet_no,status,crate_count,total_weight_kg")
      .eq("kind", "fps").neq("status", "dispatched")
      .order("id", { ascending: false }).limit(60));
    const ids = pallets.map((p) => p.id as number);
    const crates = ids.length
      ? await rows(sb().from("crates")
          .select("crate_no,fps_band,fps_class,net_weight_kg,heads,production_date,pallet_id,customers!crates_fps_customer_id_fkey(name)")
          .in("pallet_id", ids).eq("is_voided", false).order("crate_no"))
      : [];
    const slots = await rows(sb().from("v_storage_map")
      .select("location_id,slot_code,room_name,room_available,is_occupied")
      .eq("is_occupied", false).eq("room_available", true).order("slot_code").limit(400));
    return { pallets, crates, slots };
  }, []);

  if (loading) return <Spinner />;
  if (error) return <ErrorBox message={error} />;
  const { pallets, crates, slots } = data!;

  async function act(fn: string, args: Record<string, unknown>) {
    const r = await rpc(fn, args);
    setMsg({ ok: Boolean(r.ok), message: String(r.message ?? "") });
    if (r.ok) { setStoreFor(""); setSlotSel(""); setConfirmDel(""); reload(); }
  }

  function printTag(p: Row, list: Row[]) {
    const cust = String((list[0]?.customers as Row | null)?.name ?? "");
    const band = String(list[0]?.fps_band ?? "");
    const heads = list.reduce((s, c) => s + Number(c.heads ?? 0), 0);
    const prod = list.reduce((m, c) => String(c.production_date) > m ? String(c.production_date) : m, "");
    void QRCode.toDataURL(String(p.pallet_no), { margin: 0, width: 220 }).then((qr) => {
      const win = window.open("", "_blank", "width=480,height=520");
      if (!win) return;
      win.document.write(`<html><head><style>
        @page { size: 100mm 75mm; margin: 4mm; }
        body { font-family: Arial; margin: 0; padding: 10px; }
        .row { display: flex; gap: 14px; align-items: center; }
        h1 { font-size: 26px; margin: 0 0 4px; }
        .meta { font-size: 15px; line-height: 1.5; }
        b.band { font-size: 20px; }
      </style></head><body>
        <div class="row">
          <img src="${qr}" width="150" height="150" />
          <div>
            <h1>${String(p.pallet_no)}</h1>
            <div class="meta">
              ${cust}${cust && band ? " · " : ""}<b class="band">${band}</b><br/>
              ${num(Number(p.crate_count ?? list.length))} crates · ${kg(Number(p.total_weight_kg ?? 0))} kg<br/>
              ${num(heads)} heads<br/>
              Prod: ${prod ? dateStr(prod) : "—"}
            </div>
          </div>
        </div>
      </body></html>`);
      win.document.close(); win.print();
    });
  }

  const needle = q.trim().toLowerCase();
  const shown = pallets.filter((p) => {
    if (!needle) return true;
    const list = crates.filter((c) => c.pallet_id === p.id);
    return String(p.pallet_no).toLowerCase().includes(needle) ||
      list.some((c) => String(c.fps_band ?? "").toLowerCase().includes(needle) ||
                       String((c.customers as Row | null)?.name ?? "").toLowerCase().includes(needle));
  });

  return (
    <>
      <div className="mb-5 rounded-xl bg-slate-900 px-5 py-4 text-white">
        <div className="text-[10px] font-semibold uppercase tracking-widest text-emerald-400">FPS Pallets</div>
        <h1 className="mt-0.5 text-lg font-bold">Manage FPS pallets — reassign crates, print tags, assign to storage</h1>
        <p className="mt-0.5 text-xs text-slate-400">
          Palletizing now happens at the <a href="#/wh/fps-receiving-station" className="font-semibold text-emerald-300 hover:underline">FPS Receiving Station</a> → (scan a label to receive it and pack it into a pallet in one step).
        </p>
      </div>

      <Card className="mb-5">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-slate-700">🔍 Find pallet</span>
          <input className={`${inputClass} !w-72`} placeholder="Search by pallet no., SKU, or customer…"
            value={q} onChange={(e) => setQ(e.target.value)} />
          {msg && <span className={`text-sm ${msg.ok ? "text-emerald-600" : "text-rose-600"}`}>{msg.message}</span>}
        </div>
      </Card>

      {shown.length === 0 ? (
        <p className="py-16 text-center text-sm text-slate-400">No FPS pallets yet — receive FPS labels at the FPS Receiving Station to build one.</p>
      ) : (
        <div className="grid gap-5 xl:grid-cols-2">
          {shown.map((p) => {
            const pid = String(p.id);
            const list = crates.filter((c) => c.pallet_id === p.id);
            const heads = list.reduce((s, c) => s + Number(c.heads ?? 0), 0);
            const prod = list.reduce((m, c) => String(c.production_date) > m ? String(c.production_date) : m, "");
            const cust = String((list[0]?.customers as Row | null)?.name ?? "—");
            const band = String(list[0]?.fps_band ?? "—");
            return (
              <Card key={pid}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <span className="rounded-md bg-slate-900 px-2.5 py-1 text-sm font-bold text-white">Pallet {String(p.pallet_no).replace(/^PLT-?/, "")}</span>
                    <span className="ml-2 rounded-md bg-amber-400 px-2 py-0.5 text-[11px] font-bold text-amber-900">{String(p.status) === "open" ? "Pending" : String(p.status)}</span>
                    <div className="mt-1.5 text-xs text-slate-500">{cust} · <b className="text-rose-700">{band}</b></div>
                  </div>
                  <div className="text-right text-xs leading-5 text-slate-500">
                    <b className="text-slate-700">{num(list.length)} crates · {kg(Number(p.total_weight_kg ?? 0))} kg</b><br/>
                    {num(heads)} heads<br/>
                    Prod: {prod ? dateStr(prod) : "—"}
                  </div>
                </div>

                <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                  <button onClick={() => printTag(p, list)}
                    className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100">🏷 Tag</button>
                  <button onClick={() => { setStoreFor(storeFor === pid ? "" : pid); setSlotSel(""); }}
                    className="rounded border border-emerald-700 bg-emerald-700 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-800">🏬 Store</button>
                  {confirmDel === pid ? (
                    <>
                      <button onClick={() => void act("rpc_delete_pallet", { p_pallet_id: p.id, p_delete_crates: false })}
                        className="rounded border border-rose-600 bg-rose-600 px-2 py-1 text-xs font-bold text-white">Confirm delete</button>
                      <button onClick={() => setConfirmDel("")}
                        className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600">Cancel</button>
                    </>
                  ) : (
                    <button onClick={() => setConfirmDel(pid)}
                      className="rounded border border-rose-300 px-2 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50">🗑 Delete</button>
                  )}
                </div>

                {storeFor === pid && (
                  <div className="mt-2 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-2">
                    <select className={`${inputClass} !w-64`} value={slotSel} onChange={(e) => setSlotSel(e.target.value)}>
                      <option value="">— choose a free slot —</option>
                      {slots.map((s) => (
                        <option key={String(s.location_id)} value={String(s.location_id)}>
                          {String(s.slot_code)} · {String(s.room_name)}
                        </option>
                      ))}
                    </select>
                    <Button disabled={!slotSel}
                      onClick={() => void act("rpc_close_pallet", { p_pallet_id: p.id, p_slot_id: Number(slotSel) })}>
                      Store here
                    </Button>
                  </div>
                )}

                <div className="thin-scroll mt-3 max-h-56 overflow-y-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                        <th className="py-1.5 pr-2">Batch</th><th className="py-1.5 pr-2">SKU</th>
                        <th className="py-1.5 pr-2">Wt</th><th className="py-1.5 pr-2">Heads</th>
                        <th className="py-1.5">Reassign</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {list.map((c) => {
                        const cn = String(c.crate_no);
                        return (
                          <tr key={cn}>
                            <td className="py-1.5 pr-2 font-mono text-[11px] text-slate-600">{cn}</td>
                            <td className="py-1.5 pr-2 font-semibold text-rose-700">{String(c.fps_band ?? "—")}</td>
                            <td className="py-1.5 pr-2 tabnum">{kg(Number(c.net_weight_kg))}</td>
                            <td className="py-1.5 pr-2 tabnum">{num(Number(c.heads ?? 0))}</td>
                            <td className="py-1.5">
                              <div className="flex items-center gap-1">
                                <select className="w-36 rounded border border-slate-300 px-1.5 py-1 text-xs"
                                  value={reassign[cn] ?? ""}
                                  onChange={(e) => setReassign((m) => ({ ...m, [cn]: e.target.value }))}>
                                  <option value="">— remove from pallet —</option>
                                  {pallets.filter((t) => t.id !== p.id).map((t) => (
                                    <option key={String(t.id)} value={String(t.id)}>→ Pallet {String(t.pallet_no).replace(/^PLT-?/, "")}</option>
                                  ))}
                                </select>
                                <button title="Apply"
                                  onClick={() => void act("rpc_reassign_crate", { p_crate_no: cn, p_pallet_id: reassign[cn] ? Number(reassign[cn]) : null })}
                                  className="rounded border border-slate-300 px-1.5 py-1 text-xs text-slate-600 hover:bg-slate-100">→</button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}

/* ========================================================== FPS Receiving
 * "FPS Production Output" — every FPS sticker (label) generated, how many
 * were scanned in at the receiving station, filterable by production date,
 * with Excel export and an inline per-SKU summary. Mirrors live PMAI.
 */
export function FpsReceiving() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [applied, setApplied] = useState<{ from: string; to: string }>({ from: "", to: "" });
  const [tab, setTab] = useState<"all" | "scanned" | "unscanned">("all");
  const [showSummary, setShowSummary] = useState(false);

  const { data, error, loading } = useLoad(async () => {
    let qy = sb().from("crates")
      .select("crate_no,fps_band,fps_class,net_weight_kg,heads,production_date,fps_received_at,pallet_id,customers!crates_fps_customer_id_fkey(name),users!crates_fps_received_by_fkey(full_name),crate_types(name),pallets!crates_pallet_id_fkey(pallet_no)")
      .not("fps_customer_id", "is", null).eq("is_voided", false)
      .order("fps_received_at", { ascending: false, nullsFirst: false })
      .limit(2000);
    if (applied.from) qy = qy.gte("production_date", applied.from);
    if (applied.to) qy = qy.lte("production_date", applied.to);
    return rows(qy);
  }, [applied]);

  if (loading) return <Spinner />;
  if (error) return <ErrorBox message={error} />;
  const all = data!;
  const scanned = all.filter((r) => r.fps_received_at);
  const unscanned = all.filter((r) => !r.fps_received_at);
  const sum = (list: Row[], k: string) => list.reduce((s, r) => s + Number(r[k] ?? 0), 0);
  const rate = all.length ? (scanned.length / all.length) * 100 : 0;
  const shown = tab === "all" ? all : tab === "scanned" ? scanned : unscanned;
  const tabTitle = tab === "all" ? "All Stickers" : tab === "scanned" ? "Scanned Stickers" : "Unscanned Stickers";

  const bySku = [...shown.reduce((m, r) => {
    const k = String(r.fps_band ?? "—");
    const cur = m.get(k) ?? { n: 0, kg: 0, heads: 0 };
    m.set(k, { n: cur.n + 1, kg: cur.kg + Number(r.net_weight_kg ?? 0), heads: cur.heads + Number(r.heads ?? 0) });
    return m;
  }, new Map<string, { n: number; kg: number; heads: number }>()).entries()].sort((a, b) => b[1].n - a[1].n);

  function exportExcel() {
    const wsRows = shown.map((r, i) => ({
      "#": shown.length - i,
      "Batch Code": String(r.crate_no),
      SKU: String(r.fps_band ?? ""),
      Class: String(r.fps_class ?? ""),
      Customer: String((r.customers as Row | null)?.name ?? ""),
      "Weight (kg)": Number(r.net_weight_kg ?? 0),
      Heads: Number(r.heads ?? 0),
      "Prod. Date": String(r.production_date ?? ""),
      "Scan Status": r.fps_received_at ? "Scanned" : "Unscanned",
      "Received At": r.fps_received_at ? dateTimeStr(r.fps_received_at) : "",
      "Received By": String((r.users as Row | null)?.full_name ?? ""),
      Pallet: String((r.pallets as Row | null)?.pallet_no ?? ""),
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(wsRows), "FPS Output");
    XLSX.writeFile(wb, `fps-output-${tab}.xlsx`);
  }

  const statCard = (label: string, value: string, sub: string, border: string, valueColor = "text-slate-900") => (
    <div className={`rounded-xl border-2 ${border} bg-white p-4`}>
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`mt-0.5 text-2xl font-bold ${valueColor}`}>{value}</div>
      <div className="mt-0.5 text-[11px] text-slate-400">{sub}</div>
    </div>
  );

  return (
    <>
      <div className="mb-5 rounded-xl bg-gradient-to-r from-slate-900 to-slate-800 px-6 py-5 text-white">
        <div className="text-[10px] font-semibold uppercase tracking-widest text-emerald-400">FPS Production Output</div>
        <h1 className="mt-1 text-2xl font-bold">{num(all.length)} Stickers Generated</h1>
        <p className="mt-0.5 text-xs text-emerald-200/70">{num(scanned.length)} scanned in · {num(unscanned.length)} not yet scanned</p>
      </div>

      <Card className="mb-5 !p-0"><div className="flex flex-wrap items-end gap-3 p-4">
        <Field label="Production Date — From">
          <input type="date" className={inputClass} value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="Production Date — To">
          <input type="date" className={inputClass} value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <Button onClick={() => setApplied({ from, to })}>Apply</Button>
        <button onClick={() => { setFrom(""); setTo(""); setApplied({ from: "", to: "" }); }}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">Show All Dates</button>
      </div></Card>

      <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {statCard("Generated Stickers", num(all.length), `${num(sum(all, "heads"))} heads · ${kg(sum(all, "net_weight_kg"))} kg`, "border-blue-500")}
        {statCard("Scanned In", num(scanned.length), `${num(sum(scanned, "heads"))} heads · ${kg(sum(scanned, "net_weight_kg"))} kg`, "border-emerald-600", "text-emerald-700")}
        {statCard("Unscanned", num(unscanned.length), `${num(sum(unscanned, "heads"))} heads · ${kg(sum(unscanned, "net_weight_kg"))} kg`, "border-amber-400", "text-amber-500")}
        {statCard("Scan Rate", `${rate.toFixed(1)}%`, "of generated stickers scanned in", "border-slate-300")}
      </div>

      <div className="mb-4 flex gap-1.5">
        {([["all", `All (${num(all.length)})`], ["scanned", `Scanned (${num(scanned.length)})`], ["unscanned", `Unscanned (${num(unscanned.length)})`]] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`rounded-md border px-3 py-1 text-xs font-medium ${
              tab === k ? "border-slate-900 bg-slate-900 text-white"
              : k === "unscanned" ? "border-amber-300 text-amber-600 hover:bg-amber-50"
              : "border-blue-300 text-blue-600 hover:bg-blue-50"}`}>
            {label}
          </button>
        ))}
      </div>

      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm font-bold text-slate-800">📋 {tabTitle} <span className="font-normal text-slate-400">({num(shown.length)})</span></div>
          <div className="flex flex-wrap gap-1.5">
            <button onClick={exportExcel}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">⬇ Export to Excel</button>
            <button onClick={() => setShowSummary((v) => !v)}
              className="rounded-lg border border-emerald-600 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50">📊 Summary</button>
            <a href="#/wh/fps-receiving-station"
              className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800">→ FPS Receiving Station</a>
          </div>
        </div>

        {showSummary && (
          <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50/60 p-3">
            <div className="mb-1.5 text-xs font-semibold text-emerald-800">Summary by SKU ({tabTitle})</div>
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-700">
              {bySku.map(([k, v]) => (
                <span key={k}><b className="text-rose-700">{k}</b> — {num(v.n)} stickers · {num(v.heads)} heads · {kg(v.kg)} kg</span>
              ))}
              {bySku.length === 0 && <span className="text-slate-400">Nothing to summarize.</span>}
            </div>
          </div>
        )}

        <DataTable rows={shown.slice(0, 200)} empty="No stickers in this view." headerWhenEmpty
          rowKey={(r) => String(r.crate_no)}
          columns={[
            { key: "_n", header: "#", render: (r) => <span className="tabnum text-slate-500">{num(shown.length - shown.indexOf(r))}</span> },
            { key: "crate_no", header: "Batch Code", render: (r) => <span className="rounded-full bg-emerald-900 px-2.5 py-1 font-mono text-[10px] font-semibold text-emerald-50">{String(r.crate_no)}</span> },
            { key: "fps_band", header: "SKU", render: (r) => <b>{String(r.fps_band ?? "—")}</b> },
            { key: "fps_class", header: "Class" },
            { key: "cust", header: "Customer", render: (r) => String((r.customers as Row | null)?.name ?? "—") },
            { key: "net_weight_kg", header: "Weight (kg)", render: (r) => `${Number(r.net_weight_kg).toFixed(3)} kg` },
            { key: "heads", header: "Heads", render: (r) => `${num(Number(r.heads ?? 0))} (${String((r.crate_types as Row | null)?.name ?? "").split(" ")[0] || "—"})` },
            { key: "production_date", header: "Prod. Date", render: (r) => dateStr(r.production_date) },
            { key: "st", header: "Scan Status", render: (r) => r.fps_received_at
                ? <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-semibold text-white">Scanned</span>
                : <span className="rounded-full bg-amber-400 px-2 py-0.5 text-[10px] font-semibold text-amber-900">Unscanned</span> },
            { key: "fps_received_at", header: "Received At", render: (r) => r.fps_received_at ? dateTimeStr(r.fps_received_at) : "—" },
            { key: "rb", header: "Received By", render: (r) => String((r.users as Row | null)?.full_name ?? "—").toUpperCase() },
            { key: "pallet", header: "Pallet", render: (r) => {
                const pn = String((r.pallets as Row | null)?.pallet_no ?? "");
                return pn ? <span className="rounded bg-slate-900 px-2 py-0.5 font-mono text-[10px] font-bold text-white">{pn.replace(/^PLT-?/, "")}</span> : "—";
              } },
            { key: "tag", header: "Tag", render: () => "—" },
          ] as Column<Row>[]} />
        {shown.length > 200 && <p className="mt-2 text-center text-xs text-slate-400">Showing latest 200 of {num(shown.length)} — narrow with the date filter or export to Excel for the full list.</p>}
      </Card>
    </>
  );
}
