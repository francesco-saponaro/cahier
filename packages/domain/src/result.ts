/*
 * Rules fail as values, not as exceptions: a use case returns `ok(value)` or `fail(code, message)`,
 * and the router maps the code to a tRPC error. Nothing in the domain throws for a business reason.
 * `reason` is a short machine-readable name for the rule (`last_admin`, `forbidden_transition`,
 * `tool_off`), which the app can switch on without parsing the message.
 */

export type ErrorCode = "invalid" | "unauthorized" | "forbidden" | "not_found" | "conflict" | "rule";

export interface DomainError {
  code: ErrorCode;
  message: string;
  reason?: string;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: DomainError };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });

export function fail<T = never>(code: ErrorCode, message: string, reason?: string): Result<T> {
  return { ok: false, error: reason === undefined ? { code, message } : { code, message, reason } };
}

export const notFound = <T = never>(what: string): Result<T> => fail("not_found", `${what} not found`);
export const forbidden = <T = never>(message = "not allowed"): Result<T> => fail("forbidden", message);
export const invalid = <T = never>(message: string): Result<T> => fail("invalid", message);
