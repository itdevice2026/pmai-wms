"use client";

import { useState } from "react";
import { ScanStation } from "@/components/ScanStation";
import { doCrateTransfer, doPalletTransfer } from "@/app/(app)/wh/transfer-actions";
import type { TransferKind } from "@/lib/transfer-flow";

export function TransferClient({
  kind,
  unit,
  slots,
}: {
  kind: TransferKind;
  unit: "crate" | "pallet";
  slots: { id: number; code: string; room: string; occupied: boolean }[];
}) {
  const [slotId, setSlotId] = useState("");

  const options = unit === "pallet" ? slots.filter((s) => !s.occupied) : slots;

  return (
    <ScanStation
      title={unit === "pallet" ? "Scan pallet" : "Scan crate"}
      subtitle={
        unit === "pallet"
          ? "Scanning a pallet moves every crate on it to the destination slot."
          : "Each scan moves one crate to the destination slot."
      }
      actionLabel={unit === "pallet" ? "Move pallet" : "Move crate"}
      disabled={!slotId}
      disabledReason="Choose a destination slot before scanning."
      contextFields={
        <label className="block sm:col-span-2">
          <span className="mb-1.5 block text-xs font-medium text-slate-600">Destination slot</span>
          <select
            name="slotId"
            value={slotId}
            onChange={(e) => setSlotId(e.target.value)}
            className="w-full rounded-lg border-0 px-3 py-2 text-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-brand-500"
          >
            <option value="">Choose a slot…</option>
            {options.map((s) => (
              <option key={s.id} value={s.id}>
                {s.room} · {s.code}
                {s.occupied ? " (occupied)" : ""}
              </option>
            ))}
          </select>
        </label>
      }
      onScan={async (code, ctx) =>
        unit === "pallet"
          ? doPalletTransfer(code, ctx.slotId ?? slotId)
          : doCrateTransfer(kind, code, ctx.slotId ?? slotId)
      }
    />
  );
}
