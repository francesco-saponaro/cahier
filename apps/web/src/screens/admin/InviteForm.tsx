"use client";

import { useState, type FormEvent } from "react";
import { inputs } from "@cahier/api";
import type { Role } from "@cahier/domain";
import { fieldErrors, type FieldErrors } from "../../lib/validate";
import { Alert, Button, Field, Input, Select } from "../../ui/primitives";

/* An invitation is an address and a role. The API answers the token, shown once by the screen. */

export interface InviteValues {
  email: string;
  role: Role;
}

export function InviteForm({ onSubmit }: { onSubmit: (values: InviteValues) => Promise<string | null> | string | null }) {
  const [values, setValues] = useState<InviteValues>({ email: "", role: "member" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [refusal, setRefusal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = { email: values.email.trim(), role: values.role };
    const found = fieldErrors(inputs.invite, trimmed);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    setRefusal(null);
    try {
      const refused = await onSubmit(trimmed);
      setRefusal(refused);
      if (!refused) setValues({ email: "", role: "member" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="form-grid">
      <Field label="Email" error={errors["email"]}>
        {(p) => <Input id={p.id} type="email" value={values.email} aria-invalid={p.invalid} aria-describedby={p.describedBy} onChange={(e) => setValues({ ...values, email: e.target.value })} />}
      </Field>
      <Field label="Role" error={errors["role"]} hint="An admin runs the workspace; a member works in it">
        {(p) => (
          <Select id={p.id} value={values.role} aria-describedby={p.describedBy} onChange={(e) => setValues({ ...values, role: e.target.value as Role })}>
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </Select>
        )}
      </Field>
      {refusal ? <Alert>{refusal}</Alert> : null}
      <div className="form-actions">
        <Button type="submit" tone="primary" disabled={busy}>
          Invite
        </Button>
      </div>
    </form>
  );
}
