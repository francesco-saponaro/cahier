import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { generateSeed } from "@cahier/db";
import { codeOf, startServer, type Server } from "./harness.js";

/*
 * The access matrix on the seed: who gets what from each kind of procedure. Anonymous, a
 * member, an admin, a suspended person and the admin of the other workspace each try the same
 * calls; the answer is the tRPC code, over HTTP.
 */

let server: Server;
let lea: Awaited<ReturnType<Server["signIn"]>>["client"];
let tom: Awaited<ReturnType<Server["signIn"]>>["client"];
let noor: Awaited<ReturnType<Server["signIn"]>>["client"];
let other: Awaited<ReturnType<Server["signIn"]>>["client"];
let leaToken: string;
let ids: { helper: string; field: string; handbook: string; fieldNotes: string; tomMembership: string };

beforeAll(async () => {
  server = await startServer();
  ({ client: lea, token: leaToken } = await server.signIn("lea@example.com"));
  ({ client: tom } = await server.signIn("tom@example.com"));
  ({ client: noor } = await server.signIn("noor@example.com"));
  const agents = await noor.agents.list.query({ scope: "all", sort: "name", limit: 50 });
  const libraries = await noor.libraries.list.query({ scope: "all", sort: "name", limit: 50 });
  const members = await noor.admin.members.list.query({ limit: 50 });
  const anyone = (name: string) => members.items.find((m) => m.user.name === name)!;
  ids = {
    helper: agents.items.find((a) => a.name === "Handbook helper")!.id,
    field: agents.items.find((a) => a.name === "Field agent")!.id,
    handbook: libraries.items.find((l) => l.name === "Handbook")!.id,
    fieldNotes: libraries.items.find((l) => l.name === "Field notes")!.id,
    tomMembership: anyone("Tom Delaunay").id,
  };
  ({ client: other } = await server.signIn(await otherAdminEmail()));
}, 120_000);

/** The admin of Brindille, read from the seed: the other workspace has no demo account of its own. */
async function otherAdminEmail(): Promise<string> {
  const data = await generateSeed();
  const brindille = data.workspaces.find((w) => w.slug === "brindille")!;
  const membership = data.memberships.find((m) => m.workspaceId === brindille.id && m.role === "admin")!;
  return data.users.find((u) => u.id === membership.userId)!.email;
}

afterAll(async () => {
  await server.close();
});

describe("who may call what", () => {
  test("anonymous callers get the health check and nothing else", async () => {
    const anonymous = server.clientFor();
    expect(await anonymous.health.query()).toEqual({ ok: true });
    expect(await codeOf(anonymous.auth.me.query())).toBe("UNAUTHORIZED");
    expect(await codeOf(anonymous.conversations.list.query({ status: "active" }))).toBe("UNAUTHORIZED");
    expect(await codeOf(anonymous.libraries.list.query({ scope: "own", sort: "name" }))).toBe("UNAUTHORIZED");
    expect(await codeOf(anonymous.agents.get.query({ id: ids.helper }))).toBe("UNAUTHORIZED");
    expect(await codeOf(anonymous.agents.models.query())).toBe("UNAUTHORIZED");
    expect(await codeOf(anonymous.admin.usage.report.query({ month: "2026-11" }))).toBe("UNAUTHORIZED");
    expect(await codeOf(server.clientFor("not-a-token").auth.me.query())).toBe("UNAUTHORIZED");
  });

  test("a member reads shared things and own things, and nothing private of a colleague", async () => {
    expect((await lea.auth.me.query()).role).toBe("member");
    expect((await lea.agents.get.query({ id: ids.helper })).agent.name).toBe("Handbook helper");
    expect(await codeOf(lea.agents.get.query({ id: ids.field }))).toBe("NOT_FOUND");
    expect((await lea.libraries.get.query({ id: ids.handbook })).library.name).toBe("Handbook");
    expect(await codeOf(lea.libraries.get.query({ id: ids.fieldNotes }))).toBe("NOT_FOUND");
    expect(await codeOf(lea.documents.list.query({ libraryId: ids.fieldNotes, sort: "title" }))).toBe("NOT_FOUND");
    expect((await tom.libraries.get.query({ id: ids.fieldNotes })).ownerName).toBe("Tom Delaunay");
    // The builder's model list: the seed's enabled models with a price in force for every kind.
    const models = await lea.agents.models.query();
    expect(models.map((m) => m.name)).toEqual(["Code 1", "Large 4", "Mini 14B", "Mini 8B", "Small 4"]);
    expect(models.every((m) => m.prices.input !== null && m.prices.cached_input !== null && m.prices.output !== null)).toBe(true);
  });

  test("a member is kept out of the admin procedures, and out of changing a colleague's things", async () => {
    expect(await codeOf(lea.admin.members.list.query({}))).toBe("FORBIDDEN");
    expect(await codeOf(lea.admin.members.invite.mutate({ email: "x@example.com", role: "member" }))).toBe("FORBIDDEN");
    expect(await codeOf(lea.admin.shares.inbox.query({}))).toBe("FORBIDDEN");
    expect(await codeOf(lea.admin.settings.get.query())).toBe("FORBIDDEN");
    expect(await codeOf(lea.admin.budgets.set.mutate({ month: "2026-12", limitMicros: 1 }))).toBe("FORBIDDEN");
    expect(await codeOf(lea.admin.usage.report.query({ month: "2026-11" }))).toBe("FORBIDDEN");
    expect(await codeOf(lea.admin.audit.list.query({}))).toBe("FORBIDDEN");
    expect(await codeOf(lea.shares.approve.mutate({ id: "shr_00001" }))).toBe("FORBIDDEN");
    expect(await codeOf(lea.libraries.list.query({ scope: "all", sort: "name" }))).toBe("FORBIDDEN");
    expect(await codeOf(lea.libraries.update.mutate({ id: ids.handbook, name: "Mine" }))).toBe("FORBIDDEN");
    expect(await codeOf(lea.agents.archive.mutate({ id: ids.helper }))).toBe("FORBIDDEN");
    expect(await codeOf(lea.shares.unshare.mutate({ kind: "agent", id: ids.helper }))).toBe("FORBIDDEN");
  });

  test("an admin reads every library and agent of the workspace, but no conversation of anyone else", async () => {
    expect((await noor.libraries.get.query({ id: ids.fieldNotes })).library.name).toBe("Field notes");
    expect((await noor.agents.get.query({ id: ids.field })).agent.name).toBe("Field agent");
    const leaConversations = await lea.conversations.list.query({ status: "active", limit: 1 });
    const first = leaConversations.items[0]!;
    expect(await codeOf(noor.conversations.get.query({ id: first.id }))).toBe("NOT_FOUND");
    expect(await codeOf(noor.messages.list.query({ conversationId: first.id }))).toBe("NOT_FOUND");
    expect((await noor.admin.usage.report.query({ month: "2026-11" })).reconciliation.agree).toBe(true);
  });

  test("the admin of another workspace sees none of Oriel's things, even by id", async () => {
    expect((await other.auth.me.query()).workspace.slug).toBe("brindille");
    expect(await codeOf(other.libraries.get.query({ id: ids.handbook }))).toBe("NOT_FOUND");
    expect(await codeOf(other.agents.get.query({ id: ids.helper }))).toBe("NOT_FOUND");
    expect(await codeOf(other.admin.members.suspend.mutate({ membershipId: ids.tomMembership }))).toBe("NOT_FOUND");
    expect(await codeOf(other.shares.unshare.mutate({ kind: "library", id: ids.handbook }))).toBe("NOT_FOUND");
    expect((await other.libraries.list.query({ scope: "all", sort: "name" })).items.map((l) => l.name)).toEqual(["Rota notes", "Shop manual"]);
  });

  test("a suspended person's token stops working at once, and sign-in is refused until they are reinstated", async () => {
    await noor.admin.members.suspend.mutate({ membershipId: ids.tomMembership });
    expect(await codeOf(tom.auth.me.query())).toBe("UNAUTHORIZED");
    expect(await codeOf(server.clientFor().auth.signIn.mutate({ email: "tom@example.com", password: "cahier-demo" }))).toBe("FORBIDDEN");
    await noor.admin.members.reinstate.mutate({ membershipId: ids.tomMembership });
    ({ client: tom } = await server.signIn("tom@example.com"));
    expect((await tom.auth.me.query()).user.email).toBe("tom@example.com");
  });

  test("signing out ends the session, and the same token is refused afterwards", async () => {
    const extra = await server.signIn("lea@example.com");
    expect(await extra.client.auth.signOut.mutate()).toEqual({ ok: true });
    expect(await codeOf(extra.client.auth.me.query())).toBe("UNAUTHORIZED");
    expect((await server.clientFor(leaToken).auth.me.query()).user.email).toBe("lea@example.com");
  });
});
