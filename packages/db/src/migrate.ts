import { fileURLToPath } from "node:url";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import pg from "pg";
import * as schema from "./schema.js";
import type { Db } from "./db.js";

/** The SQL files `drizzle-kit generate` writes, committed next to the schema they match. */
export const migrationsFolder = fileURLToPath(new URL("../drizzle/", import.meta.url).href);

export interface Connection {
  db: Db;
  close: () => Promise<void>;
}

/** A pool against PostgreSQL with the migrations applied. */
export async function connect(url: string): Promise<Connection> {
  const pool = new pg.Pool({ connectionString: url });
  const db = drizzlePg(pool, { schema });
  await migratePg(db, { migrationsFolder });
  return { db, close: () => pool.end() };
}

/** PostgreSQL in the process, in memory unless a data directory is given, with the migrations applied. */
export async function connectPglite(dataDir?: string): Promise<Connection> {
  const { PGlite } = await import("@electric-sql/pglite");
  const client = dataDir ? new PGlite(dataDir) : new PGlite();
  const db = drizzlePglite(client, { schema });
  await migratePglite(db, { migrationsFolder });
  return { db, close: () => client.close() };
}

const isMain = process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const url = process.env["DATABASE_URL"];
  if (!url) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }
  const { close } = await connect(url);
  console.log("migrations applied");
  await close();
}
