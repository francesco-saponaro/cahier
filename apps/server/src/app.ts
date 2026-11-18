import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import Fastify, { type FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import type { Db } from "@cahier/db";

export interface AppOptions {
  db: Db;
  /** The web app's origin for CORS; null allows no cross-origin browser at all. */
  webOrigin: string | null;
  sessionHours: number;
}

/**
 * The composition root of the server. This file and `server.ts` are the only places Fastify
 * objects exist; the router that lands with the API is framework-free and is mounted here.
 */
export function buildApp(options: AppOptions): FastifyInstance {
  const app = Fastify({ logger: process.env["NODE_ENV"] !== "test" && process.env["VITEST"] === undefined });
  void app.register(helmet, { contentSecurityPolicy: false, referrerPolicy: { policy: "no-referrer" }, frameguard: { action: "deny" } });
  // A list, not a string: the header is sent only to a browser whose origin is on it.
  void app.register(cors, { origin: options.webOrigin ? [options.webOrigin] : false, credentials: false });

  app.get("/health", async () => {
    await options.db.execute(sql`select 1`);
    return { ok: true, db: true };
  });

  return app;
}
