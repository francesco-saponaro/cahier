import { describe, expect, test } from "vitest";
import { TRPCError } from "@trpc/server";
import { cryptoIdGeneratorCreator, inMemoryPortsCreator, systemClock, useCasesCreator, type Deps } from "@cahier/domain";
import { fixture } from "../../domain/test/port-contract.js";
import { PASSWORD_HASH } from "../../domain/test/harness.js";
import { appRouter, createCallerFactory, createContext, formatError, type AppRouter } from "../src/index.js";

/*
 * The router over the in-memory ports: the middleware that turns a bearer token into an actor,
 * the one that keeps members out of admin procedures, the mapping from a domain failure to a tRPC
 * error with the rule's reason in it, and one call through each sub-router. The full access
 * matrix on the seed is `apps/server`'s, over HTTP.
 */

const PASSWORD = "cahier-demo";

function world() {
  const store = fixture();
  for (const u of store.users) u.passwordHash = PASSWORD_HASH;
  const { ports, unitOfWork } = inMemoryPortsCreator(store);
  const deps: Deps = { ports, unitOfWork, clock: systemClock, ids: cryptoIdGeneratorCreator(), sessionHours: 72 };
  const useCases = useCasesCreator(deps);
  const createCaller = createCallerFactory(appRouter);
  const callerFor = async (authorization?: string, connectionParams?: Record<string, string>) => createCaller(await createContext({ useCases, authorization, connectionParams }));
  const signIn = async (email: string) => {
    const anonymous = await callerFor();
    const { token } = await anonymous.auth.signIn({ email, password: PASSWORD });
    return { caller: await callerFor(`Bearer ${token}`), token };
  };
  return { store, useCases, callerFor, signIn };
}

async function thrown(run: Promise<unknown>): Promise<TRPCError> {
  try {
    await run;
  } catch (e) {
    if (e instanceof TRPCError) return e;
    throw e;
  }
  throw new Error("expected a TRPCError");
}

describe("the router", () => {
  test("health is public; everything else needs a session; admin procedures need the admin role", async () => {
    const { callerFor, signIn } = world();
    const anonymous = await callerFor();
    expect(await anonymous.health()).toEqual({ ok: true });
    expect((await thrown(anonymous.auth.me())).code).toBe("UNAUTHORIZED");
    expect((await thrown(anonymous.libraries.list({ scope: "own", sort: "name" }))).code).toBe("UNAUTHORIZED");
    const garbage = await callerFor("Bearer nothing-here");
    expect((await thrown(garbage.auth.me())).code).toBe("UNAUTHORIZED");
    const { caller: lea } = await signIn("lea@example.com");
    expect((await lea.auth.me()).user.name).toBe("Léa");
    expect((await thrown(lea.admin.members.list({}))).code).toBe("FORBIDDEN");
    const { caller: noor } = await signIn("noor@example.com");
    expect((await noor.admin.members.list({})).items).toHaveLength(4);
  });

  test("a domain failure becomes a tRPC error of the matching code, with the rule's reason in the formatted data", async () => {
    const { signIn } = world();
    const { caller: noor } = await signIn("noor@example.com");
    const error = await thrown(noor.admin.members.suspend({ membershipId: "mem_noor" }));
    expect(error.code).toBe("PRECONDITION_FAILED");
    expect(error.message).toBe("the last active admin cannot be suspended");
    const formatted = formatError({ shape: { message: error.message, code: -32000, data: { code: error.code, httpStatus: 412, path: "admin.members.suspend" } }, error } as never);
    expect(formatted.data.reason).toBe("last_admin");
    expect((await thrown(noor.libraries.get({ id: "lib_nowhere" }))).code).toBe("NOT_FOUND");
    expect((await thrown(noor.shares.approve({ id: "shr_1" }))).code).toBe("CONFLICT");
    expect((await thrown(noor.libraries.create({ name: "", description: "" }))).code).toBe("BAD_REQUEST");
    expect((await thrown(noor.admin.settings.update({ retentionDays: 0 }))).code).toBe("BAD_REQUEST");
  });

  test("zod refuses an input the use case would never see", async () => {
    const { signIn } = world();
    const { caller: lea } = await signIn("lea@example.com");
    const error = await thrown(lea.libraries.list({ scope: "everything" as never, sort: "name" }));
    expect(error.code).toBe("BAD_REQUEST");
    expect((await thrown(lea.conversations.list({ status: "active", limit: 500 }))).code).toBe("BAD_REQUEST");
    expect((await thrown(lea.schedules.create({ agentId: "agt_helper", name: "x", prompt: "y", cadence: "weekly", atMinute: 60, weekday: 9, dayOfMonth: null, timezone: "UTC" }))).code).toBe("BAD_REQUEST");
  });

  test("one call through each sub-router answers what the use case answers", async () => {
    const { signIn, callerFor } = world();
    const { caller: lea, token } = await signIn("lea@example.com");
    const { caller: tom } = await signIn("tom@example.com");
    const { caller: noor } = await signIn("noor@example.com");
    expect((await lea.conversations.list({ status: "active" })).items.map((c) => c.title)).toEqual(["Expenses abroad", "Leave rules"]);
    expect((await lea.messages.list({ conversationId: "cnv_1" })).items).toHaveLength(3);
    expect((await lea.libraries.list({ scope: "shared", sort: "name" })).items.map((l) => l.name)).toEqual(["Handbook", "Runbooks"]);
    expect((await lea.documents.get({ id: "doc_leave" })).chunks).toHaveLength(1);
    expect((await lea.agents.get({ id: "agt_helper" })).versions).toHaveLength(3);
    expect((await tom.shares.listMine({})).items).toHaveLength(3);
    expect((await lea.schedules.get({ id: "sch_1" })).runs).toHaveLength(2);
    expect((await lea.usage.mine({ month: "2026-09" })).tokens).toBe(3500);
    expect((await noor.admin.shares.inbox({ status: "requested" })).items).toHaveLength(2);
    expect((await noor.admin.usage.report({ month: "2026-09" })).reconciliation.agree).toBe(true);
    expect((await noor.admin.audit.list({ entityKind: "library" })).items).toHaveLength(1);
    expect((await noor.admin.settings.get()).retentionDays).toBe(90);
    const invited = await noor.admin.members.invite({ email: "zoe@example.com", role: "member" });
    expect(invited.token).toHaveLength(48);
    const created = await lea.agents.create({ name: "Mine", description: "", instructions: "Answer.", modelId: "small-4", maxContextTokens: 4000, libraryIds: ["lib_drafts"] });
    expect(created.version.status).toBe("draft");
    const published = await lea.agents.publish({ versionId: created.version.id });
    expect(published.status).toBe("published");
    const conversation = await lea.conversations.create({ agentId: created.agent.id });
    expect(conversation.agentVersionId).toBe(created.version.id);
    expect(await lea.auth.signOut()).toEqual({ ok: true });
    expect((await thrown((await callerFor(`Bearer ${token}`)).auth.me())).code).toBe("UNAUTHORIZED");
  });

  test("messages.send called in-process is an async iterable of events, the way the browser demo will consume it", async () => {
    const { signIn, callerFor } = world();
    const { caller: lea } = await signIn("lea@example.com");
    const events = [];
    for await (const e of await lea.messages.send({ conversationId: "cnv_2", text: "How many days do I earn?" })) events.push(e);
    expect(events[0]?.type).toBe("started");
    expect(events.at(-1)?.type).toBe("done");
    expect(events.filter((e) => e.type === "delta").map((e) => (e.type === "delta" ? e.text : "")).join("")).toBe("Everyone earns 25 days. [1]");
    // The checks run when the iterable is first pulled, as a subscription's do.
    const start = async (iterable: Promise<AsyncIterable<unknown>>) => {
      await (await iterable)[Symbol.asyncIterator]().next();
    };
    const { token } = await signIn("tom@example.com");
    const viaParams = await callerFor(undefined, { token });
    expect((await thrown(start(viaParams.messages.send({ conversationId: "cnv_2", text: "Hello" })))).code).toBe("NOT_FOUND");
    expect((await thrown((await callerFor()).messages.send({ conversationId: "cnv_2", text: "Hello" }))).code).toBe("UNAUTHORIZED");
    expect((await thrown(start(lea.messages.send({ conversationId: "cnv_3", text: "Hello" })))).code).toBe("PRECONDITION_FAILED");
  });

  test("the router's type is exported for the web app", () => {
    const check: AppRouter = appRouter;
    expect(check).toBe(appRouter);
  });
});
