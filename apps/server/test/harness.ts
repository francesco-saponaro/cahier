import { createTRPCClient, httpBatchLink, TRPCClientError } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "@cahier/api";
import { connectPglite, generateSeed, seedDatabase, DEMO_PASSWORD } from "@cahier/db";
import { buildApp } from "../src/app.js";

/*
 * A real server on a free port over PGlite with the seed loaded, and a tRPC client per person:
 * the tests go through HTTP, the bearer header, the batch link and superjson, as the app will.
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
      links: [httpBatchLink({ url: `${url}/trpc`, transformer: superjson, headers: () => (token ? { authorization: `Bearer ${token}` } : {}) })],
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
