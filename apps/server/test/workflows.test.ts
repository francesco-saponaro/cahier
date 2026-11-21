import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { codeOf, reasonOf, startServer, type Server } from "./harness.js";

/*
 * The workflows of the plan, end to end over HTTP on the seed: a member builds an agent over a
 * new library, publishes it, asks to share it, the admin approves, a colleague opens a
 * conversation on it; an invitation is sent and accepted; the admin runs the members, the
 * settings and the budget; a member schedules a prompt. The forbidden transitions and the
 * last-admin rule answer with their codes and reasons.
 */

let server: Server;
type Client = Awaited<ReturnType<Server["signIn"]>>["client"];
let lea: Client;
let tom: Client;
let noor: Client;

beforeAll(async () => {
  server = await startServer();
  ({ client: lea } = await server.signIn("lea@example.com"));
  ({ client: tom } = await server.signIn("tom@example.com"));
  ({ client: noor } = await server.signIn("noor@example.com"));
}, 120_000);

afterAll(async () => {
  await server.close();
});

describe("build an agent, share it, use it", () => {
  let libraryId: string;
  let agentId: string;
  let versionId: string;
  let requestId: string;

  test("Tom makes a library and an agent over it, publishes version 1 and asks to share the agent", async () => {
    const library = await tom.libraries.create.mutate({ name: "Charger manuals", description: "The manuals of the chargers in the field." });
    libraryId = library.id;
    expect(library).toMatchObject({ slug: "charger-manuals", visibility: "private" });
    const made = await tom.agents.create.mutate({ name: "Charger expert", description: "", instructions: "Answer from the manuals only.", modelId: "small-4", maxContextTokens: 4000, libraryIds: [libraryId] });
    agentId = made.agent.id;
    versionId = made.version.id;
    expect(await codeOf(lea.conversations.create.mutate({ agentId }))).toBe("NOT_FOUND");
    expect(await reasonOf(tom.conversations.create.mutate({ agentId }))).toBe("agent_unusable");
    const published = await tom.agents.publish.mutate({ versionId });
    expect(published.status).toBe("published");
    expect((await tom.agents.get.query({ id: agentId })).agent.currentVersionId).toBe(versionId);
    const request = await tom.shares.request.mutate({ kind: "agent", id: agentId });
    requestId = request.id;
    expect(request.status).toBe("requested");
    expect((await tom.agents.get.query({ id: agentId })).pendingShare?.id).toBe(requestId);
  });

  test("Noor sees in the inbox that the agent exposes a private library, and approves", async () => {
    const inbox = await noor.admin.shares.inbox.query({ status: "requested", limit: 50 });
    const row = inbox.items.find((r) => r.id === requestId)!;
    expect(row.subjectName).toBe("Charger expert");
    expect(row.requesterName).toBe("Tom Delaunay");
    expect(row.exposes).toEqual([{ id: libraryId, name: "Charger manuals", visibility: "private" }]);
    const approved = await noor.shares.approve.mutate({ id: requestId });
    expect(approved.status).toBe("approved");
    expect(await codeOf(noor.shares.approve.mutate({ id: requestId }))).toBe("CONFLICT");
    expect((await noor.agents.get.query({ id: agentId })).agent.visibility).toBe("workspace");
  });

  test("Léa now sees the agent, opens a conversation on it, and still cannot read the library behind it", async () => {
    const shared = await lea.agents.list.query({ scope: "shared", sort: "name", limit: 50 });
    expect(shared.items.map((a) => a.name)).toContain("Charger expert");
    const conversation = await lea.conversations.create.mutate({ agentId });
    expect(conversation).toMatchObject({ agentId, agentVersionId: versionId, title: "New conversation", status: "active" });
    expect((await lea.conversations.list.query({ status: "active", limit: 1 })).items[0]?.id).toBe(conversation.id);
    expect(await codeOf(lea.libraries.get.query({ id: libraryId }))).toBe("NOT_FOUND");
    const renamed = await lea.conversations.rename.mutate({ id: conversation.id, title: "Charger questions" });
    expect(renamed.title).toBe("Charger questions");
    await lea.conversations.archive.mutate({ id: conversation.id });
    expect(await reasonOf(lea.conversations.archive.mutate({ id: conversation.id }))).toBe("forbidden_transition");
    await lea.conversations.restore.mutate({ id: conversation.id });
    expect((await lea.conversations.get.query({ id: conversation.id })).conversation.status).toBe("active");
  });

  test("Tom edits the agent as a draft, publishes it, rolls back, then unshares and archives it", async () => {
    const draft = await tom.agents.saveDraft.mutate({ agentId, name: "Charger expert", description: "v2", instructions: "Answer from the manuals, step by step.", modelId: "large-4", maxContextTokens: 8000, libraryIds: [libraryId] });
    expect(draft).toMatchObject({ version: 2, status: "draft" });
    expect((await tom.agents.get.query({ id: agentId })).agent.currentVersionId).toBe(versionId);
    await tom.agents.publish.mutate({ versionId: draft.id });
    const versions = (await tom.agents.get.query({ id: agentId })).versions;
    expect(versions.map((v) => [v.version, v.status])).toEqual([
      [1, "retired"],
      [2, "published"],
    ]);
    const back = await tom.agents.rollBack.mutate({ versionId });
    expect(back).toMatchObject({ version: 1, status: "published" });
    expect(await reasonOf(tom.agents.rollBack.mutate({ versionId }))).toBe("forbidden_transition");
    await tom.shares.unshare.mutate({ kind: "agent", id: agentId });
    expect(await codeOf(lea.agents.get.query({ id: agentId }))).toBe("NOT_FOUND");
    await tom.agents.archive.mutate({ id: agentId });
    expect(await reasonOf(tom.agents.saveDraft.mutate({ agentId, name: "x", description: "", instructions: "y", modelId: "small-4", maxContextTokens: 4000, libraryIds: [] }))).toBe("agent_archived");
    const audit = await noor.admin.audit.list.query({ entityKind: "agent", entityId: agentId, limit: 50 });
    expect(audit.items.map((e) => e.action)).toEqual(["agent.archived", "agent.unshared", "agent.shared", "agent.created"]);
  });
});

describe("invite, join, run the workspace", () => {
  test("an invitation is sent with a token, accepted by a new person, and they land in the workspace as a member", async () => {
    const { invitation, token } = await noor.admin.members.invite.mutate({ email: "zoe@example.com", role: "member" });
    expect(invitation.status).toBe("sent");
    expect((await noor.admin.members.invitations.query({ status: "sent", limit: 50 })).items.map((i) => i.id)).toContain(invitation.id);
    expect(await codeOf(server.clientFor().auth.acceptInvitation.mutate({ token, name: "Zoé", password: "short" }))).toBe("BAD_REQUEST");
    const signed = await server.clientFor().auth.acceptInvitation.mutate({ token, name: "Zoé", password: "a-good-long-password" });
    expect(signed.workspace.slug).toBe("oriel");
    expect(signed.role).toBe("member");
    const zoe = server.clientFor(signed.token);
    expect((await zoe.auth.me.query()).user.email).toBe("zoe@example.com");
    expect(await codeOf(server.clientFor().auth.acceptInvitation.mutate({ token, name: "Zoé", password: "a-good-long-password" }))).toBe("CONFLICT");
    expect(await reasonOf(noor.admin.members.invite.mutate({ email: "zoe@example.com", role: "member" }))).toBe("already_member");
  });

  test("the last active admin cannot be suspended or demoted, and a revoked invitation stays revoked", async () => {
    const members = await noor.admin.members.list.query({ role: "admin", status: "active", limit: 50 });
    expect(members.items.length).toBeGreaterThanOrEqual(2);
    const noorMembership = members.items.find((m) => m.user.email === "noor@example.com")!;
    const otherAdmin = members.items.find((m) => m.user.email !== "noor@example.com")!;
    // Two admins: Noor can demote the other one, then nobody can demote Noor.
    await noor.admin.members.setRole.mutate({ membershipId: otherAdmin.id, role: "member" });
    expect(await reasonOf(noor.admin.members.suspend.mutate({ membershipId: noorMembership.id }))).toBe("last_admin");
    expect(await reasonOf(noor.admin.members.setRole.mutate({ membershipId: noorMembership.id, role: "member" }))).toBe("last_admin");
    await noor.admin.members.setRole.mutate({ membershipId: otherAdmin.id, role: "admin" });
    const { invitation } = await noor.admin.members.invite.mutate({ email: "gone@example.com", role: "member" });
    await noor.admin.members.revokeInvitation.mutate({ id: invitation.id });
    expect(await reasonOf(noor.admin.members.revokeInvitation.mutate({ id: invitation.id }))).toBe("forbidden_transition");
  });

  test("settings and the budget change with an audit trail; the usage report reads the budget", async () => {
    const before = await noor.admin.settings.get.query();
    expect(before.tools).toEqual({ groundedAnswers: true, scheduledPrompts: true, uploads: true });
    const updated = await noor.admin.settings.update.mutate({ tools: { uploads: false }, retentionDays: 45 });
    expect(updated.tools.uploads).toBe(false);
    expect(updated.retentionDays).toBe(45);
    await noor.admin.settings.update.mutate({ tools: { uploads: true }, retentionDays: before.retentionDays });
    const month = new Date().toISOString().slice(0, 7);
    const budget = await noor.admin.budgets.set.mutate({ month, limitMicros: 12_000_000 });
    expect(budget).toMatchObject({ month, limitMicros: 12_000_000, status: "open" });
    expect(await reasonOf(noor.admin.budgets.set.mutate({ month: "2026-01", limitMicros: 1 }))).toBe("past_month");
    const report = await noor.admin.usage.report.query({ month });
    expect(report.budget?.limitMicros).toBe(12_000_000);
    expect(report.reconciliation.agree).toBe(true);
    const seeded = await noor.admin.usage.report.query({ month: "2026-10" });
    expect(seeded.total.rows).toBeGreaterThan(0);
    expect(seeded.reconciliation.agree).toBe(true);
    expect(seeded.byMember.reduce((n, g) => n + g.costMicros, 0)).toBe(seeded.total.costMicros);
    const mine = await lea.usage.mine.query({ month: "2026-10" });
    expect(mine.byKind.input.tokens + mine.byKind.cached_input.tokens + mine.byKind.output.tokens).toBe(mine.tokens);
    const audit = await noor.admin.audit.list.query({ action: "budget.set", limit: 1 });
    expect(audit.items[0]?.after).toEqual({ month, limitMicros: 12_000_000 });
  });

  test("a member schedules a prompt on a shared agent, pauses, resumes and ends it", async () => {
    const helper = (await lea.agents.list.query({ scope: "shared", sort: "name", limit: 50 })).items.find((a) => a.name === "Handbook helper")!;
    const schedule = await lea.schedules.create.mutate({ agentId: helper.id, name: "Monday leave check", prompt: "Who is on leave this week?", cadence: "weekly", atMinute: 9 * 60, weekday: 1, dayOfMonth: null, timezone: "Europe/Paris" });
    expect(schedule.status).toBe("active");
    expect(schedule.nextRunAt).toBeInstanceOf(Date);
    expect(schedule.nextRunAt!.getUTCDay()).toBe(1);
    expect((await lea.schedules.get.query({ id: schedule.id })).runs).toEqual([]);
    expect((await lea.schedules.pause.mutate({ id: schedule.id })).nextRunAt).toBeNull();
    expect((await lea.schedules.resume.mutate({ id: schedule.id })).nextRunAt).toEqual(schedule.nextRunAt);
    expect((await lea.schedules.end.mutate({ id: schedule.id })).status).toBe("ended");
    expect(await codeOf(tom.schedules.get.query({ id: schedule.id }))).toBe("NOT_FOUND");
    expect(await codeOf(lea.schedules.create.mutate({ agentId: helper.id, name: "Bad", prompt: "?", cadence: "monthly", atMinute: 0, weekday: null, dayOfMonth: 31, timezone: "Europe/Paris" }))).toBe("BAD_REQUEST");
  });

  test("lists page by cursor through the seed without repeating or skipping a row", async () => {
    const seen = new Set<string>();
    let cursor: string | null | undefined = null;
    for (let i = 0; i < 100; i++) {
      const page = await lea.conversations.list.query({ status: "active", limit: 7, cursor });
      for (const c of page.items) {
        expect(seen.has(c.id)).toBe(false);
        seen.add(c.id);
      }
      cursor = page.nextCursor;
      if (!cursor) break;
    }
    const all = await lea.conversations.list.query({ status: "active", limit: 50 });
    expect(all.nextCursor).toBeNull();
    expect(seen.size).toBe(all.items.length);
    expect(seen.size).toBeGreaterThan(7);
  });
});

describe("the edges of the server", () => {
  test("a bad body is a 400 from zod, not a crash; an unknown procedure is a 404", async () => {
    const res = await fetch(`${server.url}/trpc/auth.signIn`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ json: { email: 42 } }) });
    expect(res.status).toBe(400);
    const missing = await fetch(`${server.url}/trpc/nothing.here`);
    expect(missing.status).toBe(404);
  });

  test("the browser headers and the CORS origin are on the router's answers too", async () => {
    const res = await fetch(`${server.url}/trpc/health`, { headers: { origin: "http://localhost:3000" } });
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    const other = await fetch(`${server.url}/trpc/health`, { headers: { origin: "http://evil.example" } });
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
  });
});
