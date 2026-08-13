"use client";

import { useState, useTransition } from "react";
import { ScanStation } from "@/components/ScanStation";
import { addCrateToPallet, openPallet, closeAndPutaway } from "./actions";
import { Card, Button, Field, Select } from "@/components/ui";

export function PalletBuilder({
  openPallets,
  slots,
}: {
  openPallets: { id: string; pallet_no: string; crate_count: number }[];
  slots: { id: number; code: string; room: string }[];
}) {
  const [palletId, setPalletId] = useState(openPallets[0]?.id ?? "");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const current = openPallets.find((p) => p.id === palletId);

  return (
    <div className="space-y-6">
      <Card title="Active pallet">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Build onto pallet" className="min-w-[220px]">
            <Select value={palletId} onChange={(e) => setPalletId(e.target.value)}>
              {openPallets.length === 0 && <option value="">No open pallets</option>}
              {openPallets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.pallet_no} ({p.crate_count} crates)
                </option>
              ))}
            </Select>
          </Field>

          <Button
            variant="secondary"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await openPallet();
                setMsg(r.ok ? `Started ${r.palletNo}` : (r.error ?? "Could not start a pallet."));
                if (r.ok && r.palletId) setPalletId(r.palletId);
              })
            }
          >
            + Start new pallet
          </Button>

          <form
            action={(fd) =>
              start(async () => {
                const r = await closeAndPutaway(fd);
                setMsg(r.ok ? `Put away ${r.palletNo} into ${r.slotCode}` : (r.error ?? "Failed."));
              })
            }
            className="flex items-end gap-3"
          >
            <input type="hidden" name="palletId" value={palletId} />
            <Field label="Put away into slot" className="min-w-[240px]">
              <Select name="slotId" required>
                <option value="">Choose an empty slot…</option>
                {slots.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.room} · {s.code}
                  </option>
                ))}
              </Select>
            </Field>
            <Button type="submit" disabled={!palletId || pending}>
              Close &amp; put away
            </Button>
          </form>
        </div>

        {msg && (
          <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">{msg}</p>
        )}
        {current && (
          <p className="mt-3 text-sm text-slate-500">
            Scanning onto <strong className="text-slate-800">{current.pallet_no}</strong> —{" "}
            {current.crate_count} crates so far.
          </p>
        )}
      </Card>

      <ScanStation
        title="Add crates to pallet"
        subtitle="Scan each received crate to attach it to the active pallet."
        actionLabel="Add to pallet"
        disabled={!palletId}
        disabledReason="Start or select an open pallet first."
        onScan={async (code) => addCrateToPallet(code, palletId)}
      />
    </div>
  );
}
