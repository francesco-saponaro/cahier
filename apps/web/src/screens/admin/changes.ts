/*
 * An audit row's `before` and `after` as lines a person can read: one per field that differs,
 * nested objects flattened to dotted names, long values cut short. The action, written in the
 * code as `entity.what_happened`, becomes words.
 */

export interface Change {
  field: string;
  before: string | null;
  after: string | null;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function flatten(value: unknown, prefix = "", into: Map<string, string> = new Map()): Map<string, string> {
  if (!isRecord(value)) return into;
  for (const [key, inner] of Object.entries(value)) {
    const name = prefix ? `${prefix}.${key}` : key;
    if (isRecord(inner)) flatten(inner, name, into);
    else into.set(name, printed(inner));
  }
  return into;
}

function printed(value: unknown): string {
  const text = typeof value === "string" ? value : value === null || value === undefined ? "" : Array.isArray(value) ? value.map((v) => printed(v)).join(", ") : String(value);
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}

export function changes(before: unknown, after: unknown): Change[] {
  const b = flatten(before);
  const a = flatten(after);
  const fields = [...new Set([...b.keys(), ...a.keys()])];
  return fields.filter((f) => b.get(f) !== a.get(f)).map((f) => ({ field: f, before: b.has(f) ? b.get(f)! : null, after: a.has(f) ? a.get(f)! : null }));
}

export function actionWords(action: string): string {
  const [entity = "", what = ""] = action.split(".");
  const words = `${entity.replace(/_/g, " ")} ${what.replace(/_/g, " ")}`.trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
