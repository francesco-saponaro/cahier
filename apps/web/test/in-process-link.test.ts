// @vitest-environment node
import { createTRPCClient, TRPCClientError } from "@trpc/client";
import { initTRPC, TRPCError } from "@trpc/server";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { inProcessLink } from "../src/demo/link";

/*
 * The link that calls a router in the same process, as the demo does on PGlite: a query answers
 * its data, a mutation's error arrives as the same client error the HTTP links produce (with the
 * formatter's data), and a subscription's async iterable becomes the started, data and stopped
 * envelopes the client turns into callbacks.
 */

interface Ctx {
  who: string | null;
}

const t = initTRPC.context<Ctx>().create({
  allowOutsideOfServer: true,
  errorFormatter: ({ shape, error }) => ({ ...shape, data: { ...shape.data, reason: error.cause instanceof Error ? error.cause.message : null } }),
});

const testRouter = t.router({
  hello: t.procedure.input(z.object({ name: z.string() })).query(({ input, ctx }) => `hello ${input.name} from ${ctx.who ?? "nobody"}`),
  when: t.procedure.query(() => new Date("2026-11-24T18:00:00Z")),
  forbidden: t.procedure.mutation(() => {
    throw new TRPCError({ code: "FORBIDDEN", message: "not yours", cause: new Error("owner_only") });
  }),
  count: t.procedure.input(z.object({ to: z.number() })).subscription(async function* ({ input }) {
    for (let i = 1; i <= input.to; i++) yield i;
  }),
  endless: t.procedure.subscription(async function* ({ signal }) {
    let i = 0;
    while (!signal?.aborted) {
      yield i++;
      await new Promise((r) => setTimeout(r, 5));
    }
  }),
});

function client(who: string | null = "demo") {
  return createTRPCClient<typeof testRouter>({ links: [inProcessLink({ router: testRouter, createContext: async () => ({ who }) })] });
}

describe("the in-process link", () => {
  it("answers a query with the procedure's data and the context it was given", async () => {
    expect(await client("lea").hello.query({ name: "world" })).toBe("hello world from lea");
  });

  it("passes values through untouched: a Date stays a Date", async () => {
    // The client's types say a Date comes back as a string, since no transformer is declared; in
    // the same process nothing is serialized, so the value is the Date itself.
    const when = (await client().when.query()) as unknown;
    expect(when).toBeInstanceOf(Date);
    expect((when as Date).toISOString()).toBe("2026-11-24T18:00:00.000Z");
  });

  it("turns a procedure's error into a client error with the formatted data", async () => {
    let caught: unknown;
    try {
      await client().forbidden.mutate();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(TRPCClientError);
    const error = caught as TRPCClientError<typeof testRouter>;
    expect(error.message).toBe("not yours");
    expect(error.data?.code).toBe("FORBIDDEN");
    expect((error.data as { reason?: string }).reason).toBe("owner_only");
  });

  it("reports a missing procedure as NOT_FOUND", async () => {
    const untyped = createTRPCClient<typeof testRouter>({ links: [inProcessLink({ router: testRouter, createContext: async () => ({ who: null }) })] }) as unknown as {
      nowhere: { query: () => Promise<unknown> };
    };
    let caught: unknown;
    try {
      await untyped.nowhere.query();
    } catch (e) {
      caught = e;
    }
    expect((caught as TRPCClientError<typeof testRouter>).data?.code).toBe("NOT_FOUND");
  });

  it("delivers a subscription as started, every value in order, then complete", async () => {
    const events: string[] = [];
    await new Promise<void>((resolve, reject) => {
      client().count.subscribe(
        { to: 3 },
        {
          onStarted: () => events.push("started"),
          onData: (n) => events.push(`data ${n}`),
          onStopped: () => events.push("stopped"),
          onComplete: () => {
            events.push("complete");
            resolve();
          },
          onError: reject,
        },
      );
    });
    expect(events).toEqual(["started", "data 1", "data 2", "data 3", "stopped", "complete"]);
  });

  it("stops the generator when the subscription is unsubscribed", async () => {
    const seen: number[] = [];
    const sub = client().endless.subscribe(undefined, { onData: (n) => seen.push(n) });
    await new Promise((r) => setTimeout(r, 30));
    sub.unsubscribe();
    const atStop = seen.length;
    expect(atStop).toBeGreaterThan(1);
    await new Promise((r) => setTimeout(r, 30));
    expect(seen.length).toBe(atStop);
  });

  it("gives a subscription's error to onError with its code", async () => {
    const failing = t.router({
      boom: t.procedure.subscription(async function* () {
        yield 1;
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "no more" });
      }),
    });
    const c = createTRPCClient<typeof failing>({ links: [inProcessLink({ router: failing, createContext: async () => ({ who: null }) })] });
    const error = await new Promise<TRPCClientError<typeof failing>>((resolve) => {
      c.boom.subscribe(undefined, { onError: resolve });
    });
    expect(error.data?.code).toBe("PRECONDITION_FAILED");
    expect(error.message).toBe("no more");
  });
});
