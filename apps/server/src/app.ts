import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { fastifyTRPCPlugin, type FastifyTRPCPluginOptions } from "@trpc/server/adapters/fastify";
import Fastify, { type FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import { appRouter, createContext, type AppRouter } from "@cahier/api";
import { drizzlePortsCreator, type Db } from "@cahier/db";
import { cryptoIdGeneratorCreator, systemClock, useCasesCreator } from "@cahier/domain";

export interface AppOptions {
  db: Db;
  /** The web app's origin for CORS; null allows no cross-origin browser at all. */
  webOrigin: string | null;
  sessionHours: number;
  /** Sign-in attempts allowed per IP per minute. */
  authRateLimit?: number;
  /** Milliseconds between the pieces of a streamed answer; the tests leave it at none. */
  streamDelayMs?: number;
  /** How often the tick runs (due schedules, retention, closing months); off when not given. */
  tickEveryMs?: number;
}

/**
 * The composition root of the server. This file and `server.ts` are the only places Fastify
 * objects exist: the ports are built over the database, the use cases over the ports, and the
 * framework-free router is mounted at `/trpc` with a context made from the bearer header.
 */
export function buildApp(options: AppOptions): FastifyInstance {
  const app = Fastify({ logger: process.env["NODE_ENV"] !== "test" && process.env["VITEST"] === undefined });
  void app.register(helmet, { contentSecurityPolicy: false, referrerPolicy: { policy: "no-referrer" }, frameguard: { action: "deny" } });
  // A list, not a string: the header is sent only to a browser whose origin is on it.
  void app.register(cors, { origin: options.webOrigin ? [options.webOrigin] : false, credentials: false });

  const { ports, unitOfWork } = drizzlePortsCreator(options.db);
  const useCases = useCasesCreator({ ports, unitOfWork, clock: systemClock, ids: cryptoIdGeneratorCreator(), sessionHours: options.sessionHours, streamDelayMs: options.streamDelayMs ?? 0 });

  if (options.tickEveryMs && options.tickEveryMs > 0) {
    const timer = setInterval(() => {
      useCases.schedules.tick().catch((e: unknown) => app.log.error(e, "tick failed"));
    }, options.tickEveryMs);
    app.addHook("onClose", async () => clearInterval(timer));
  }

  app.get("/health", async () => {
    await options.db.execute(sql`select 1`);
    return { ok: true, db: true };
  });

  // The router, with the auth procedures rate limited by IP before any of them runs.
  void app.register(async (scope) => {
    await scope.register(rateLimit, { global: false, max: options.authRateLimit ?? 20, timeWindow: "1 minute" });
    const limit = scope.rateLimit();
    scope.addHook("onRequest", async function (req, reply) {
      if (req.url.startsWith("/trpc/auth.")) await limit.call(this, req, reply);
    });
    await scope.register(fastifyTRPCPlugin, {
      prefix: "/trpc",
      trpcOptions: {
        router: appRouter,
        createContext: ({ req, info }) => createContext({ useCases, authorization: req.headers.authorization, connectionParams: info.connectionParams }),
      } satisfies FastifyTRPCPluginOptions<AppRouter>["trpcOptions"],
    });
  });

  return app;
}
