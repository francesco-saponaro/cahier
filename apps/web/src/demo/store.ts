import type { DemoDatabase } from "./database";

/*
 * One database per page. The first call opens it and every later call shares the promise; the
 * status is kept beside it so a screen can say "loading the demo" without holding the promise,
 * and a failure (the migration could not be fetched, the WebAssembly refused) is reported and
 * retried on the next call rather than remembered for ever.
 */

export type DemoStatus = "idle" | "loading" | "ready" | "failed";

export interface DemoStore {
  database: () => Promise<DemoDatabase>;
  status: () => DemoStatus;
  error: () => string | null;
  subscribe: (listener: () => void) => () => void;
}

export function createDemoStore(open: () => Promise<DemoDatabase>): DemoStore {
  let status: DemoStatus = "idle";
  let error: string | null = null;
  let opening: Promise<DemoDatabase> | null = null;
  const listeners = new Set<() => void>();

  const set = (next: DemoStatus, failure: string | null = null) => {
    status = next;
    error = failure;
    for (const listener of listeners) listener();
  };

  return {
    database: () => {
      if (!opening) {
        set("loading");
        opening = open().then(
          (database) => {
            set("ready");
            return database;
          },
          (cause: unknown) => {
            opening = null;
            set("failed", cause instanceof Error ? cause.message : String(cause));
            throw cause;
          },
        );
      }
      return opening;
    },
    status: () => status,
    error: () => error,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
