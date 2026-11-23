"use client";

import { useState, type FormEvent } from "react";
import { z } from "zod";
import { inputs } from "@cahier/api";
import { NAME_MAX, TEXT_MAX } from "@cahier/domain";
import { count } from "../../lib/format";
import { fieldErrors, type FieldErrors } from "../../lib/validate";
import { Alert, Button, Field, Input, Textarea } from "../../ui/primitives";

/*
 * Text or Markdown, pasted or chosen as a file; the title comes from the file's name when there
 * is none. The same form uploads a new document and replaces the text of one, with the API's
 * limits: a title of 80 characters, a text of 400,000. PDF and Office files are out of scope.
 */

export interface DocumentValues {
  title: string;
  text: string;
  sourceName: string | undefined;
}

const schema = z.object({ title: inputs.documentUpload.shape.title, text: inputs.documentText });

/** "opening-hours.md" → "Opening hours". */
export function titleFromFileName(name: string): string {
  const stem = name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim();
  return stem ? stem.charAt(0).toUpperCase() + stem.slice(1) : "";
}

export function DocumentForm({ mode, initialTitle = "", onSubmit, onCancel }: { mode: "upload" | "replace"; initialTitle?: string; onSubmit: (values: DocumentValues) => Promise<string | null> | string | null; onCancel?: () => void }) {
  const [title, setTitle] = useState(initialTitle);
  const [text, setText] = useState("");
  const [sourceName, setSourceName] = useState<string | undefined>(undefined);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [refusal, setRefusal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function chooseFile(file: File | undefined) {
    if (!file) return;
    const content = await file.text();
    setText(content);
    setSourceName(file.name);
    if (!title.trim()) setTitle(titleFromFileName(file.name));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const values = { title: title.trim(), text };
    const found = fieldErrors(schema, values);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    setRefusal(null);
    try {
      setRefusal(await onSubmit({ ...values, sourceName }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="form-grid">
      <Field label="Title" error={errors["title"]} hint={`Up to ${NAME_MAX} characters; left empty, the file's name is used.`}>
        {(p) => <Input id={p.id} value={title} maxLength={NAME_MAX + 20} aria-invalid={p.invalid} aria-describedby={p.describedBy} onChange={(e) => setTitle(e.target.value)} />}
      </Field>
      <Field label="Text" error={errors["text"]} hint={`Plain text or Markdown, up to ${count(TEXT_MAX)} characters. Headings open chunks, so a page with headings is cited more precisely.`}>
        {(p) => <Textarea id={p.id} value={text} rows={10} aria-invalid={p.invalid} aria-describedby={p.describedBy} onChange={(e) => setText(e.target.value)} />}
      </Field>
      <Field label="Or choose a file" hint=".md or .txt">
        {(p) => <input id={p.id} type="file" accept=".md,.markdown,.txt,text/plain,text/markdown" onChange={(e) => chooseFile(e.target.files?.[0])} />}
      </Field>
      {refusal ? <Alert>{refusal}</Alert> : null}
      <div className="form-actions">
        {onCancel ? (
          <Button tone="ghost" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        <Button type="submit" tone="primary" disabled={busy}>
          {mode === "upload" ? "Upload" : "Replace"}
        </Button>
      </div>
    </form>
  );
}
