import type { SQL } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema.js";

/**
 * The database as the adapters see it: a Drizzle handle over the tables in `schema.ts`. Under
 * docker compose it is node-postgres against PostgreSQL 16; in the tests, the seed and the browser
 * demo it is PGlite, PostgreSQL compiled to WebAssembly. The queries are the same either way.
 */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export { schema };

/** Runs a raw query and returns its rows, typed by the caller; both drivers answer with `{ rows }`. */
export async function rawRows<T>(db: Db, query: SQL): Promise<T[]> {
  const result = (await db.execute(query)) as { rows: T[] };
  return result.rows;
}
