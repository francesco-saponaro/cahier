import { hashPassword } from "../src/password.js";
import { inMemoryPortsCreator, type MemoryStore } from "../src/in-memory.js";
import type { Actor, Clock, Deps, IdGenerator } from "../src/index.js";
import { useCasesCreator } from "../src/use-cases/index.js";
import { fixture } from "./port-contract.js";

/*
 * A small world for the use-case tests: the contract fixture (two workspaces, five people, a few
 * libraries, agents, requests and conversations), a clock that stands still and ids that count
 * up, so every expectation can be written out in full.
 */

export const NOW = new Date("2026-09-20T18:00:00Z");
export const DAY = 24 * 60 * 60 * 1000;

export const LEA: Actor = { userId: "usr_lea", workspaceId: "ws_oriel", role: "member" };
export const TOM: Actor = { userId: "usr_tom", workspaceId: "ws_oriel", role: "member" };
export const NOOR: Actor = { userId: "usr_noor", workspaceId: "ws_oriel", role: "admin" };
export const BOB: Actor = { userId: "usr_bob", workspaceId: "ws_brindille", role: "admin" };

export const PASSWORD = "cahier-demo";
export const PASSWORD_HASH = await hashPassword(PASSWORD, new Uint8Array(16).fill(7));

export function sequentialIds(): IdGenerator {
  const counters = new Map<string, number>();
  return {
    id: (prefix) => {
      const n = (counters.get(prefix) ?? 0) + 1;
      counters.set(prefix, n);
      return `${prefix}_x${n}`;
    },
    token: (length) => "t".repeat(length),
  };
}

export function fixedClock(start: Date = NOW): Clock & { advance: (ms: number) => void } {
  let now = start;
  return { now: () => now, advance: (ms) => (now = new Date(now.getTime() + ms)) };
}

export function world(change: (store: MemoryStore) => void = () => {}) {
  const store = fixture();
  for (const u of store.users) u.passwordHash = PASSWORD_HASH;
  change(store);
  const { ports, unitOfWork } = inMemoryPortsCreator(store);
  const clock = fixedClock();
  const deps: Deps = { ports, unitOfWork, clock, ids: sequentialIds(), sessionHours: 72 };
  return { store, ports, clock, deps, useCases: useCasesCreator(deps) };
}

/** The value of a result that must be ok, with a readable failure otherwise. */
export function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`);
  return result.value;
}

/** The error of a result that must fail. */
export function failure(result: { ok: true; value: unknown } | { ok: false; error: { code: string; message: string; reason?: string } }) {
  if (result.ok) throw new Error(`expected a failure, got ok: ${JSON.stringify(result.value)}`);
  return result.error;
}
