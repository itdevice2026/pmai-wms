"use client";

import { useState, useTransition } from "react";
import { ScanStation } from "@/components/ScanStation";
import { Card, Field, Select, Button, Input } from "@/components/ui";
import { createIssuance, scanOntoIssuance, completeIssuance } from "./actions";
import { kg } from "@/lib/format";

const PURPOSES = [
  { value: "fps", label: "To Further Processing" },
  { value: "cutting", label: "To Cutting" },
  { value: "customer", label: "To Customer" },
  { value: "sample", label: "Sample" },
  { value: "disposal", label: "Disposal" },
];

export function IssuanceWorkbench({
  open,
  customers,
  jobOrders,
}: {
  open: { id: number; issuance_no: string; purpose: string; crate_count: number; total_weight_kg: string }[];
  customers: { id: number; name: string }[];
  jobOrders: { id: number; jo_no: string }[];
}) {
  const [issuanceId, setIssuanceId] = useState<string>(open[0] ? String(open[0].id) : "");
  const [purpose, setPurpose] = useState("fps");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const current = open.find((o) => String(o.id) === issuanceId);

  return (
    <div className="space-y-6">
      <Card title="Issuance document">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Active issuance" className="min-w-[240px]">
            <Select value={issuanceId} onChange={(e) => setIssuanceId(e.target.value)}>
              {open.length === 0 && <option value="">No open issuances</option>}
              {open.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.issuance_no} · {o.purpose} · {o.crate_count} crates
                </option>
              ))}
            </Select>
          </Field>

          <Button
            variant="secondary"
            disabled={!issuanceId || pending}
            onClick={() =>
              start(async () => {
                const r = await completeIssuance(issuanceId);
                setMsg(r.ok ? `Completed ${r.issuanceNo}` : (r.error ?? "Failed."));
                if (r.ok) setIssuanceId("");
              })
            }
          >
            Complete issuance
          </Button>
        </div>

        <form
          action={(fd) =>
            start(async () => {
              const r = await createIssuance(fd);
              setMsg(r.ok ? `Opened ${r.issuanceNo}` : (r.error ?? "Failed."));
              if (r.ok && r.issuanceId) setIssuanceId(String(r.issuanceId));
            })
          }
          className="mt-5 grid gap-3 border-t border-slate-100 pt-5 sm:grid-cols-2 lg:grid-cols-4"
        >
          <Field label="Purpose">
            <Select name="purpose" value={purpose} onChange={(e) => setPurpose(e.target.value)}>
              {PURPOSES.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Field>

          {purpose === "customer" ? (
            <Field label="Customer">
              <Select name="customerId" required>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <Field label="Job order (optional)">
              <Select name="jobOrderId">
                <option value="">None</option>
                {jobOrders.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.jo_no}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          <Field label="Remarks">
            <Input name="remarks" placeholder="Optional" />
          </Field>

          <div className="flex items-end">
            <Button type="submit" disabled={pending} className="w-full">
              + Open issuance
            </Button>
          </div>
        </form>

        {msg && <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">{msg}</p>}
        {current && (
          <p className="mt-3 text-sm text-slate-500">
            Scanning onto <strong className="text-slate-800">{current.issuance_no}</strong> —{" "}
            {current.crate_count} crates, {kg(current.total_weight_kg)} kg.
          </p>
        )}
      </Card>

      <ScanStation
        title="Scan crates to issue"
        subtitle="Each scan releases a crate from the warehouse onto this issuance."
        actionLabel="Issue crate"
        disabled={!issuanceId}
        disabledReason="Open or select an issuance first."
        onScan={async (code) => scanOntoIssuance(code, issuanceId)}
      />
    </div>
  );
}
