import { createTRPCClient, httpBatchLink, httpSubscriptionLink, splitLink, TRPCClientError } from "@trpc/client";
import { EventSource } from "eventsource";
import superjson from "superjson";
import type { AppRouter } from "@cahier/api";
import { connectPglite, generateSeed, seedDatabase, DEMO_PASSWORD } from "@cahier/db";
import { buildApp } from "../src/app.js";

/*
 * A real server on a free port over PGlite with the seed loaded, and a tRPC client per person:
 * the tests go through HTTP, the bearer header, the batch link and superjson, as the app will.
 * Subscriptions go over SSE with the token in the connection params, since an EventSource
 * cannot send a header; Node has no EventSource of its own, so the tests bring one.
 */

export const PASSWORD = DEMO_PASSWORD;

export interface Server {
  url: string;
  clientFor: (token?: string) => ReturnType<typeof createTRPCClient<AppRouter>>;
  signIn: (email: string, password?: string) => Promise<{ client: ReturnType<typeof createTRPCClient<AppRouter>>; token: string }>;
  close: () => Promise<void>;
}

export async function startServer(options: { authRateLimit?: number } = {}): Promise<Server> {
  const conn = await connectPglite();
  await seedDatabase(conn.db, await generateSeed());
  const app = buildApp({ db: conn.db, webOrigin: "http://localhost:3000", sessionHours: 72, authRateLimit: options.authRateLimit ?? 1000 });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  const url = typeof address === "object" && address ? `http://127.0.0.1:${address.port}` : "";
  const clientFor = (token?: string) =>
    createTRPCClient<AppRouter>({
      links: [
        splitLink({
          condition: (op) => op.type === "subscription",
          true: httpSubscriptionLink({ url: `${url}/trpc`, transformer: superjson, EventSource, connectionParams: () => (token ? { token } : {}) }),
          false: httpBatchLink({ url: `${url}/trpc`, transformer: superjson, headers: () => (token ? { authorization: `Bearer ${token}` } : {}) }),
        }),
      ],
    });
  return {
    url,
    clientFor,
    signIn: async (email, password = PASSWORD) => {
      const { token } = await clientFor().auth.signIn.mutate({ email, password });
      return { client: clientFor(token), token };
    },
    close: async () => {
      await app.close();
      await conn.close();
    },
  };
}

/** The tRPC code of a call that must fail. */
export async function codeOf(run: Promise<unknown>): Promise<string> {
  try {
    await run;
  } catch (e) {
    if (e instanceof TRPCClientError) return (e.data as { code?: string } | undefined)?.code ?? "no code";
    throw e;
  }
  return "no error";
}

/** The rule's reason of a call that must fail. */
export async function reasonOf(run: Promise<unknown>): Promise<string | null> {
  try {
    await run;
  } catch (e) {
    if (e instanceof TRPCClientError) return (e.data as { reason?: string | null } | undefined)?.reason ?? null;
    throw e;
  }
  return "no error";
}

/** Every event of a subscription until it completes, or the error it ended with. */
export function collect<T>(subscribe: (handlers: { onData: (d: T) => void; onComplete: () => void; onError: (e: unknown) => void }) => { unsubscribe: () => void }): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const out: T[] = [];
    subscribe({
      onData: (d) => out.push(d),
      onComplete: () => resolve(out),
      onError: (e) => reject(e instanceof Error ? e : new Error(String(e))),
    });
  });
}
