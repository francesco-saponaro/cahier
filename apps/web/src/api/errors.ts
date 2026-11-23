import { TRPCClientError } from "@trpc/client";

/* What the app can read from a failed call: the tRPC code, the rule's reason, the message. */

export interface Failure {
  code: string | null;
  reason: string | null;
  message: string;
}

export function describe(error: unknown): Failure {
  if (error instanceof TRPCClientError) {
    const data = (error.data ?? {}) as { code?: string; reason?: string | null };
    return { code: data.code ?? null, reason: data.reason ?? null, message: error.message };
  }
  if (error instanceof Error) return { code: null, reason: null, message: error.message };
  return { code: null, reason: null, message: String(error) };
}

export const isUnauthorized = (error: unknown): boolean => describe(error).code === "UNAUTHORIZED";
