"use client";

import { useState, type FormEvent } from "react";
import { inputs } from "@cahier/api";
import { fieldErrors, type FieldErrors } from "../../lib/validate";
import { Alert, Button, Field, Input } from "../../ui/primitives";
import { Initial } from "../../ui/Initial";

/*
 * Email and password, validated with the API's own schema before anything is sent, and the
 * three demo accounts of the seed one click away. `onSubmit` answers the server's refusal as a
 * sentence, or null when the sign-in went through.
 */

export const DEMO_ACCOUNTS = [
  { id: "usr_lea", name: "Léa Marchetti", email: "lea@example.com", role: "Member" },
  { id: "usr_tom", name: "Tom Delaunay", email: "tom@example.com", role: "Member, with a private library and agent" },
  { id: "usr_noor", name: "Noor Haddad", email: "noor@example.com", role: "Admin" },
] as const;

export const DEMO_PASSWORD = "cahier-demo";

export interface SignInValues {
  email: string;
  password: string;
}

export function SignInForm({ onSubmit }: { onSubmit: (values: SignInValues) => Promise<string | null> | string | null }) {
  const [values, setValues] = useState<SignInValues>({ email: "", password: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [refusal, setRefusal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = { email: values.email.trim(), password: values.password };
    const found = fieldErrors(inputs.signIn, trimmed);
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
      <Field label="Email" error={errors["email"]}>
        {(p) => <Input id={p.id} type="email" autoComplete="username" value={values.email} aria-invalid={p.invalid} aria-describedby={p.describedBy} onChange={(e) => setValues({ ...values, email: e.target.value })} />}
      </Field>
      <Field label="Password" error={errors["password"]}>
        {(p) => <Input id={p.id} type="password" autoComplete="current-password" value={values.password} aria-invalid={p.invalid} aria-describedby={p.describedBy} onChange={(e) => setValues({ ...values, password: e.target.value })} />}
      </Field>
      {refusal ? <Alert>{refusal}</Alert> : null}
      <Button type="submit" tone="primary" disabled={busy}>
        Sign in
      </Button>
      <div>
        <p className="muted small" style={{ marginBottom: 6 }}>
          Demo accounts in the workspace Oriel, all with the password {DEMO_PASSWORD}
        </p>
        <div className="accounts">
          {DEMO_ACCOUNTS.map((a) => (
            <button key={a.id} type="button" className="account" onClick={() => setValues({ email: a.email, password: DEMO_PASSWORD })}>
              <Initial id={a.id} name={a.name} large />
              <span>
                <span className="name">{a.name}</span>
                <span className="sub">{a.role}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </form>
  );
}
