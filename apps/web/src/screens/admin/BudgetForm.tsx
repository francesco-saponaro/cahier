"use client";

import { useState, type FormEvent } from "react";
import { parseDollars } from "@cahier/domain";
import { Alert, Button, Field, Input } from "../../ui/primitives";

/*
 * A month's budget, typed in dollars and sent in micro-dollars, the unit every usage row is kept
 * in (decision 0002). The month is fixed by the caller: this month's, or next month's ahead.
 */

export interface BudgetValues {
  month: string;
  limitMicros: number;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function monthWords(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return `${MONTHS[m - 1]} ${y}`;
}

const asTyped = (micros: number | null) => (micros === null ? "" : (micros / 1_000_000).toFixed(2));

export function BudgetForm({ month, limitMicros, onSubmit }: { month: string; limitMicros: number | null; onSubmit: (values: BudgetValues) => Promise<string | null> | string | null }) {
  const [text, setText] = useState(asTyped(limitMicros));
  const [error, setError] = useState<string | undefined>(undefined);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const micros = parseDollars(text);
    if (micros === null) {
      setError("Write an amount in dollars, such as 25 or 1,250.50");
      return;
    }
    setError(undefined);
    setBusy(true);
    setRefusal(null);
    try {
      setRefusal(await onSubmit({ month, limitMicros: micros }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="form-grid">
      <Field label={`Limit for ${monthWords(month)}`} error={error} hint="In dollars; answers stop when the month's usage reaches it">
        {(p) => <Input id={p.id} inputMode="decimal" value={text} aria-invalid={p.invalid} aria-describedby={p.describedBy} onChange={(e) => setText(e.target.value)} style={{ maxWidth: 200 }} />}
      </Field>
      {refusal ? <Alert>{refusal}</Alert> : null}
      <div className="form-actions" style={{ justifyContent: "flex-start" }}>
        <Button type="submit" disabled={busy}>
          Set the budget
        </Button>
      </div>
    </form>
  );
}
