"use client";

import { ScanStation } from "@/components/ScanStation";
import { receiveFromFps } from "./actions";

export function ScanClient({ locations }: { locations: { id: number; code: string; name: string }[] }) {
  return (
    <ScanStation
      title="Receive finished goods from FPS"
      subtitle="Scan crates coming back from further processing to book them into the warehouse."
      actionLabel="Receive crate"
      contextFields={
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-slate-600">Receive into (optional)</span>
          <select
            name="locationId"
            className="w-full rounded-lg border-0 px-3 py-2 text-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-brand-500"
          >
            <option value="">Leave where it is</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        </label>
      }
      onScan={async (code, ctx) => receiveFromFps(code, ctx.locationId ?? "")}
    />
  );
}
