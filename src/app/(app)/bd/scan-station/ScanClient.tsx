"use client";

import { ScanStation } from "@/components/ScanStation";
import { scanIntoWarehouse } from "./actions";

export function ScanClient({
  locations,
}: {
  locations: { id: number; code: string; name: string }[];
}) {
  return (
    <ScanStation
      title="Receive into warehouse"
      subtitle="Each scan moves a crate from Production to Warehouse and stamps who did it."
      actionLabel="Receive crate"
      contextFields={
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-slate-600">
            Receive into (optional)
          </span>
          <select
            name="locationId"
            className="w-full rounded-lg border-0 px-3 py-2 text-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-brand-500"
          >
            <option value="">Leave where it is</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
      }
      onScan={async (code, ctx) => scanIntoWarehouse(code, ctx.locationId ?? "")}
    />
  );
}
