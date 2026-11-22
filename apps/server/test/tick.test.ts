import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { startServer, type Server } from "./harness.js";

/*
 * The server's tick: with the ticker on, the seeded schedules that fell due since the seed's
 * date are run shortly after start, as conversations of their owners. The other tests leave the
 * ticker off so the seed stays as generated.
 */

let server: Server;

beforeAll(async () => {
  server = await startServer({ tickEveryMs: 50 });
}, 120_000);

afterAll(async () => {
  await server.close();
});

describe("the ticker", () => {
  test("runs the due schedules of the seed within a few ticks", async () => {
    const { client: noor } = await server.signIn("noor@example.com");
    const find = async () => {
      const mine = await noor.schedules.list.query({ limit: 50 });
      const once = mine.items.find((s) => s.name === "One-off: year-end leave")!;
      return noor.schedules.get.query({ id: once.id });
    };
    let got = await find();
    for (let i = 0; i < 40 && got.schedule.status !== "ended"; i++) {
      await new Promise((r) => setTimeout(r, 100));
      got = await find();
    }
    expect(got.schedule).toMatchObject({ status: "ended", nextRunAt: null });
    const run = got.runs[0]!;
    expect(run.status).toBe("succeeded");
    const messages = await noor.messages.list.query({ conversationId: run.conversationId!, limit: 10 });
    expect(messages.items[1]?.body).toContain("20 December");
  }, 30_000);
});
