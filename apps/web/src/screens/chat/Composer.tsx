"use client";

import { useId, useState, type FormEvent, type KeyboardEvent } from "react";
import { QUESTION_MAX } from "@cahier/domain";
import { Button, Textarea } from "../../ui/primitives";

/* The question box: Enter sends, Shift+Enter breaks the line, the limit is the API's. */

export function Composer({ onSend, busy }: { onSend: (text: string) => void; busy: boolean }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const id = useId();

  function submit(event?: FormEvent) {
    event?.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    if (trimmed.length > QUESTION_MAX) {
      setError(`At most ${QUESTION_MAX.toLocaleString("en-US")} characters; this is ${trimmed.length.toLocaleString("en-US")}.`);
      return;
    }
    setError(null);
    onSend(trimmed);
    setText("");
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <div className="composer">
      <form onSubmit={submit}>
        <Textarea id={id} aria-label="Your question" aria-describedby={error ? `${id}-error` : undefined} aria-invalid={Boolean(error)} rows={1} value={text} placeholder="Ask about the documents this agent reads" onChange={(e) => setText(e.target.value)} onKeyDown={onKeyDown} />
        <Button type="submit" tone="primary" disabled={busy}>
          Ask
        </Button>
        {error ? (
          <p className="hint" id={`${id}-error`} style={{ color: "var(--negative)" }}>
            {error}
          </p>
        ) : (
          <p className="hint">Enter sends, Shift+Enter starts a new line. The answer quotes the documents and cites each line.</p>
        )}
      </form>
    </div>
  );
}
