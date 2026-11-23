import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { useId } from "react";

/* The few controls every screen is built from, each a plain element with the house classes. */

type Tone = "default" | "primary" | "ghost" | "danger";

export function Button({ tone = "default", small, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: Tone; small?: boolean }) {
  const classes = ["btn", tone !== "default" ? tone : "", small ? "sm" : "", className ?? ""].filter(Boolean).join(" ");
  return <button type="button" {...rest} className={classes} />;
}

interface FieldProps {
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  children: (props: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
}

/** A label above its control, the limit beside it, the error under it, all tied by ids. */
export function Field({ label, hint, error, children }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children({ id, describedBy, invalid: Boolean(error) })}
      {error ? (
        <p className="error" id={errorId}>
          {error}
        </p>
      ) : null}
      {hint ? (
        <p className="hint" id={hintId}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={["input", props.className ?? ""].join(" ")} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={["input", props.className ?? ""].join(" ")} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={["input", props.className ?? ""].join(" ")} />;
}

export function Pill({ tone = "neutral", children }: { tone?: "neutral" | "pos" | "neg" | "warn" | "accent"; children: ReactNode }) {
  return <span className={tone === "neutral" ? "pill" : `pill ${tone}`}>{children}</span>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Alert({ children }: { children: ReactNode }) {
  return (
    <div className="alert" role="alert">
      {children}
    </div>
  );
}

/** A loading value at its real size: a flat grey bar, no shimmer. */
export function Skeleton({ width = "100%", height = 16 }: { width?: string | number; height?: number }) {
  return <div className="skeleton" style={{ width, height }} aria-hidden="true" />;
}

export function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" strokeLinecap="round" />
    </svg>
  );
}
