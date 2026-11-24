"use client";

import { useId, useState, type FormEvent } from "react";
import { inputs } from "@cahier/api";
import { RETENTION_RANGE, type WorkspaceTools } from "@cahier/domain";
import { fieldErrors, type FieldErrors } from "../../lib/validate";
import { Alert, Button, Field, Input } from "../../ui/primitives";

/*
 * The workspace's tools and retention: three switches and a number of days, checked with the
 * API's own schema. One Save for the panel.
 */

export interface SettingsValues {
  tools: WorkspaceTools;
  retentionDays: number;
}

const TOOLS: { key: keyof WorkspaceTools; label: string; what: string }[] = [
  { key: "groundedAnswers", label: "Grounded answers", what: "Agents answer from their libraries. Off, every question is refused." },
  { key: "scheduledPrompts", label: "Scheduled prompts", what: "Members can schedule a prompt on a cadence; existing schedules stop running while this is off." },
  { key: "uploads", label: "Document upload", what: "Members can upload and replace documents in their libraries." },
];

export function SettingsForm({ initial, onSubmit }: { initial: SettingsValues; onSubmit: (values: SettingsValues) => Promise<string | null> | string | null }) {
  const [tools, setTools] = useState<WorkspaceTools>(initial.tools);
  const [retention, setRetention] = useState(String(initial.retentionDays));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [refusal, setRefusal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ids = useId();

  async function submit(event: FormEvent) {
    event.preventDefault();
    const values = { tools, retentionDays: Number(retention) };
    const found = fieldErrors(inputs.settingsUpdate, values);
    if (retention.trim() === "" || !Number.isInteger(Number(retention))) found["retentionDays"] = "A whole number of days";
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    setRefusal(null);
    try {
      setRefusal(await onSubmit(values));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="form-grid">
      <div>
        {TOOLS.map((tool) => (
          <div key={tool.key} className="check">
            <input id={`${ids}-${tool.key}`} type="checkbox" checked={tools[tool.key]} aria-describedby={`${ids}-${tool.key}-what`} onChange={(e) => setTools({ ...tools, [tool.key]: e.target.checked })} />
            <div>
              <label htmlFor={`${ids}-${tool.key}`}>{tool.label}</label>
              <span className="sub" id={`${ids}-${tool.key}-what`}>
                {tool.what}
              </span>
            </div>
          </div>
        ))}
      </div>
      <Field label="Keep archived conversations for" error={errors["retentionDays"]} hint={`Days, ${RETENTION_RANGE.min} to ${RETENTION_RANGE.max}; after that the messages are deleted and the usage stays`}>
        {(p) => <Input id={p.id} inputMode="numeric" value={retention} aria-invalid={p.invalid} aria-describedby={p.describedBy} onChange={(e) => setRetention(e.target.value)} style={{ maxWidth: 160 }} />}
      </Field>
      {refusal ? <Alert>{refusal}</Alert> : null}
      <div className="form-actions" style={{ justifyContent: "flex-start" }}>
        <Button type="submit" tone="primary" disabled={busy}>
          Save settings
        </Button>
      </div>
    </form>
  );
}
