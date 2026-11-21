import type { Actor, Invitation, Membership, Role } from "../entities.js";
import type { Page } from "../cursor.js";
import type { Deps, InvitationFilter, MemberFilter, MemberRow } from "../ports.js";
import { fail, forbidden, invalid, notFound, ok, type Result } from "../result.js";
import { invitationTransitions, membershipTransitions, move } from "../transitions.js";
import { canAdmin } from "../access.js";
import { auditRecorder } from "./audit.js";
import { tokenHashOf } from "./auth.js";

/*
 * The admin's members page: who is in the workspace, who was invited, suspending and reinstating,
 * changing roles. The one rule with teeth: the last active admin can be neither suspended nor
 * demoted, or the workspace would have nobody left to run it.
 */

const DAY = 24 * 60 * 60 * 1000;
const INVITATION_DAYS = 7;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface InviteInput {
  email: string;
  role: Role;
}

export function membersUseCasesCreator(deps: Deps) {
  const { ports, unitOfWork, clock, ids } = deps;
  const audit = auditRecorder(deps);

  async function ownMembership(actor: Actor, membershipId: string): Promise<Result<Membership>> {
    if (!canAdmin(actor, actor.workspaceId)) return forbidden("only an admin manages members");
    const membership = await ports.memberships.findById(membershipId);
    if (!membership || membership.workspaceId !== actor.workspaceId) return notFound("membership");
    return ok(membership);
  }

  async function lastAdmin(membership: Membership): Promise<boolean> {
    return membership.role === "admin" && membership.status === "active" && (await ports.memberships.countActiveAdmins(membership.workspaceId)) <= 1;
  }

  async function setStatus(actor: Actor, membershipId: string, to: Membership["status"]): Promise<Result<Membership>> {
    const found = await ownMembership(actor, membershipId);
    if (!found.ok) return found;
    const membership = found.value;
    const next = move(membershipTransitions, "membership", membership.status, to);
    if (!next.ok) return next;
    if (to === "suspended" && (await lastAdmin(membership))) return fail("rule", "the last active admin cannot be suspended", "last_admin");
    return ok(
      await unitOfWork.run(async (on) => {
        const updated = { ...membership, status: to };
        await on.memberships.update(updated);
        if (to === "suspended") await on.sessions.deleteByUser(membership.userId, membership.workspaceId);
        await audit(on, { workspaceId: actor.workspaceId, actorId: actor.userId, action: `membership.${to}`, entityKind: "membership", entityId: membership.id, before: { status: membership.status }, after: { status: to } });
        return updated;
      }),
    );
  }

  return {
    async list(actor: Actor, filter: MemberFilter): Promise<Result<Page<MemberRow>>> {
      if (!canAdmin(actor, actor.workspaceId)) return forbidden("only an admin lists members");
      return ok(await ports.memberships.list(actor.workspaceId, filter));
    },

    async invitations(actor: Actor, filter: InvitationFilter): Promise<Result<Page<Invitation>>> {
      if (!canAdmin(actor, actor.workspaceId)) return forbidden("only an admin lists invitations");
      return ok(await ports.invitations.list(actor.workspaceId, filter));
    },

    /** The token is answered once, for the admin to pass on; only its hash is kept. */
    async invite(actor: Actor, input: InviteInput): Promise<Result<{ invitation: Invitation; token: string }>> {
      if (!canAdmin(actor, actor.workspaceId)) return forbidden("only an admin invites");
      const email = input.email.trim().toLowerCase();
      if (!EMAIL.test(email)) return invalid("that is not an email address");
      const user = await ports.users.findByEmail(email);
      if (user && (await ports.memberships.find(actor.workspaceId, user.id))) return fail("conflict", "already a member of the workspace", "already_member");
      if (await ports.invitations.findPending(actor.workspaceId, email)) return fail("conflict", "already invited", "already_invited");
      const token = ids.token(48);
      const now = clock.now();
      const invitation: Invitation = {
        id: ids.id("inv"), workspaceId: actor.workspaceId, email, role: input.role, tokenHash: tokenHashOf(token), status: "sent",
        invitedBy: actor.userId, acceptedUserId: null, createdAt: now, expiresAt: new Date(now.getTime() + INVITATION_DAYS * DAY),
      };
      await unitOfWork.run(async (on) => {
        await on.invitations.insert(invitation);
        await audit(on, { workspaceId: actor.workspaceId, actorId: actor.userId, action: "invitation.sent", entityKind: "invitation", entityId: invitation.id, after: { email, role: input.role } });
      });
      return ok({ invitation, token });
    },

    async revokeInvitation(actor: Actor, invitationId: string): Promise<Result<Invitation>> {
      if (!canAdmin(actor, actor.workspaceId)) return forbidden("only an admin revokes an invitation");
      const invitation = await ports.invitations.findById(invitationId);
      if (!invitation || invitation.workspaceId !== actor.workspaceId) return notFound("invitation");
      const next = move(invitationTransitions, "invitation", invitation.status, "revoked");
      if (!next.ok) return next;
      const revoked = { ...invitation, status: next.value };
      await unitOfWork.run(async (on) => {
        await on.invitations.update(revoked);
        await audit(on, { workspaceId: actor.workspaceId, actorId: actor.userId, action: "invitation.revoked", entityKind: "invitation", entityId: invitation.id, before: { status: invitation.status }, after: { status: "revoked" } });
      });
      return ok(revoked);
    },

    suspend: (actor: Actor, membershipId: string) => setStatus(actor, membershipId, "suspended"),
    reinstate: (actor: Actor, membershipId: string) => setStatus(actor, membershipId, "active"),

    async setRole(actor: Actor, membershipId: string, role: Role): Promise<Result<Membership>> {
      const found = await ownMembership(actor, membershipId);
      if (!found.ok) return found;
      const membership = found.value;
      if (membership.role === role) return ok(membership);
      if (role === "member" && (await lastAdmin(membership))) return fail("rule", "the last active admin cannot be demoted", "last_admin");
      const updated = { ...membership, role };
      await unitOfWork.run(async (on) => {
        await on.memberships.update(updated);
        await audit(on, { workspaceId: actor.workspaceId, actorId: actor.userId, action: "membership.role_changed", entityKind: "membership", entityId: membership.id, before: { role: membership.role }, after: { role } });
      });
      return ok(updated);
    },
  };
}
