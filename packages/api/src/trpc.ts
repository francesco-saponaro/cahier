import { initTRPC, TRPCError, type TRPC_ERROR_CODE_KEY } from "@trpc/server";
import superjson from "superjson";
import type { Actor, ErrorCode, Result, Session, UseCases } from "@cahier/domain";

/*
 * The tRPC instance, the context, and the three kinds of procedure. A procedure takes the context,
 * never a request: that is what lets Fastify serve the router on the server and the demo call it
 * in-process in the browser. The context is built once per call from the bearer token.
 */

export interface Context {
  useCases: UseCases;
  actor: Actor | null;
  session: Session | null;
}

export interface ContextInput {
  useCases: UseCases;
  /** The `Authorization` header, if any: `Bearer <token>`. */
  authorization?: string | undefined;
}

export async function createContext({ useCases, authorization }: ContextInput): Promise<Context> {
  const token = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
  const found = token ? await useCases.auth.authenticate(token) : null;
  return { useCases, actor: found?.actor ?? null, session: found?.session ?? null };
}

/** Carries the rule's short name from the domain to the error formatter. */
export class RuleError extends Error {
  constructor(
    message: string,
    readonly reason: string | null,
  ) {
    super(message);
  }
}

const CODES: Readonly<Record<ErrorCode, TRPC_ERROR_CODE_KEY>> = {
  invalid: "BAD_REQUEST",
  unauthorized: "UNAUTHORIZED",
  forbidden: "FORBIDDEN",
  not_found: "NOT_FOUND",
  conflict: "CONFLICT",
  rule: "PRECONDITION_FAILED",
};

/** The value of a result, or the tRPC error its failure maps to. */
export function unwrap<T>(result: Result<T>): T {
  if (result.ok) return result.value;
  throw new TRPCError({ code: CODES[result.error.code], message: result.error.message, cause: new RuleError(result.error.message, result.error.reason ?? null) });
}

/** Adds `reason` to every error's data, so the app can switch on the rule without parsing the message. */
export function formatError({ shape, error }: { shape: { message: string; code: number; data: Record<string, unknown> }; error: TRPCError }) {
  const reason = error.cause instanceof RuleError ? error.cause.reason : null;
  return { ...shape, data: { ...shape.data, reason } };
}

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter: formatError,
});

export const router = t.router;
export const createCallerFactory = t.createCallerFactory;
export const mergeRouters = t.mergeRouters;

export const publicProcedure = t.procedure;

/** Signed in, with an active membership in the session's workspace. */
export const memberProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.actor || !ctx.session) throw new TRPCError({ code: "UNAUTHORIZED", message: "sign in first" });
  return next({ ctx: { ...ctx, actor: ctx.actor, session: ctx.session } });
});

/** A member whose role in the workspace is admin. The use cases check again; this keeps the 403 before any work. */
export const adminProcedure = memberProcedure.use(({ ctx, next }) => {
  if (ctx.actor.role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: "only an admin may do this" });
  return next({ ctx });
});
