"use client";

import { useState, useTransition } from "react";
import { ScanStation } from "@/components/ScanStation";
import { Card, Field, Select, Button, Input } from "@/components/ui";
import { createDispatch, scanOntoDispatch, releaseDispatch } from "./actions";
import { kg, toISODate } from "@/lib/format";

export function DispatchWorkbench({
  open,
  customers,
  picklists,
  mayRelease,
}: {
  open: { id: number; dispatch_no: string; customer_name: string | null; total_weight_kg: string }[];
  customers: { id: number; name: string }[];
  picklists: { id: number; picklist_no: string; customer_id: number | null; picked_weight_kg: string }[];
  mayRelease: boolean;
}) {
  const [dispatchId, setDispatchId] = useState(open[0] ? String(open[0].id) : "");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const current = open.find((o) => String(o.id) === dispatchId);

  return (
    <div className="space-y-6">
      <Card title="Dispatch document">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Active dispatch" className="min-w-[260px]">
            <Select value={dispatchId} onChange={(e) => setDispatchId(e.target.value)}>
              {open.length === 0 && <option value="">No open dispatches</option>}
              {open.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.dispatch_no} · {o.customer_name ?? "—"} · {kg(o.total_weight_kg)} kg
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <form
          action={(fd) =>
            start(async () => {
              const r = await createDispatch(fd);
              setMsg(r.ok ? `Opened ${r.dispatchNo}` : (r.error ?? "Failed."));
              if (r.ok && r.dispatchId) setDispatchId(String(r.dispatchId));
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
          <Field label="From picklist (optional)">
            <Select name="picklistId">
              <option value="">None — scan directly</option>
              {picklists.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.picklist_no} · {kg(p.picked_weight_kg)} kg
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Dispatch date">
            <Input type="date" name="dispatchDate" defaultValue={toISODate()} />
          </Field>
          <div className="flex items-end">
            <Button type="submit" disabled={pending} className="w-full">+ Open dispatch</Button>
          </div>
        </form>

        {dispatchId && (
          <form
            action={(fd) =>
              start(async () => {
                const r = await releaseDispatch(fd);
                setMsg(r.ok ? `Released ${r.dispatchNo} — ${r.crates} crates` : (r.error ?? "Failed."));
                if (r.ok) setDispatchId("");
              })
            }
            className="mt-4 grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-2 lg:grid-cols-5"
          >
            <input type="hidden" name="dispatchId" value={dispatchId} />
            <Field label="DR no."><Input name="drNo" required /></Field>
            <Field label="Plate no."><Input name="plateNo" required /></Field>
            <Field label="Driver"><Input name="driverName" /></Field>
            <Field label="Truck temp °C" hint="Cold chain check">
              <Input name="truckTempC" inputMode="decimal" placeholder="-18.0" />
            </Field>
            <div className="flex items-end">
              <Button
                type="submit"
                variant="danger"
                disabled={pending || !mayRelease}
                title={mayRelease ? undefined : "Requires the 'Release dispatches' permission"}
                className="w-full"
              >
                Release &amp; depart
              </Button>
            </div>
          </form>
        )}

        {msg && <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">{msg}</p>}
        {current && (
          <p className="mt-3 text-sm text-slate-500">
            Loading <strong className="text-slate-800">{current.dispatch_no}</strong> —{" "}
            {kg(current.total_weight_kg)} kg on board.
          </p>
        )}
      </Card>

      <ScanStation
        title="Scan crates onto the vehicle"
        subtitle="Only picked crates can be loaded. Each scan is the final movement before departure."
        actionLabel="Load crate"
        disabled={!dispatchId}
        disabledReason="Open or select a dispatch first."
        onScan={async (code) => scanOntoDispatch(code, dispatchId)}
      />
    </div>
  );
}
