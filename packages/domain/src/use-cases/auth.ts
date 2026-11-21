import { sha256 } from "@noble/hashes/sha2.js";
import type { Actor, Invitation, Membership, PublicUser, Role, Session, User, Workspace, WorkspaceTools } from "../entities.js";
import { publicUser } from "../in-memory.js";
import { hashPassword, passwordProblems, verifyPassword } from "../password.js";
import type { Deps, Ports } from "../ports.js";
import { fail, forbidden, invalid, notFound, ok, type Result } from "../result.js";
import { invitationTransitions, move } from "../transitions.js";
import { auditRecorder } from "./audit.js";

/*
 * Sign-in, sign-out, "who is this token", switching workspaces and joining by invitation.
 * Sessions are opaque: the client holds a random token, the database holds its SHA-256, so a
 * leaked table gives nobody a session. A session names a workspace, and the actor it yields is
 * the user with the role their membership there gives them, as long as it is active.
 */

const HOUR = 60 * 60 * 1000;
const toHex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/** What the sessions and invitations tables store for a token. */
export function tokenHashOf(token: string): string {
  return toHex(sha256(new TextEncoder().encode(token)));
}

export interface SignInInput {
  email: string;
  password: string;
}

export interface AcceptInvitationInput {
  token: string;
  name: string;
  password: string;
}

export interface SignedIn {
  token: string;
  expiresAt: Date;
  user: PublicUser;
  workspace: Workspace;
  role: Role;
}

export interface Me {
  user: PublicUser;
  workspace: Workspace;
  role: Role;
  tools: WorkspaceTools;
  workspaces: { id: string; slug: string; name: string; role: Role }[];
}

const normalizeEmail = (email: string) => email.trim().toLowerCase();

export function authUseCasesCreator(deps: Deps) {
  const { ports, unitOfWork, clock, ids, sessionHours } = deps;
  const audit = auditRecorder(deps);

  // Takes the ports to write with: inside a unit of work that must be the transaction's own, never
  // the outer ones, or a single-connection database (PGlite) waits on itself forever.
  async function openSession(on: Ports, userId: string, workspaceId: string): Promise<{ token: string; session: Session }> {
    const token = ids.token(48);
    const now = clock.now();
    const session: Session = { id: ids.id("ses"), tokenHash: tokenHashOf(token), userId, workspaceId, createdAt: now, expiresAt: new Date(now.getTime() + sessionHours * HOUR) };
    await on.sessions.insert(session);
    return { token, session };
  }

  async function signedIn(on: Ports, user: User, membership: Membership): Promise<SignedIn> {
    const { token, session } = await openSession(on, user.id, membership.workspaceId);
    const workspace = (await on.workspaces.findById(membership.workspaceId))!;
    return { token, expiresAt: session.expiresAt, user: publicUser(user), workspace, role: membership.role };
  }

  async function me(actor: Actor): Promise<Result<Me>> {
    const user = await ports.users.findById(actor.userId);
    const workspace = await ports.workspaces.findById(actor.workspaceId);
    if (!user || !workspace) return notFound("user");
    const memberships = await ports.memberships.listByUser(actor.userId);
    return ok({
      user: publicUser(user),
      workspace,
      role: actor.role,
      tools: workspace.tools,
      workspaces: memberships.filter((m) => m.status === "active").map((m) => ({ id: m.workspace.id, slug: m.workspace.slug, name: m.workspace.name, role: m.role })),
    });
  }

  return {
    async signIn(input: SignInInput): Promise<Result<SignedIn>> {
      const user = await ports.users.findByEmail(normalizeEmail(input.email));
      // The same answer for an unknown email and a wrong password, so the form cannot be used to list accounts.
      if (!user || !(await verifyPassword(input.password, user.passwordHash))) return fail("unauthorized", "wrong email or password");
      const memberships = (await ports.memberships.listByUser(user.id)).filter((m) => m.status === "active");
      const first = memberships[0];
      if (!first) return fail("forbidden", "no active membership in any workspace", "no_active_membership");
      return ok(await unitOfWork.run((on) => signedIn(on, user, first)));
    },

    async signOut(token: string): Promise<Result<void>> {
      const session = await ports.sessions.findActive(tokenHashOf(token), clock.now());
      if (session) await ports.sessions.delete(session.id);
      return ok(undefined);
    },

    /** The actor behind a bearer token, or null when the token is unknown, expired, or the membership is not active. */
    async authenticate(token: string): Promise<{ actor: Actor; session: Session } | null> {
      const session = await ports.sessions.findActive(tokenHashOf(token), clock.now());
      if (!session) return null;
      const membership = await ports.memberships.find(session.workspaceId, session.userId);
      if (!membership || membership.status !== "active") return null;
      return { actor: { userId: session.userId, workspaceId: session.workspaceId, role: membership.role }, session };
    },

    me,

    async switchWorkspace(actor: Actor, sessionId: string, workspaceId: string): Promise<Result<Me>> {
      const membership = await ports.memberships.find(workspaceId, actor.userId);
      if (!membership || membership.status !== "active") return forbidden("no active membership in that workspace");
      const session = await ports.sessions.findById(sessionId);
      if (!session || session.userId !== actor.userId) return fail("unauthorized", "no session");
      await ports.sessions.update({ ...session, workspaceId });
      return me({ userId: actor.userId, workspaceId, role: membership.role });
    },

    async acceptInvitation(input: AcceptInvitationInput): Promise<Result<SignedIn>> {
      const invitation = await ports.invitations.findByTokenHash(tokenHashOf(input.token));
      if (!invitation) return notFound("invitation");
      if (invitation.status !== "sent") return fail("conflict", `the invitation was ${invitation.status}`, "invitation_decided");
      const now = clock.now();
      if (invitation.expiresAt.getTime() <= now.getTime()) {
        await ports.invitations.update({ ...invitation, status: "expired" });
        return fail("rule", "the invitation has expired", "invitation_expired");
      }
      const name = input.name.trim();
      if (name.length === 0) return invalid("a name is needed");
      const existing = await ports.users.findByEmail(invitation.email);
      if (existing) {
        if (!(await verifyPassword(input.password, existing.passwordHash))) return fail("unauthorized", "wrong password for an existing account");
      } else {
        const problems = passwordProblems(input.password);
        if (problems.length > 0) return invalid(`the password must be ${problems.join(", ")}`);
      }
      if (existing && (await ports.memberships.find(invitation.workspaceId, existing.id))) return fail("conflict", "already a member of the workspace", "already_member");
      const passwordHash = existing ? existing.passwordHash : await hashPassword(input.password);
      return ok(
        await unitOfWork.run(async (on) => {
          const user: User = existing ?? { id: ids.id("usr"), email: invitation.email, name, passwordHash, createdAt: now };
          if (!existing) await on.users.insert(user);
          const membership: Membership = { id: ids.id("mem"), workspaceId: invitation.workspaceId, userId: user.id, role: invitation.role, status: "active", createdAt: now };
          const accepted: Invitation = { ...invitation, status: move(invitationTransitions, "invitation", invitation.status, "accepted").ok ? "accepted" : invitation.status, acceptedUserId: user.id };
          await on.invitations.update(accepted);
          await on.memberships.insert(membership);
          await audit(on, { workspaceId: invitation.workspaceId, actorId: user.id, action: "invitation.accepted", entityKind: "invitation", entityId: invitation.id, before: { status: "sent" }, after: { status: "accepted" } });
          await audit(on, { workspaceId: invitation.workspaceId, actorId: user.id, action: "membership.created", entityKind: "membership", entityId: membership.id, after: { role: membership.role, status: "active" } });
          return signedIn(on, user, membership);
        }),
      );
    },
  };
}
