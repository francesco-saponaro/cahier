import type { Actor, Agent, Library, ShareRequest, ShareSubjectKind, Visibility } from "../entities.js";
import type { Page, PageQuery } from "../cursor.js";
import type { Deps, Ports, ShareFilter, ShareRow } from "../ports.js";
import { fail, forbidden, invalid, notFound, ok, type Result } from "../result.js";
import { move, shareTransitions, visibilityTransitions } from "../transitions.js";
import { canAdmin, canManageAgent, canManageLibrary } from "../access.js";
import { auditRecorder } from "./audit.js";

/*
 * Sharing with the workspace is a request an admin approves. The owner of a private library or
 * agent asks; the admin's inbox shows what approving would expose (for an agent, its libraries
 * and which of those are not themselves shared); approving flips the subject's visibility. An
 * admin sharing their own thing needs no second admin, so that request is approved at once.
 * A colleague using a shared agent still gets only the chunks they may read: visibility is
 * checked at question time, never at share time.
 */

export interface SubjectRef {
  kind: ShareSubjectKind;
  id: string;
}

type Subject = { kind: "library"; thing: Library } | { kind: "agent"; thing: Agent };

export interface InboxRow extends ShareRow {
  /** For an agent, the libraries its current (or latest) version reads, with their visibility. */
  exposes: { id: string; name: string; visibility: Visibility }[];
}

export function sharesUseCasesCreator(deps: Deps) {
  const { ports, unitOfWork, clock, ids } = deps;
  const audit = auditRecorder(deps);

  async function subjectOf(actor: Actor, ref: SubjectRef, on: Ports = ports): Promise<Result<Subject>> {
    if (ref.kind === "library") {
      const thing = await on.libraries.findById(ref.id);
      if (!thing || thing.workspaceId !== actor.workspaceId) return notFound("library");
      return ok({ kind: "library", thing });
    }
    const thing = await on.agents.findById(ref.id);
    if (!thing || thing.workspaceId !== actor.workspaceId) return notFound("agent");
    return ok({ kind: "agent", thing });
  }

  const canManage = (actor: Actor, subject: Subject) => (subject.kind === "library" ? canManageLibrary(actor, subject.thing) : canManageAgent(actor, subject.thing));

  async function setVisibility(on: Ports, actor: Actor, subject: Subject, to: Visibility, action: "shared" | "unshared"): Promise<Result<void>> {
    const next = move(visibilityTransitions, subject.kind, subject.thing.visibility, to);
    if (!next.ok) return next;
    if (subject.kind === "library") await on.libraries.update({ ...subject.thing, visibility: to });
    else await on.agents.update({ ...subject.thing, visibility: to });
    await audit(on, { workspaceId: actor.workspaceId, actorId: actor.userId, action: `${subject.kind}.${action}`, entityKind: subject.kind, entityId: subject.thing.id, before: { visibility: subject.thing.visibility }, after: { visibility: to } });
    return ok(undefined);
  }

  async function decide(actor: Actor, requestId: string, to: "approved" | "declined", reason: string | null): Promise<Result<ShareRequest>> {
    if (!canAdmin(actor, actor.workspaceId)) return forbidden("only an admin decides a share request");
    const request = await ports.shareRequests.findById(requestId);
    if (!request || request.workspaceId !== actor.workspaceId) return notFound("share request");
    const next = move(shareTransitions, "share request", request.status, to);
    if (!next.ok) return next;
    const subject = await subjectOf(actor, { kind: request.subjectKind, id: request.subjectId });
    if (!subject.ok) return subject;
    const decided: ShareRequest = { ...request, status: to, reason, decidedBy: actor.userId, decidedAt: clock.now() };
    return unitOfWork.run(async (on) => {
      await on.shareRequests.update(decided);
      await audit(on, { workspaceId: actor.workspaceId, actorId: actor.userId, action: `share.${to}`, entityKind: "share_request", entityId: request.id, before: { status: request.status }, after: { status: to }, reason });
      if (to === "approved") {
        const flipped = await setVisibility(on, actor, subject.value, "workspace", "shared");
        if (!flipped.ok) throw new Error(flipped.error.message);
      }
      return ok(decided);
    });
  }

  async function exposes(subject: ShareRequest): Promise<InboxRow["exposes"]> {
    if (subject.subjectKind !== "agent") return [];
    const agent = await ports.agents.findById(subject.subjectId);
    if (!agent) return [];
    const versions = await ports.agentVersions.listByAgent(agent.id);
    const version = versions.find((v) => v.id === agent.currentVersionId) ?? versions[versions.length - 1];
    if (!version) return [];
    const libraries = await ports.libraries.findMany(await ports.agentVersions.librariesOf(version.id));
    return libraries.map((l) => ({ id: l.id, name: l.name, visibility: l.visibility }));
  }

  return {
    async request(actor: Actor, ref: SubjectRef): Promise<Result<ShareRequest>> {
      const subject = await subjectOf(actor, ref);
      if (!subject.ok) return subject;
      if (subject.value.thing.ownerId !== actor.userId) return forbidden("only the owner asks for a share");
      if (subject.value.thing.visibility === "workspace") return fail("conflict", "already shared with the workspace", "already_shared");
      if (await ports.shareRequests.findPending(ref.kind, ref.id)) return fail("conflict", "a request is already pending", "already_requested");
      const now = clock.now();
      const admin = canAdmin(actor, actor.workspaceId);
      const request: ShareRequest = {
        id: ids.id("shr"), workspaceId: actor.workspaceId, subjectKind: ref.kind, subjectId: ref.id, requestedBy: actor.userId,
        status: admin ? "approved" : "requested", reason: null, decidedBy: admin ? actor.userId : null, createdAt: now, decidedAt: admin ? now : null,
      };
      await unitOfWork.run(async (on) => {
        await on.shareRequests.insert(request);
        await audit(on, { workspaceId: actor.workspaceId, actorId: actor.userId, action: "share.requested", entityKind: "share_request", entityId: request.id, after: { subjectKind: ref.kind, subjectId: ref.id } });
        if (admin) {
          await audit(on, { workspaceId: actor.workspaceId, actorId: actor.userId, action: "share.approved", entityKind: "share_request", entityId: request.id, before: { status: "requested" }, after: { status: "approved" } });
          const flipped = await setVisibility(on, actor, subject.value, "workspace", "shared");
          if (!flipped.ok) throw new Error(flipped.error.message);
        }
      });
      return ok(request);
    },

    async withdraw(actor: Actor, requestId: string): Promise<Result<ShareRequest>> {
      const request = await ports.shareRequests.findById(requestId);
      if (!request || request.workspaceId !== actor.workspaceId || request.requestedBy !== actor.userId) return notFound("share request");
      const next = move(shareTransitions, "share request", request.status, "withdrawn");
      if (!next.ok) return next;
      const withdrawn: ShareRequest = { ...request, status: "withdrawn", decidedAt: clock.now() };
      await unitOfWork.run(async (on) => {
        await on.shareRequests.update(withdrawn);
        await audit(on, { workspaceId: actor.workspaceId, actorId: actor.userId, action: "share.withdrawn", entityKind: "share_request", entityId: request.id, before: { status: "requested" }, after: { status: "withdrawn" } });
      });
      return ok(withdrawn);
    },

    async listMine(actor: Actor, query: PageQuery): Promise<Result<Page<ShareRow>>> {
      return ok(await ports.shareRequests.listByRequester(actor.workspaceId, actor.userId, query));
    },

    async inbox(actor: Actor, filter: ShareFilter): Promise<Result<Page<InboxRow>>> {
      if (!canAdmin(actor, actor.workspaceId)) return forbidden("only an admin reads the share inbox");
      const page = await ports.shareRequests.inbox(actor.workspaceId, filter);
      const items = await Promise.all(page.items.map(async (r) => ({ ...r, exposes: await exposes(r) })));
      return ok({ items, nextCursor: page.nextCursor });
    },

    approve: (actor: Actor, requestId: string) => decide(actor, requestId, "approved", null),

    async decline(actor: Actor, requestId: string, reason: string): Promise<Result<ShareRequest>> {
      const trimmed = reason.trim();
      if (trimmed.length === 0) return invalid("a reason is needed to decline");
      return decide(actor, requestId, "declined", trimmed);
    },

    async unshare(actor: Actor, ref: SubjectRef): Promise<Result<void>> {
      const subject = await subjectOf(actor, ref);
      if (!subject.ok) return subject;
      if (!canManage(actor, subject.value)) return forbidden("only the owner or an admin unshares");
      if (subject.value.thing.visibility !== "workspace") return fail("conflict", `a ${ref.kind} cannot go from private to private`, "forbidden_transition");
      return unitOfWork.run((on) => setVisibility(on, actor, subject.value, "private", "unshared"));
    },
  };
}
