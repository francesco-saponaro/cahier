import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { drizzlePortsCreator } from "@cahier/db/adapters";
import { schema, type Db } from "@cahier/db/db";
import { generateSeed, seedDatabase } from "@cahier/db/seed";
import { cryptoIdGeneratorCreator, systemClock, useCasesCreator, type Ports, type UseCases } from "@cahier/domain";

/*
 * PostgreSQL in the page. PGlite is the database engine compiled to WebAssembly; the bundler
 * ships its module and data bundle as static files next to the scripts, so nothing here names a
 * URL for them. The committed migration is applied as it is under docker compose, the seed is
 * loaded, and the same ports, use cases and router the server holds are built over the result.
 * The database lives in memory until the tab closes, so every visit starts from the seed.
 */

export interface DemoDatabase {
  db: Db;
  ports: Ports;
  useCases: UseCases;
  close: () => Promise<void>;
}

export interface OpenOptions {
  /** The SQL of `packages/db/drizzle/0000_tables.sql`, read from disk or fetched. */
  migration: string;
  /** Milliseconds between the pieces of a streamed answer; the demo paces it like the server. */
  streamDelayMs?: number;
}

export const MIGRATION_URL = "/demo/0000_tables.sql";

export async function fetchMigration(url: string = MIGRATION_URL): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response.text();
}

export async function openDemoDatabase(options: OpenOptions): Promise<DemoDatabase> {
  const client = new PGlite();
  await client.waitReady;
  await client.exec(options.migration);
  const db = drizzle(client, { schema });
  await seedDatabase(db, await generateSeed());
  const { ports, unitOfWork } = drizzlePortsCreator(db);
  const useCases = useCasesCreator({ ports, unitOfWork, clock: systemClock, ids: cryptoIdGeneratorCreator(), sessionHours: 72, streamDelayMs: options.streamDelayMs ?? 0 });
  return { db, ports, useCases, close: () => client.close() };
}
