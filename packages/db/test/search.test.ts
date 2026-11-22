import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { drizzlePortsCreator } from "../src/adapters.js";
import { connectPglite, type Connection } from "../src/migrate.js";
import { generateSeed, seedDatabase, type SeedData } from "../src/seed.js";

/*
 * Retrieval on the seed, through the database: the search vector, the title weight, the phrase
 * bonus and the library filter, on real documents rather than the three-line fixture.
 */

let conn: Connection;
let data: SeedData;
let ports: ReturnType<typeof drizzlePortsCreator>["ports"];

const libraryOf = (name: string) => data.libraries.find((l) => l.name === name && l.workspaceId === "ws_00001")!.id;
const documentOf = (title: string) => data.documents.find((d) => d.title === title)!;

beforeAll(async () => {
  conn = await connectPglite();
  data = await generateSeed();
  await seedDatabase(conn.db, data);
  ports = drizzlePortsCreator(conn.db).ports;
}, 120_000);

afterAll(async () => {
  await conn.close();
});

describe("chunks.search on the seed", () => {
  test("finds the section that answers the question, with its heading path", async () => {
    const hits = await ports.chunks.search({ libraryIds: [libraryOf("Handbook")], question: "How many days of paid leave do I earn a year?", limit: 5 });
    expect(hits[0]).toMatchObject({ documentTitle: "Leave and time off", headingPath: ["Leave and time off", "Paid leave"] });
    expect(hits[0]!.body).toContain("25 working days");
  });

  test("a quoted phrase lifts the chunk that holds it verbatim above the ones that merely share its words", async () => {
    const leave = documentOf("Leave and time off");
    const sick = data.chunks.find((c) => c.documentId === leave.id && c.headingPath.includes("Sick leave"))!;
    const hits = await ports.chunks.search({ libraryIds: [libraryOf("Handbook")], question: 'What does "tops up the social security payment" mean for my leave days?', limit: 5 });
    expect(hits[0]!.chunkId).toBe(sick.id);
    expect(hits[0]!.score).toBeGreaterThan(0.5);
  });

  test("the document's title counts even when the chunk's body does not hold the word", async () => {
    const hits = await ports.chunks.search({ libraryIds: [libraryOf("Runbooks")], question: "backups", limit: 20 });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.documentTitle === "Database backups and restore")).toBe(true);
    expect(hits.some((h) => !/backup/i.test(h.body))).toBe(true);
  });

  test("only the given libraries are searched", async () => {
    const hits = await ports.chunks.search({ libraryIds: [libraryOf("Runbooks")], question: "paid leave days", limit: 20 });
    const runbookDocs = new Set(data.documents.filter((d) => d.libraryId === libraryOf("Runbooks")).map((d) => d.id));
    expect(hits.every((h) => runbookDocs.has(h.documentId))).toBe(true);
    expect(hits.some((h) => h.documentTitle === "Leave and time off")).toBe(false);
  });

  test("answers at most the limit, best first, the same every time", async () => {
    const query = { libraryIds: [libraryOf("Handbook"), libraryOf("Runbooks"), libraryOf("Meeting notes")], question: "What did the team decide about the hub in Lyon?", limit: 24 };
    const a = await ports.chunks.search(query);
    const b = await ports.chunks.search(query);
    expect(a).toEqual(b);
    expect(a.length).toBeLessThanOrEqual(24);
    for (let i = 1; i < a.length; i++) expect(a[i - 1]!.score).toBeGreaterThanOrEqual(a[i]!.score);
  });
});
