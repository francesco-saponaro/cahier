import { useSyncExternalStore } from "react";
import type { ApiLinks } from "../api/client";
import { browserStorage, readSession } from "../auth/session";
import { fetchMigration, openDemoDatabase, type DemoDatabase } from "./database";
import { demoLinks, restoreSession } from "./session";
import { createDemoStore, type DemoStatus } from "./store";

/*
 * Demo mode, as the page uses it: the database opened once, the stored session put back into
 * it, the scheduler ticking as the server's does (once now, then every minute), and the links
 * every screen calls through. `linksFor` in the API client picks these when no server URL is set.
 */

const TICK_EVERY_MS = 60_000;
const STREAM_DELAY_MS = 12;

async function open(): Promise<DemoDatabase> {
  const migration = await fetchMigration();
  const database = await openDemoDatabase({ migration, streamDelayMs: STREAM_DELAY_MS });
  const stored = readSession(browserStorage(), new Date());
  if (stored) await restoreSession(database.ports, stored, new Date());
  const tick = () => database.useCases.schedules.tick().catch(() => undefined);
  await tick();
  setInterval(() => void tick(), TICK_EVERY_MS);
  return database;
}

export const demo = createDemoStore(open);

export function demoLinksFor(token: string | null): ApiLinks {
  return demoLinks(() => demo.database().then((d) => d.useCases), token);
}

/** The demo's status for a screen: idle until something calls, loading, ready, or failed with a message. */
export function useDemoStatus(): { status: DemoStatus; error: string | null } {
  const status = useSyncExternalStore(demo.subscribe, demo.status, () => "idle" as const);
  const error = useSyncExternalStore(demo.subscribe, demo.error, () => null);
  return { status, error };
}
