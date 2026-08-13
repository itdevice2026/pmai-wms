"use client";

import { useState, useTransition } from "react";
import { ScanStation } from "@/components/ScanStation";
import { Card, Field, Select, Button, Input, Badge } from "@/components/ui";
import { createPicklist, addLine, scanPick, suggestFefo, completePicklist } from "./actions";
import { kg, dateStr } from "@/lib/format";

type Suggestion = {
  crate_no: string;
  sku: string;
  production_date: string;
  net_weight_kg: string;
  location_code: string | null;
  age_days: number;
};

export function PicklistWorkbench({
  open,
  customers,
  skus,
}: {
  open: { id: number; picklist_no: string; customer_name: string | null; picked_weight_kg: string; total_weight_kg: string }[];
  customers: { id: number; name: string }[];
  skus: { id: number; sku: string; on_hand: number; oldest: string | null }[];
}) {
  const [picklistId, setPicklistId] = useState(open[0] ? String(open[0].id) : "");
  const [msg, setMsg] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [pending, start] = useTransition();

  const current = open.find((o) => String(o.id) === picklistId);

  return (
    <div className="space-y-6">
      <Card title="Picklist">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Active picklist" className="min-w-[260px]">
            <Select value={picklistId} onChange={(e) => setPicklistId(e.target.value)}>
              {open.length === 0 && <option value="">No open picklists</option>}
              {open.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.picklist_no} · {o.customer_name ?? "—"} · {kg(o.picked_weight_kg)}/{kg(o.total_weight_kg)} kg
                </option>
              ))}
            </Select>
          </Field>
          <Button
            variant="secondary"
            disabled={!picklistId || pending}
            onClick={() =>
              start(async () => {
                const r = await completePicklist(picklistId);
                setMsg(r.ok ? `Completed ${r.picklistNo}` : (r.error ?? "Failed."));
                if (r.ok) { setPicklistId(""); setSuggestions([]); }
              })
            }
          >
            Complete pick
          </Button>
        </div>

        <form
          action={(fd) =>
            start(async () => {
              const r = await createPicklist(fd);
              setMsg(r.ok ? `Opened ${r.picklistNo}` : (r.error ?? "Failed."));
              if (r.ok && r.picklistId) setPicklistId(String(r.picklistId));
            })
          }
          className="mt-5 grid gap-3 border-t border-slate-100 pt-5 sm:grid-cols-2 lg:grid-cols-4"
        >
          <Field label="Customer">
            <Select name="customerId" required>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Strategy">
            <Select name="strategy" defaultValue="fefo">
              <option value="fefo">FEFO — oldest expiry first</option>
              <option value="fifo">FIFO — oldest production first</option>
              <option value="manual">Manual</option>
            </Select>
          </Field>
          <Field label="Required date">
            <Input type="date" name="requiredDate" />
          </Field>
          <div className="flex items-end">
            <Button type="submit" disabled={pending} className="w-full">+ Open picklist</Button>
          </div>
        </form>

        {picklistId && (
          <form
            action={(fd) =>
              start(async () => {
                const r = await addLine(fd);
                setMsg(r.ok ? `Added ${r.sku} · ${r.requiredKg} kg` : (r.error ?? "Failed."));
              })
            }
            className="mt-4 flex flex-wrap items-end gap-3 border-t border-slate-100 pt-4"
          >
            <input type="hidden" name="picklistId" value={picklistId} />
            <Field label="Add SKU line" className="min-w-[220px]">
              <Select name="productId" required>
                {skus.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.sku} ({s.on_hand} crates on hand)
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Required kg">
              <Input name="requiredKg" inputMode="decimal" required placeholder="0.00" />
            </Field>
            <Button type="submit" variant="secondary" disabled={pending}>Add line</Button>
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await suggestFefo(picklistId);
                  setSuggestions(r.suggestions ?? []);
                  setMsg(r.ok ? `${r.suggestions?.length ?? 0} crates suggested` : (r.error ?? "Failed."));
                })
              }
            >
              Suggest crates (FEFO)
            </Button>
          </form>
        )}

        {msg && <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">{msg}</p>}
        {current && (
          <p className="mt-3 text-sm text-slate-500">
            Picking <strong className="text-slate-800">{current.picklist_no}</strong> for{" "}
            {current.customer_name ?? "—"} · {kg(current.picked_weight_kg)} of {kg(current.total_weight_kg)} kg picked.
          </p>
        )}
      </Card>

      {suggestions.length > 0 && (
        <Card title={`Suggested crates (${suggestions.length})`} padded={false}>
          <div className="thin-scroll max-h-72 overflow-y-auto">
            <table className="min-w-full text-sm">
              <thead className="sticky top-0 bg-slate-50">
                <tr className="border-b border-slate-200 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-2 text-left">Crate</th>
                  <th className="px-4 py-2 text-left">SKU</th>
                  <th className="px-4 py-2 text-left">Slot</th>
                  <th className="px-4 py-2 text-left">Prod. date</th>
                  <th className="px-4 py-2 text-right">Weight</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {suggestions.map((s) => (
                  <tr key={s.crate_no} className="hover:bg-slate-50">
                    <td className="px-4 py-2 font-mono text-xs text-slate-700">{s.crate_no}</td>
                    <td className="px-4 py-2 font-medium">{s.sku}</td>
                    <td className="px-4 py-2 font-mono text-xs text-slate-500">{s.location_code ?? "—"}</td>
                    <td className="px-4 py-2 text-slate-600">
                      {dateStr(s.production_date)} <Badge tone="amber">Day {s.age_days}</Badge>
                    </td>
                    <td className="px-4 py-2 text-right tabnum">{kg(s.net_weight_kg)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-slate-100 px-4 py-2.5 text-xs text-slate-500">
            Scan these crates below to confirm the pick — nothing moves until it is scanned.
          </p>
        </Card>
      )}

      <ScanStation
        title="Scan picked crates"
        subtitle="Confirms the physical pick and reserves the crate for dispatch."
        actionLabel="Confirm pick"
        disabled={!picklistId}
        disabledReason="Open or select a picklist first."
        onScan={async (code) => scanPick(code, picklistId)}
      />
    </div>
  );
}
