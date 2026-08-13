"use client";

import { useState, useTransition } from "react";
import { ScanStation } from "@/components/ScanStation";
import { Card, Field, Select, Input, Button } from "@/components/ui";
import { scanInput, recordOutput, closeRun } from "./actions";
import { kg, pct } from "@/lib/format";

export function StationClient({
  runs,
  products,
}: {
  runs: { id: number; fps_no: string; input_weight_kg: string; output_weight_kg: string; yield_pct: string | null }[];
  products: { id: number; sku: string; name: string }[];
}) {
  const [fpsId, setFpsId] = useState(runs[0] ? String(runs[0].id) : "");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const current = runs.find((r) => String(r.id) === fpsId);

  return (
    <div className="space-y-6">
      <Card title="Active run">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Processing run" className="min-w-[260px]">
            <Select value={fpsId} onChange={(e) => setFpsId(e.target.value)}>
              {runs.length === 0 && <option value="">No open runs — create one in FPS Entry</option>}
              {runs.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.fps_no} · in {kg(r.input_weight_kg)} / out {kg(r.output_weight_kg)} kg
                </option>
              ))}
            </Select>
          </Field>
          <Button
            variant="secondary"
            disabled={!fpsId || pending}
            onClick={() =>
              start(async () => {
                const r = await closeRun(fpsId);
                setMsg(r.ok ? `Closed ${r.fpsNo}` : (r.error ?? "Failed."));
                if (r.ok) setFpsId("");
              })
            }
          >
            Close run
          </Button>
        </div>

        {current && (
          <p className="mt-3 text-sm text-slate-500">
            <strong className="text-slate-800">{current.fps_no}</strong> — input {kg(current.input_weight_kg)} kg,
            output {kg(current.output_weight_kg)} kg
            {current.yield_pct ? `, yield ${pct(current.yield_pct, 2)}` : ""}.
          </p>
        )}

        <form
          action={(fd) =>
            start(async () => {
              const r = await recordOutput(fd);
              setMsg(r.ok ? `Produced ${r.crateNo}` : (r.error ?? "Failed."));
            })
          }
          className="mt-5 grid gap-3 border-t border-slate-100 pt-5 sm:grid-cols-2 lg:grid-cols-4"
        >
          <input type="hidden" name="fpsId" value={fpsId} />
          <Field label="Output product">
            <Select name="productId" required>
              {products.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
            </Select>
          </Field>
          <Field label="Weight (kg)">
            <Input name="weightKg" inputMode="decimal" required placeholder="0.00" />
          </Field>
          <Field label="Heads (optional)">
            <Input name="heads" inputMode="numeric" />
          </Field>
          <div className="flex items-end">
            <Button type="submit" disabled={!fpsId || pending} className="w-full">
              Record output crate
            </Button>
          </div>
        </form>

        {msg && <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">{msg}</p>}
      </Card>

      <ScanStation
        title="Scan input crates"
        subtitle="Issues warehouse crates into this processing run."
        actionLabel="Issue to run"
        disabled={!fpsId}
        disabledReason="Select an open run first."
        onScan={async (code) => scanInput(code, fpsId)}
      />
    </div>
  );
}
