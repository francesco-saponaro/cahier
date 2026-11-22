import { afterAll, beforeAll, describe, expect, test } from "vitest";
import fc from "fast-check";
import { canReadLibrary, type Actor, type Library } from "@cahier/domain";
import { drizzlePortsCreator } from "../src/adapters.js";
import { connectPglite, type Connection } from "../src/migrate.js";
import * as schema from "../src/schema.js";

/*
 * The retrieval filter runs in SQL (`libraries.readableIds`), the use cases ask `canReadLibrary`
 * in code. They must be the same rule. This test generates workspaces of libraries with random
 * owners and visibilities and actors with random roles, loads them, and checks that the database
 * answers exactly the ids the function would keep.
 */

const T0 = new Date("2026-09-01T10:00:00Z");
const WORKSPACES = ["ws_a", "ws_b"];
const USERS = ["usr_1", "usr_2", "usr_3", "usr_4"];

const library = fc.record({
  owner: fc.constantFrom(...USERS),
  workspace: fc.constantFrom(...WORKSPACES),
  visibility: fc.constantFrom<Library["visibility"]>("private", "workspace"),
});
const actor = fc.record({
  userId: fc.constantFrom(...USERS),
  workspaceId: fc.constantFrom(...WORKSPACES),
  role: fc.constantFrom<Actor["role"]>("member", "admin"),
});

let conn: Connection;

beforeAll(async () => {
  conn = await connectPglite();
  await conn.db.insert(schema.workspaces).values(WORKSPACES.map((id) => ({ id, slug: id, name: id, tools: { groundedAnswers: true, scheduledPrompts: true, uploads: true }, retentionDays: 90, createdAt: T0 })));
  await conn.db.insert(schema.users).values(USERS.map((id) => ({ id, email: `${id}@example.com`, name: id, passwordHash: "x", createdAt: T0 })));
}, 60_000);

afterAll(async () => {
  await conn.close();
});

describe("the SQL twin of canReadLibrary", () => {
  test("answers the same ids as the function, for every actor over every set of libraries", async () => {
    const { ports } = drizzlePortsCreator(conn.db);
    await fc.assert(
      fc.asyncProperty(fc.array(library, { minLength: 1, maxLength: 12 }), fc.array(actor, { minLength: 1, maxLength: 6 }), async (libs, actors) => {
        const rows: Library[] = libs.map((l, i) => ({
          id: `lib_${i}`, workspaceId: l.workspace, ownerId: l.owner, slug: `lib-${i}`, name: `Library ${i}`, description: "", visibility: l.visibility, createdAt: T0, updatedAt: T0,
        }));
        await conn.db.delete(schema.libraries);
        await conn.db.insert(schema.libraries).values(rows);
        const ids = [...rows.map((r) => r.id), "lib_missing"];
        for (const a of actors) {
          const expected = rows.filter((r) => canReadLibrary(a, r)).map((r) => r.id).sort();
          expect(await ports.libraries.readableIds(a, ids)).toEqual(expected);
        }
      }),
      { numRuns: 40 },
    );
  }, 120_000);
});
