import Link from "next/link";
import { q } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { Card } from "@/components/ui";
import { kg, num } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Storage Map · PMAI Warehouse" };

type Room = {
  id: number;
  code: string;
  name: string;
  kind: string;
  room_no: number | null;
  is_available: boolean;
  capacity_pallets: number | null;
  evaporator_position: string | null;
};

type Slot = {
  aisle_id: number;
  aisle_code: string;
  aisle_side: string;
  aisle_row: number;
  location_id: number;
  slot_code: string;
  level_no: number;
  deep_no: number;
  pallet_id: number | null;
  pallet_no: string | null;
  crate_count: number | null;
  total_weight_kg: string | null;
  is_occupied: boolean;
};

const KIND_LABEL: Record<string, string> = {
  freezer: "Freezer",
  chiller: "Chiller",
  blast_freezer: "Blast Freezer",
  dry: "Dry Store",
  staging: "Staging",
};

export default async function StorageMapPage({
  searchParams,
}: {
  searchParams: Promise<{ room?: string; available?: string }>;
}) {
  await requirePermission("wh.storage_map.view");
  const { room: roomParam, available } = await searchParams;
  const onlyAvailable = available === "1";

  const rooms = await q<Room>(
    `SELECT id, code, name, kind::text AS kind, room_no, is_available,
            capacity_pallets, evaporator_position
       FROM storage_rooms WHERE is_active ORDER BY sort_order, id`
  );

  if (rooms.length === 0) {
    return <p className="text-sm text-slate-500">No storage rooms configured.</p>;
  }

  const idx = Math.max(0, rooms.findIndex((r) => String(r.id) === roomParam));
  const room = rooms[idx] ?? rooms[0];
  const prev = rooms[idx - 1];
  const next = rooms[idx + 1];

  const slots = await q<Slot>(
    `SELECT aisle_id, aisle_code, aisle_side, aisle_row, location_id, slot_code,
            level_no, deep_no, pallet_id, pallet_no, crate_count, total_weight_kg, is_occupied
       FROM v_storage_map WHERE room_id = $1
      ORDER BY aisle_row, aisle_side DESC, level_no DESC, deep_no`,
    [room.id]
  );

  const total = slots.length;
  const occupied = slots.filter((s) => s.is_occupied).length;
  const availableCount = total - occupied;

  // Group into aisles, then arrange into left/right pairs by row_index
  const aisles = new Map<number, { code: string; side: string; row: number; slots: Slot[] }>();
  for (const s of slots) {
    if (!aisles.has(s.aisle_id))
      aisles.set(s.aisle_id, { code: s.aisle_code, side: s.aisle_side, row: s.aisle_row, slots: [] });
    aisles.get(s.aisle_id)!.slots.push(s);
  }
  type Aisle = { code: string; side: string; row: number; slots: Slot[] };
  const rows = new Map<number, { left?: Aisle; right?: Aisle }>();
  for (const a of aisles.values()) {
    if (!rows.has(a.row)) rows.set(a.row, {});
    const entry = rows.get(a.row)!;
    if (a.side === "left") entry.left = a;
    else entry.right = a;
  }
  const rowKeys = [...rows.keys()].sort((a, b) => a - b);

  const maxLevel = Math.max(...slots.map((s) => s.level_no), 1);
  const maxDeep = Math.max(...slots.map((s) => s.deep_no), 1);

  return (
    <>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Storage Map</h1>
          <p className="mt-1 text-sm text-slate-500">
            Slot availability by room · aisle · level · deep
          </p>
        </div>
        <div className="no-print flex items-center gap-4">
          <Link
            href={`/wh/storage-map?room=${room.id}&available=${onlyAvailable ? "0" : "1"}`}
            className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900"
          >
            <span
              className={`flex h-4 w-4 items-center justify-center rounded border ${
                onlyAvailable ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300 bg-white"
              }`}
            >
              {onlyAvailable && (
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4">
                  <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </span>
            Show only available
          </Link>
        </div>
      </div>

      {/* Room selector bar */}
      <Card className="mb-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link
              href={prev ? `/wh/storage-map?room=${prev.id}` : "#"}
              aria-disabled={!prev}
              className={`flex h-9 w-9 items-center justify-center rounded-lg border border-slate-300 text-slate-500 ${
                prev ? "hover:bg-slate-50" : "pointer-events-none opacity-40"
              }`}
            >
              ‹
            </Link>

            <form action="/wh/storage-map" className="contents">
              <select
                name="room"
                defaultValue={String(room.id)}
                className="rounded-lg border-0 bg-white px-3 py-2 text-sm font-medium text-slate-800 ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-brand-500"
              >
                {rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
              <button type="submit" className="sr-only">
                Go
              </button>
            </form>

            <Link
              href={next ? `/wh/storage-map?room=${next.id}` : "#"}
              aria-disabled={!next}
              className={`flex h-9 w-9 items-center justify-center rounded-lg border border-slate-300 text-slate-500 ${
                next ? "hover:bg-slate-50" : "pointer-events-none opacity-40"
              }`}
            >
              ›
            </Link>

            <span className="ml-1 inline-flex items-center gap-1.5 rounded-full bg-sky-50 px-3 py-1.5 text-sm font-medium text-sky-700 ring-1 ring-inset ring-sky-200">
              ❄ {KIND_LABEL[room.kind] ?? room.kind}
            </span>

            <span className="ml-2 flex items-center gap-2 text-sm">
              <span className={room.is_available ? "text-emerald-600" : "text-slate-400"}>
                {room.is_available ? "ON" : "OFF"}
              </span>
              <span
                className={`relative h-6 w-11 rounded-full transition ${
                  room.is_available ? "bg-emerald-500" : "bg-slate-300"
                }`}
              >
                <span
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
                    room.is_available ? "left-[22px]" : "left-0.5"
                  }`}
                />
              </span>
            </span>
          </div>

          <div className="flex items-center gap-5 text-sm">
            <span className="text-slate-500">
              Available <strong className="tabnum text-emerald-600">{num(availableCount)}</strong>{" "}
              / {num(total)}
            </span>
            <span className="text-slate-500">
              Occupied <strong className="tabnum text-slate-800">{num(occupied)}</strong>
            </span>
          </div>
        </div>
      </Card>

      <Card>
        {!room.is_available && (
          <div className="mb-5 rounded-lg bg-slate-100 px-4 py-3 text-sm text-slate-600">
            This room is <strong>OFF</strong> — not available for putting pallets away.
          </div>
        )}

        {/* Legend */}
        <div className="mb-6 flex flex-wrap items-center gap-6 rounded-lg bg-slate-50 px-4 py-3 text-xs text-slate-600">
          <div className="flex items-center gap-2">
            <div className="flex flex-col items-center gap-0.5">
              <span className="text-[9px] text-slate-400">▲ top</span>
              <div className="grid grid-cols-3 gap-0.5">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <span
                    key={i}
                    className={`h-3 w-3 rounded-sm ${i % 3 === 2 ? "bg-emerald-300" : "bg-slate-200"}`}
                  />
                ))}
              </div>
              <span className="text-[9px] text-slate-400">▼ floor</span>
            </div>
          </div>
          <p className="max-w-4xl leading-relaxed">
            <strong>How to read this:</strong> each grid is <strong>one aisle</strong> drawn as a
            schematic — you see its whole height and how deep it goes at once (it&apos;s not a
            front/side photo).
            <br />
            <span className="text-slate-500">
              ↕ <strong>Rows = Level</strong> — how high the pallet sits (top row = highest). · ↔{" "}
              <strong>Columns = Deep</strong> — how far in (column 1 = front, where the forklift
              loads; higher = deeper inside).
            </span>
          </p>
        </div>

        {room.evaporator_position && (
          <div className="mb-6 flex justify-center">
            <span className="rounded-lg bg-sky-50 px-6 py-2 text-xs font-semibold uppercase tracking-widest text-sky-700 ring-1 ring-inset ring-sky-200">
              ❄ Evaporator
            </span>
          </div>
        )}

        <div className="space-y-8">
          {rowKeys.map((rk) => {
            const pair = rows.get(rk)!;
            return (
              <div key={rk} className="flex items-start justify-center gap-0">
                <AisleGrid aisle={pair.left} maxLevel={maxLevel} maxDeep={maxDeep} onlyAvailable={onlyAvailable} />
                <div className="mx-4 flex h-40 w-8 items-center justify-center self-center">
                  <span className="rotate-90 whitespace-nowrap text-[9px] font-semibold uppercase tracking-[0.2em] text-slate-300">
                    Aisle
                  </span>
                </div>
                <AisleGrid aisle={pair.right} maxLevel={maxLevel} maxDeep={maxDeep} onlyAvailable={onlyAvailable} />
              </div>
            );
          })}
        </div>
      </Card>
    </>
  );
}

function AisleGrid({
  aisle,
  maxLevel,
  maxDeep,
  onlyAvailable,
}: {
  aisle?: { code: string; side: string; row: number; slots: Slot[] };
  maxLevel: number;
  maxDeep: number;
  onlyAvailable: boolean;
}) {
  if (!aisle) return <div className="w-[220px]" />;

  const free = aisle.slots.filter((s) => !s.is_occupied).length;
  const byPos = new Map(aisle.slots.map((s) => [`${s.level_no}-${s.deep_no}`, s]));
  const levels = Array.from({ length: maxLevel }, (_, i) => maxLevel - i);
  const deeps = Array.from({ length: maxDeep }, (_, i) => i + 1);

  return (
    <div className="w-[220px]">
      <div className="text-center">
        <div className="text-base font-semibold text-slate-700">{aisle.code}</div>
        <div className="text-[11px] text-slate-400">
          {free} free · {maxDeep} deep
        </div>
        <div className="mt-1 inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-[9px] text-slate-500">
          Deep: front → back ▶
        </div>
      </div>

      <table className="mt-2 w-full border-separate border-spacing-1">
        <thead>
          <tr>
            <th className="w-8 text-[9px] font-normal text-slate-400">Lvl</th>
            {deeps.map((d) => (
              <th key={d} className="text-[10px] font-normal text-slate-400">
                {d}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {levels.map((lv) => (
            <tr key={lv}>
              <td className="text-[10px] text-slate-400">L{String(lv).padStart(2, "0")}</td>
              {deeps.map((d) => {
                const s = byPos.get(`${lv}-${d}`);
                if (!s) return <td key={d} />;
                if (onlyAvailable && s.is_occupied) return <td key={d} />;
                return (
                  <td key={d}>
                    <div
                      title={
                        s.is_occupied
                          ? `${s.slot_code}\n${s.pallet_no} · ${s.crate_count} crates · ${kg(s.total_weight_kg)} kg`
                          : `${s.slot_code} — empty`
                      }
                      className={`flex h-9 w-full items-center justify-center rounded text-xs font-medium transition ${
                        s.is_occupied
                          ? "bg-slate-300 text-slate-600 hover:bg-slate-400"
                          : "bg-emerald-200 text-emerald-800 hover:bg-emerald-300"
                      }`}
                    >
                      {s.deep_no}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
