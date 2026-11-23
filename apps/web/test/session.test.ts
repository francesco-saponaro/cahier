import { describe, expect, test } from "vitest";
import { SESSION_KEY, clearSession, readSession, writeSession, type StoredSession } from "../src/auth/session";

/*
 * The session as the browser keeps it: one JSON value under `cahier.session`, read back only
 * while it is live, dropped on sign-out. A storage that throws (a private window) is the same as
 * an empty one.
 */

const NOW = new Date("2026-11-23T20:00:00Z");
const live: StoredSession = {
  token: "t".repeat(48),
  expiresAt: "2026-11-26T20:00:00.000Z",
  user: { id: "usr_lea", name: "Léa Marchetti", email: "lea@example.com" },
  workspace: { id: "ws_oriel", slug: "oriel", name: "Oriel" },
  role: "member",
};

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => { map.delete(k); },
    setItem: (k, v) => { map.set(k, v); },
  };
}

describe("the stored session", () => {
  test("round-trips through storage and reads back while live", () => {
    const storage = memoryStorage();
    writeSession(storage, live);
    expect(JSON.parse(storage.getItem(SESSION_KEY)!)).toEqual(live);
    expect(readSession(storage, NOW)).toEqual(live);
  });

  test("an expired session is dropped on read, and the storage is cleared", () => {
    const storage = memoryStorage();
    writeSession(storage, { ...live, expiresAt: "2026-11-23T19:59:59.000Z" });
    expect(readSession(storage, NOW)).toBeNull();
    expect(storage.getItem(SESSION_KEY)).toBeNull();
  });

  test("garbage, a missing storage and a storage that throws all read as signed out", () => {
    const storage = memoryStorage();
    storage.setItem(SESSION_KEY, "{not json");
    expect(readSession(storage, NOW)).toBeNull();
    storage.setItem(SESSION_KEY, JSON.stringify({ token: "x" }));
    expect(readSession(storage, NOW)).toBeNull();
    expect(readSession(null, NOW)).toBeNull();
    const broken = { ...memoryStorage(), getItem: () => { throw new Error("blocked"); } };
    expect(readSession(broken, NOW)).toBeNull();
  });

  test("clearing removes the value", () => {
    const storage = memoryStorage();
    writeSession(storage, live);
    clearSession(storage);
    expect(readSession(storage, NOW)).toBeNull();
  });
});
