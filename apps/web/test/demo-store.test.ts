// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createDemoStore } from "../src/demo/store";
import type { DemoDatabase } from "../src/demo/database";

/*
 * One database per page: the first call opens it, every later call shares the same promise, and
 * the screens can read whether it is loading, ready or failed without holding the promise.
 */

const fakeDatabase = () => ({ db: {}, ports: {}, useCases: {}, close: async () => {} }) as unknown as DemoDatabase;

describe("the demo store", () => {
  it("opens once and hands every caller the same database", async () => {
    let opened = 0;
    const store = createDemoStore(async () => {
      opened++;
      return fakeDatabase();
    });
    expect(store.status()).toBe("idle");
    const [a, b] = await Promise.all([store.database(), store.database()]);
    expect(a).toBe(b);
    expect(opened).toBe(1);
    expect(store.status()).toBe("ready");
  });

  it("tells its listeners when the status changes", async () => {
    const seen: string[] = [];
    const store = createDemoStore(async () => fakeDatabase());
    store.subscribe(() => seen.push(store.status()));
    await store.database();
    expect(seen).toEqual(["loading", "ready"]);
  });

  it("reports a failure and lets the next call try again", async () => {
    let attempt = 0;
    const store = createDemoStore(async () => {
      attempt++;
      if (attempt === 1) throw new Error("the migration could not be fetched");
      return fakeDatabase();
    });
    await expect(store.database()).rejects.toThrow("the migration could not be fetched");
    expect(store.status()).toBe("failed");
    expect(store.error()).toBe("the migration could not be fetched");
    await expect(store.database()).resolves.toBeDefined();
    expect(store.status()).toBe("ready");
  });
});
