"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { changePassword } from "./actions";
import { Field, Input } from "@/components/ui";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-700 disabled:opacity-60"
    >
      {pending ? "Changing…" : "Change password"}
    </button>
  );
}

export function PasswordForm() {
  const [state, action] = useActionState(changePassword, { ok: false });

  return (
    <form action={action} className="max-w-md space-y-4">
      {state?.error && (
        <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-inset ring-rose-200">
          {state.error}
        </div>
      )}
      {state?.ok && state.message && (
        <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 ring-1 ring-inset ring-emerald-200">
          {state.message}
        </div>
      )}

      <Field label="Current password">
        <Input name="current" type="password" autoComplete="current-password" required />
      </Field>
      <Field label="New password" hint="At least 10 characters, with a letter and a number.">
        <Input name="next" type="password" autoComplete="new-password" required />
      </Field>
      <Field label="Confirm new password">
        <Input name="confirm" type="password" autoComplete="new-password" required />
      </Field>

      <Submit />
    </form>
  );
}
