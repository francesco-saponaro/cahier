// @vitest-environment node
import { readFileSync } from "node:fs";
import { createTRPCClient } from "@trpc/client";
import { DEMO_PASSWORD } from "@cahier/db/seed";
import type { AppRouter } from "@cahier/api";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDemoDatabase, type DemoDatabase } from "../src/demo/database";
import { demoLinks } from "../src/demo/session";

/*
 * The demo's database is the real thing: PostgreSQL in the process, the committed migration, the
 * seed. Here it runs under Node with the migration read from disk; in the browser the same
 * function gets the file over fetch.
 */

const migration = readFileSync(new URL("../../../packages/db/drizzle/0000_tables.sql", import.meta.url), "utf8");

describe("the demo database", () => {
  let demo: DemoDatabase;
  beforeAll(async () => {
    demo = await openDemoDatabase({ migration });
  }, 120_000);
  afterAll(() => demo.close());

  it("holds the seed: the three demo accounts can sign in and see Oriel", async () => {
    const anonymous = createTRPCClient<AppRouter>({ links: demoLinks(() => Promise.resolve(demo.useCases), null) });
    const signedIn = await anonymous.auth.signIn.mutate({ email: "noor@example.com", password: DEMO_PASSWORD });
    expect(signedIn.workspace.slug).toBe("oriel");
    expect(signedIn.role).toBe("admin");
    const asNoor = createTRPCClient<AppRouter>({ links: demoLinks(() => Promise.resolve(demo.useCases), signedIn.token) });
    const libraries = await asNoor.libraries.list.query({ scope: "all", sort: "name", limit: 50 });
    expect(libraries.items.length).toBeGreaterThan(0);
    const report = await asNoor.admin.usage.report.query({ month: "2026-11" });
    expect(report.reconciliation.agree).toBe(true);
  });

  it("retrieves with full-text search: a question streams an answer with citations", async () => {
    const anonymous = createTRPCClient<AppRouter>({ links: demoLinks(() => Promise.resolve(demo.useCases), null) });
    const { token } = await anonymous.auth.signIn.mutate({ email: "lea@example.com", password: DEMO_PASSWORD });
    const asLea = createTRPCClient<AppRouter>({ links: demoLinks(() => Promise.resolve(demo.useCases), token) });
    const agents = await asLea.agents.list.query({ scope: "shared", sort: "name", limit: 20 });
    const handbook = agents.items.find((a) => /handbook/i.test(a.name));
    expect(handbook).toBeDefined();
    const conversation = await asLea.conversations.create.mutate({ agentId: handbook!.id });
    const kinds: string[] = [];
    await new Promise<void>((resolve, reject) => {
      asLea.messages.send.subscribe(
        { conversationId: conversation.id, text: "How many days of paid leave do I earn a year?" },
        { onData: (event) => kinds.push(event.type), onComplete: resolve, onError: reject },
      );
    });
    expect(kinds[0]).toBe("started");
    expect(kinds).toContain("citations");
    expect(kinds[kinds.length - 1]).toBe("done");
  }, 60_000);
});
