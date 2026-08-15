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
