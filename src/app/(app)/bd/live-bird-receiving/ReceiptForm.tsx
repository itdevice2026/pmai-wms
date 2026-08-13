"use client";

import { useState, useTransition } from "react";
import { createReceipt } from "./actions";
import { Card, Field, Input, Select, Button, Textarea } from "@/components/ui";
import { toISODate } from "@/lib/format";

export function ReceiptForm({ growers }: { growers: { id: number; code: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [pending, start] = useTransition();

  if (!open) return <Button onClick={() => setOpen(true)}>+ Record receipt</Button>;

  return (
    <Card
      title="Record live bird receipt"
      action={
        <button onClick={() => setOpen(false)} className="text-sm text-slate-400 hover:text-slate-600">
          Cancel
        </button>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const form = e.currentTarget;
          start(async () => {
            const res = await createReceipt(fd);
            if (res.ok) {
              setMsg({ kind: "ok", text: `Recorded ${res.receiptNo}` });
              form.reset();
            } else {
              setMsg({ kind: "err", text: res.error ?? "Could not save." });
            }
          });
        }}
        className="space-y-4"
      >
        {msg && (
          <div
            className={`rounded-lg px-3 py-2 text-sm ring-1 ring-inset ${
              msg.kind === "ok"
                ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
                : "bg-rose-50 text-rose-700 ring-rose-200"
            }`}
          >
            {msg.text}
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Grower">
            <Select name="growerId" required>
              {growers.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Receipt date">
            <Input type="date" name="receiptDate" required defaultValue={toISODate()} />
          </Field>
          <Field label="Batch / lot no.">
            <Input name="batchNo" placeholder="Traceability lot" />
          </Field>
          <Field label="Plate no.">
            <Input name="plateNo" placeholder="ABC 1234" />
          </Field>

          <Field label="Driver">
            <Input name="driverName" />
          </Field>
          <Field label="Heads loaded">
            <Input name="headsLoaded" inputMode="numeric" defaultValue="0" />
          </Field>
          <Field label="Heads received">
            <Input name="headsReceived" inputMode="numeric" required defaultValue="0" />
          </Field>
          <Field label="Dead on arrival">
            <Input name="headsDoa" inputMode="numeric" defaultValue="0" />
          </Field>

          <Field label="Gross weight (kg)" hint="Truck in">
            <Input name="grossWeightKg" inputMode="decimal" required defaultValue="0" />
          </Field>
          <Field label="Tare weight (kg)" hint="Truck out / crates">
            <Input name="tareWeightKg" inputMode="decimal" defaultValue="0" />
          </Field>
          <Field label="Condemned" className="lg:col-span-1">
            <Input name="headsCondemned" inputMode="numeric" defaultValue="0" />
          </Field>
        </div>

        <Field label="Remarks">
          <Textarea name="remarks" rows={2} />
        </Field>

        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save receipt"}
        </Button>
      </form>
    </Card>
  );
}
