"use client";

import { useState, useTransition } from "react";
import { createUser } from "./actions";
import { Card, Field, Input, Select, Button } from "@/components/ui";

export function UserForm({ roles }: { roles: { id: number; code: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [pending, start] = useTransition();

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)}>+ Add user</Button>
    );
  }

  return (
    <Card title="Add user" action={<button onClick={() => setOpen(false)} className="text-sm text-slate-400 hover:text-slate-600">Cancel</button>}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const form = e.currentTarget;
          start(async () => {
            const res = await createUser(fd);
            if (res.ok) {
              setMsg({
                kind: "ok",
                text: `Created ${res.email}. Temporary password: ${res.password}`,
              });
              form.reset();
            } else {
              setMsg({ kind: "err", text: res.error ?? "Could not create the user." });
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

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Full name">
            <Input name="fullName" required placeholder="Juan Dela Cruz" />
          </Field>
          <Field label="Email">
            <Input name="email" type="email" required placeholder="juan.delacruz@pacifics.ph" />
          </Field>
          <Field label="Employee no.">
            <Input name="employeeNo" placeholder="Optional" />
          </Field>
          <Field label="Department">
            <Select name="department" defaultValue="Warehouse">
              {["Admin", "Production", "Warehouse", "FPS", "QA"].map((d) => (
                <option key={d}>{d}</option>
              ))}
            </Select>
          </Field>
          <Field label="Role">
            <Select name="roleId" required defaultValue={roles.find((r) => r.code === "warehouse")?.id}>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Temporary password" hint="Leave blank to generate one">
            <Input name="password" type="text" placeholder="Auto-generated" />
          </Field>
        </div>

        <Button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create user"}
        </Button>
      </form>
    </Card>
  );
}
