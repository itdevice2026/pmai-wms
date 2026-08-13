import { q } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { Card, Badge, Field, Input, Select, Button, Textarea } from "@/components/ui";
import { dateStr, dateTimeStr } from "@/lib/format";
import { createLock, releaseLock } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Locked Records · PMAI Warehouse" };

const LOCKABLE = [
  { value: "weighing_records", label: "Weighing records" },
  { value: "crates", label: "Crates" },
  { value: "live_bird_receipts", label: "Live bird receipts" },
  { value: "issuances", label: "Issuances" },
  { value: "dispatches", label: "Dispatches" },
];

type Lock = {
  id: number;
  entity: string;
  entity_id: string | null;
  period_from: string | null;
  period_to: string | null;
  reason: string | null;
  locked_at: string;
  locked_by_name: string | null;
  unlocked_at: string | null;
  unlocked_by_name: string | null;
  is_active: boolean;
};

export default async function LockedRecordsPage() {
  await requirePermission("sys.locks.manage");

  const locks = await q<Lock>(
    `SELECT l.id, l.entity, l.entity_id, l.period_from, l.period_to, l.reason,
            l.locked_at, lu.full_name AS locked_by_name,
            l.unlocked_at, uu.full_name AS unlocked_by_name, l.is_active
       FROM locked_records l
       LEFT JOIN users lu ON lu.id = l.locked_by
       LEFT JOIN users uu ON uu.id = l.unlocked_by
      ORDER BY l.is_active DESC, l.locked_at DESC`
  );

  const activeLocks = locks.filter((l) => l.is_active);

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Locked Records</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          Freeze a period so no new entries or edits can be posted against it — used after a day is
          reconciled. Locks are enforced when saving, not just displayed.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Lock a period" className="lg:col-span-1">
          <form action={createLock} className="space-y-4">
            <Field label="Record type">
              <Select name="entity" required defaultValue="weighing_records">
                {LOCKABLE.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="From">
                <Input type="date" name="periodFrom" required />
              </Field>
              <Field label="To">
                <Input type="date" name="periodTo" required />
              </Field>
            </div>
            <Field label="Reason">
              <Textarea name="reason" placeholder="e.g. Day reconciled and reported to finance" />
            </Field>
            <Button type="submit" className="w-full">
              Lock period
            </Button>
          </form>
        </Card>

        <div className="space-y-6 lg:col-span-2">
          <Card title={`Active locks (${activeLocks.length})`} padded={false}>
            {activeLocks.length === 0 ? (
              <p className="px-5 py-10 text-center text-sm text-slate-400">
                Nothing is locked. All periods are open for posting.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {activeLocks.map((l) => (
                  <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
                    <div>
                      <div className="flex items-center gap-2">
                        <Badge tone="red">{l.entity.replace(/_/g, " ")}</Badge>
                        <span className="text-sm font-medium text-slate-800">
                          {dateStr(l.period_from)} → {dateStr(l.period_to)}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {l.reason ? `${l.reason} · ` : ""}
                        Locked by {l.locked_by_name ?? "—"} on {dateTimeStr(l.locked_at)}
                      </div>
                    </div>
                    <form action={releaseLock}>
                      <input type="hidden" name="id" value={l.id} />
                      <Button type="submit" variant="secondary">
                        Unlock
                      </Button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="History" padded={false}>
            {locks.filter((l) => !l.is_active).length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-slate-400">No released locks yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {locks
                  .filter((l) => !l.is_active)
                  .map((l) => (
                    <li key={l.id} className="px-5 py-3">
                      <div className="text-sm text-slate-600">
                        <Badge>{l.entity.replace(/_/g, " ")}</Badge>{" "}
                        {dateStr(l.period_from)} → {dateStr(l.period_to)}
                      </div>
                      <div className="mt-1 text-xs text-slate-400">
                        Unlocked by {l.unlocked_by_name ?? "—"} on {dateTimeStr(l.unlocked_at)}
                      </div>
                    </li>
                  ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
