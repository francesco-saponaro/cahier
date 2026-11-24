"use client";

import { useState, type FormEvent } from "react";
import { z } from "zod";
import { inputs } from "@cahier/api";
import { NAME_MAX, PROMPT_MAX, type Cadence, type ScheduleInput } from "@cahier/domain";
import { fieldErrors, type FieldErrors } from "../../lib/validate";
import { Alert, Button, Field, Input, Select, Textarea } from "../../ui/primitives";
import { minuteOf } from "./cadence";

/*
 * A scheduled prompt: which agent, what to ask, and when. The time is typed as HH:MM in the
 * person's own zone and sent as a minute of the day; the weekday and the day of the month are
 * asked only when the cadence needs them, and checked with the API's schema plus the two rules
 * the schema leaves to the use case (a weekly schedule needs a weekday, a monthly one a day).
 */

export interface AgentChoice {
  id: string;
  name: string;
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const schema = inputs.scheduleCreate.extend({ name: z.string().trim().min(1).max(NAME_MAX), prompt: z.string().trim().min(1).max(PROMPT_MAX) });

interface Draft {
  agentId: string;
  name: string;
  prompt: string;
  cadence: Cadence;
  time: string;
  weekday: string;
  dayOfMonth: string;
}

export function ScheduleForm({ agents, timezone, onSubmit, onCancel }: { agents: AgentChoice[]; timezone: string; onSubmit: (values: ScheduleInput) => Promise<string | null> | string | null; onCancel?: () => void }) {
  const [draft, setDraft] = useState<Draft>({ agentId: agents[0]?.id ?? "", name: "", prompt: "", cadence: "daily", time: "09:00", weekday: "", dayOfMonth: "1" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [refusal, setRefusal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    const atMinute = minuteOf(draft.time);
    const values: ScheduleInput = {
      agentId: draft.agentId,
      name: draft.name.trim(),
      prompt: draft.prompt.trim(),
      cadence: draft.cadence,
      atMinute: atMinute ?? -1,
      weekday: draft.cadence === "weekly" && draft.weekday !== "" ? Number(draft.weekday) : null,
      dayOfMonth: draft.cadence === "monthly" ? Number(draft.dayOfMonth) : null,
      timezone,
    };
    const found = fieldErrors(schema, values);
    if (atMinute === null) found["atMinute"] = "Write the time as HH:MM";
    if (draft.cadence === "weekly" && values.weekday === null) found["weekday"] = "Pick a weekday";
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
      <div className="row">
        <Field label="Name" error={errors["name"]} hint={`Up to ${NAME_MAX} characters`}>
          {(p) => <Input id={p.id} value={draft.name} aria-invalid={p.invalid} aria-describedby={p.describedBy} onChange={(e) => set("name", e.target.value)} />}
        </Field>
        <Field label="Agent" error={errors["agentId"]} hint="One you may use: your own, or shared with the workspace">
          {(p) => (
            <Select id={p.id} value={draft.agentId} aria-invalid={p.invalid} aria-describedby={p.describedBy} onChange={(e) => set("agentId", e.target.value)}>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <Field label="Prompt" error={errors["prompt"]} hint={`The question asked each time, as you would type it in the chat; up to ${PROMPT_MAX} characters`}>
        {(p) => <Textarea id={p.id} rows={3} value={draft.prompt} aria-invalid={p.invalid} aria-describedby={p.describedBy} onChange={(e) => set("prompt", e.target.value)} />}
      </Field>
      <div className="row">
        <Field label="Repeats" error={errors["cadence"]}>
          {(p) => (
            <Select id={p.id} value={draft.cadence} aria-describedby={p.describedBy} onChange={(e) => set("cadence", e.target.value as Cadence)}>
              <option value="once">Once</option>
              <option value="daily">Every day</option>
              <option value="weekly">Every week</option>
              <option value="monthly">Every month</option>
            </Select>
          )}
        </Field>
        <Field label="At" error={errors["atMinute"]} hint={`HH:MM in ${timezone}`}>
          {(p) => <Input id={p.id} type="time" value={draft.time} aria-invalid={p.invalid} aria-describedby={p.describedBy} onChange={(e) => set("time", e.target.value)} />}
        </Field>
      </div>
      {draft.cadence === "weekly" ? (
        <Field label="Weekday" error={errors["weekday"]}>
          {(p) => (
            <Select id={p.id} value={draft.weekday} aria-invalid={p.invalid} aria-describedby={p.describedBy} onChange={(e) => set("weekday", e.target.value)}>
              <option value="">Choose a day</option>
              {DAYS.map((d, i) => (
                <option key={d} value={String(i)}>
                  {d}
                </option>
              ))}
            </Select>
          )}
        </Field>
      ) : null}
      {draft.cadence === "monthly" ? (
        <Field label="Day of the month" error={errors["dayOfMonth"]} hint="1 to 28, so every month has it">
          {(p) => <Input id={p.id} type="number" min={1} max={28} value={draft.dayOfMonth} aria-invalid={p.invalid} aria-describedby={p.describedBy} onChange={(e) => set("dayOfMonth", e.target.value)} style={{ width: 120 }} />}
        </Field>
      ) : null}
      {refusal ? <Alert>{refusal}</Alert> : null}
      <div className="form-actions">
        {onCancel ? (
          <Button tone="ghost" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        <Button type="submit" tone="primary" disabled={busy}>
          Create schedule
        </Button>
      </div>
    </form>
  );
}
