"use client";

import { useState, type FormEvent } from "react";
import { inputs } from "@cahier/api";
import { passwordProblems } from "@cahier/domain";
import { fieldErrors, type FieldErrors } from "../../lib/validate";
import { Alert, Button, Field, Input } from "../../ui/primitives";

/*
 * Joining with an invitation: the token the admin passed on, a name, and a new password checked
 * against the same rule the API applies. A person who already has an account joins the new
 * workspace with the password they have; the API tells them if it does not match.
 */

export interface JoinValues {
  token: string;
  name: string;
  password: string;
}

export function JoinForm({ onSubmit }: { onSubmit: (values: JoinValues) => Promise<string | null> | string | null }) {
  const [values, setValues] = useState<JoinValues>({ token: "", name: "", password: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [refusal, setRefusal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = { token: values.token.trim(), name: values.name.trim(), password: values.password };
    const found = fieldErrors(inputs.acceptInvitation, trimmed);
    const problems = passwordProblems(trimmed.password);
    if (!found["password"] && problems.length > 0) found["password"] = `A password needs ${problems.join(", ")}`;
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    setRefusal(null);
    try {
      setRefusal(await onSubmit(trimmed));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <Field label="Invitation token" error={errors["token"]} hint="The admin who invited you passes it on; it is good for seven days">
        {(p) => <Input id={p.id} value={values.token} aria-invalid={p.invalid} aria-describedby={p.describedBy} onChange={(e) => setValues({ ...values, token: e.target.value })} />}
      </Field>
      <Field label="Your name" error={errors["name"]}>
        {(p) => <Input id={p.id} autoComplete="name" value={values.name} aria-invalid={p.invalid} aria-describedby={p.describedBy} onChange={(e) => setValues({ ...values, name: e.target.value })} />}
      </Field>
      <Field label="Password" error={errors["password"]} hint="At least 10 characters; your current one if you already have an account">
        {(p) => <Input id={p.id} type="password" autoComplete="new-password" value={values.password} aria-invalid={p.invalid} aria-describedby={p.describedBy} onChange={(e) => setValues({ ...values, password: e.target.value })} />}
      </Field>
      {refusal ? <Alert>{refusal}</Alert> : null}
      <Button type="submit" tone="primary" disabled={busy}>
        Join the workspace
      </Button>
    </form>
  );
}
