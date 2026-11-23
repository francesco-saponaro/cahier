"use client";

import { useState, type FormEvent } from "react";
import { z } from "zod";
import { inputs } from "@cahier/api";
import { CONTEXT_MIN, DESCRIPTION_MAX, INSTRUCTIONS_MAX, NAME_MAX, type ModelChoice, type VersionInput } from "@cahier/domain";
import { count, dollars } from "../../lib/format";
import { fieldErrors, type FieldErrors } from "../../lib/validate";
import { Alert, Button, Field, Input, Select, Textarea } from "../../ui/primitives";

/*
 * What a version of an agent is: a name, a description, its instructions, the model, the context
 * budget and the libraries it may read (only ones the person may read are offered). The form
 * checks the API's shape rules and the one data rule it can know here, the model's context size;
 * the rest (a library gone private since) comes back from the API.
 */

export interface LibraryChoice {
  id: string;
  name: string;
  visibility: "private" | "workspace";
  ownerName: string;
  indexedCount: number;
  documentCount: number;
}

const DEFAULT_CONTEXT = 8000;
/** A price is stored per thousand tokens; the public lists say it per million. */
const perMillion = (microsPer1k: number) => dollars(microsPer1k * 1000);
const schema = inputs.versionFields.extend({ name: z.string().trim().min(1).max(NAME_MAX) });

export function VersionForm({ models, libraries, initial, submitLabel = "Save draft", onSubmit, onCancel }: { models: ModelChoice[]; libraries: LibraryChoice[]; initial?: VersionInput | undefined; submitLabel?: string; onSubmit: (values: VersionInput) => Promise<string | null> | string | null; onCancel?: () => void }) {
  const [values, setValues] = useState<VersionInput>(initial ?? { name: "", description: "", instructions: "", modelId: models[0]?.id ?? "", maxContextTokens: DEFAULT_CONTEXT, libraryIds: [] });
  const [budgetText, setBudgetText] = useState(String(values.maxContextTokens));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [refusal, setRefusal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const model = models.find((m) => m.id === values.modelId);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const budget = Number(budgetText.replace(/[,\s]/g, ""));
    const candidate: VersionInput = { ...values, name: values.name.trim(), description: values.description.trim(), instructions: values.instructions.trim(), maxContextTokens: Number.isInteger(budget) ? budget : -1 };
    const found = fieldErrors(schema, candidate);
    if (!found["maxContextTokens"] && model && candidate.maxContextTokens > model.contextTokens) found["maxContextTokens"] = `At most ${count(model.contextTokens)} tokens for ${model.name}`;
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    setRefusal(null);
    try {
      setRefusal(await onSubmit(candidate));
    } finally {
      setBusy(false);
    }
  }

  const toggle = (id: string) => setValues((v) => ({ ...v, libraryIds: v.libraryIds.includes(id) ? v.libraryIds.filter((x) => x !== id) : [...v.libraryIds, id] }));

  return (
    <form onSubmit={submit} noValidate className="form-grid">
      <div className="row">
        <Field label="Name" error={errors["name"]} hint={`Up to ${NAME_MAX} characters`}>
          {(p) => <Input id={p.id} value={values.name} aria-invalid={p.invalid} aria-describedby={p.describedBy} onChange={(e) => setValues({ ...values, name: e.target.value })} />}
        </Field>
        <Field label="Description" error={errors["description"]} hint={`One line for the people who will pick it; up to ${DESCRIPTION_MAX} characters`}>
          {(p) => <Input id={p.id} value={values.description} aria-invalid={p.invalid} aria-describedby={p.describedBy} onChange={(e) => setValues({ ...values, description: e.target.value })} />}
        </Field>
      </div>
      <Field label="Instructions" error={errors["instructions"]} hint={`How it should answer; counted in the prompt of every question; up to ${count(INSTRUCTIONS_MAX)} characters`}>
        {(p) => <Textarea id={p.id} rows={4} value={values.instructions} aria-invalid={p.invalid} aria-describedby={p.describedBy} onChange={(e) => setValues({ ...values, instructions: e.target.value })} />}
      </Field>
      <div className="row">
        <Field label="Model" error={errors["modelId"]} hint={model ? `${model.prices.input !== null ? `${perMillion(model.prices.input)} per million input tokens` : "no input price in force"}, ${model.prices.output !== null ? `${perMillion(model.prices.output)} per million output` : "no output price"}; context up to ${count(model.contextTokens)} tokens` : "No model is enabled"}>
          {(p) => (
            <Select id={p.id} value={values.modelId} aria-invalid={p.invalid} aria-describedby={p.describedBy} onChange={(e) => setValues({ ...values, modelId: e.target.value })}>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Context budget" error={errors["maxContextTokens"]} hint={`Tokens of retrieved passages per question, at least ${CONTEXT_MIN}. More context, more sources, more cost.`}>
          {(p) => <Input id={p.id} inputMode="numeric" className="num" value={budgetText} aria-invalid={p.invalid} aria-describedby={p.describedBy} onChange={(e) => setBudgetText(e.target.value)} />}
        </Field>
      </div>
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend style={{ fontWeight: 500, marginBottom: 4 }}>Libraries it may read</legend>
        <p className="muted small" style={{ marginBottom: 4 }}>
          Your own and the ones shared with the workspace. A colleague using this agent still only gets passages from libraries they may read.
        </p>
        {libraries.length === 0 ? <p className="muted">No library to read yet.</p> : null}
        {libraries.map((l) => (
          <label key={l.id} className="check">
            <input type="checkbox" checked={values.libraryIds.includes(l.id)} onChange={() => toggle(l.id)} />
            <span>
              {l.name}
              <span className="sub">
                {l.visibility === "workspace" ? "Shared" : "Private"} · {l.ownerName} · {l.indexedCount} of {l.documentCount} indexed
              </span>
            </span>
          </label>
        ))}
        {errors["libraryIds"] ? <p className="error small">{errors["libraryIds"]}</p> : null}
      </fieldset>
      {refusal ? <Alert>{refusal}</Alert> : null}
      <div className="form-actions">
        {onCancel ? (
          <Button tone="ghost" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        <Button type="submit" tone="primary" disabled={busy || models.length === 0}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
