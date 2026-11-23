import type { Role } from "@cahier/domain";

/*
 * The session as the browser keeps it: the token and what the sign-in answered, as one JSON
 * value in localStorage. The server holds the token's hash and the expiry; this copy is only so
 * a reload does not sign the person out, and it is dropped the moment the API answers
 * UNAUTHORIZED or the expiry passes.
 */

export const SESSION_KEY = "cahier.session";

export interface StoredSession {
  token: string;
  /** ISO 8601, from the sign-in's `expiresAt`. */
  expiresAt: string;
  user: { id: string; name: string; email: string };
  workspace: { id: string; slug: string; name: string };
  role: Role;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

function parse(text: string): StoredSession | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(value) || typeof value["token"] !== "string" || typeof value["expiresAt"] !== "string") return null;
  const user = value["user"];
  const workspace = value["workspace"];
  const role = value["role"];
  if (!isRecord(user) || typeof user["id"] !== "string" || typeof user["name"] !== "string" || typeof user["email"] !== "string") return null;
  if (!isRecord(workspace) || typeof workspace["id"] !== "string" || typeof workspace["slug"] !== "string" || typeof workspace["name"] !== "string") return null;
  if (role !== "member" && role !== "admin") return null;
  return {
    token: value["token"],
    expiresAt: value["expiresAt"],
    user: { id: user["id"], name: user["name"], email: user["email"] },
    workspace: { id: workspace["id"], slug: workspace["slug"], name: workspace["name"] },
    role,
  };
}

/** The live session in storage, or null: expired, malformed, missing, or a storage that throws. */
export function readSession(storage: Storage | null, now: Date): StoredSession | null {
  if (!storage) return null;
  let text: string | null;
  try {
    text = storage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
  if (!text) return null;
  const session = parse(text);
  if (!session || new Date(session.expiresAt).getTime() <= now.getTime()) {
    clearSession(storage);
    return null;
  }
  return session;
}

export function writeSession(storage: Storage | null, session: StoredSession): void {
  try {
    storage?.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // A storage that refuses (private mode, quota) only costs the reload; the session lives in memory.
  }
}

export function clearSession(storage: Storage | null): void {
  try {
    storage?.removeItem(SESSION_KEY);
  } catch {
    // Same as above.
  }
}

/** The browser's storage, or null where there is none (the server render, a blocked storage). */
export function browserStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Where a signed-in person lands. */
export function homeFor(_role: Role): string {
  return "/chat";
}
