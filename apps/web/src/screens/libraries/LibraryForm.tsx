"use client";

import { useState, type FormEvent } from "react";
import { z } from "zod";
import { inputs } from "@cahier/api";
import { DESCRIPTION_MAX, NAME_MAX } from "@cahier/domain";
import { fieldErrors, type FieldErrors } from "../../lib/validate";
import { Alert, Button, Field, Input, Textarea } from "../../ui/primitives";

/* A library is a name and a description; the same form creates one and edits one. */

export interface LibraryValues {
  name: string;
  description: string;
}

const schema = inputs.libraryFields.extend({ name: z.string().trim().min(1).max(NAME_MAX) });

export function LibraryForm({ initial, onSubmit, onCancel }: { initial?: LibraryValues; onSubmit: (values: LibraryValues) => Promise<string | null> | string | null; onCancel?: () => void }) {
  const [values, setValues] = useState<LibraryValues>(initial ?? { name: "", description: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [refusal, setRefusal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = { name: values.name.trim(), description: values.description.trim() };
    const found = fieldErrors(schema, trimmed);
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
    <form onSubmit={submit} noValidate className="form-grid">
      <Field label="Name" error={errors["name"]} hint={`Up to ${NAME_MAX} characters`}>
        {(p) => <Input id={p.id} value={values.name} aria-invalid={p.invalid} aria-describedby={p.describedBy} onChange={(e) => setValues({ ...values, name: e.target.value })} />}
      </Field>
      <Field label="Description" error={errors["description"]} hint={`What goes in it, for the people who will read it; up to ${DESCRIPTION_MAX} characters`}>
        {(p) => <Textarea id={p.id} rows={3} value={values.description} aria-invalid={p.invalid} aria-describedby={p.describedBy} onChange={(e) => setValues({ ...values, description: e.target.value })} />}
      </Field>
      {refusal ? <Alert>{refusal}</Alert> : null}
      <div className="form-actions">
        {onCancel ? (
          <Button tone="ghost" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        <Button type="submit" tone="primary" disabled={busy}>
          {initial ? "Save" : "Create library"}
        </Button>
      </div>
    </form>
  );
}
