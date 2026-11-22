import { pageQuery } from "@cahier/domain";
import * as inputs from "./inputs.js";
import { adminProcedure, memberProcedure, publicProcedure, router, unwrap } from "./trpc.js";

/*
 * The router: one procedure per use case, each parsing its input with the shared zod schema,
 * handing the actor and the input to the use case, and unwrapping the result. No rule lives
 * here. `messages.send` is a subscription: the answer streams as events over SSE on the server
 * and as an async iterable in the browser demo.
 */

const auth = router({
  signIn: publicProcedure.input(inputs.signIn).mutation(async ({ ctx, input }) => unwrap(await ctx.useCases.auth.signIn(input))),
  signOut: memberProcedure.mutation(async ({ ctx }) => {
    unwrap(await ctx.useCases.auth.signOut(ctx.session.id));
    return { ok: true as const };
  }),
  me: memberProcedure.query(async ({ ctx }) => unwrap(await ctx.useCases.auth.me(ctx.actor))),
  acceptInvitation: publicProcedure.input(inputs.acceptInvitation).mutation(async ({ ctx, input }) => unwrap(await ctx.useCases.auth.acceptInvitation(input))),
  switchWorkspace: memberProcedure.input(inputs.switchWorkspace).mutation(async ({ ctx, input }) => unwrap(await ctx.useCases.auth.switchWorkspace(ctx.actor, ctx.session.id, input.workspaceId))),
});

const conversations = router({
  list: memberProcedure.input(inputs.conversationList).query(async ({ ctx, input }) => unwrap(await ctx.useCases.conversations.list(ctx.actor, { ...pageQuery(input), status: input.status, q: input.q }))),
  get: memberProcedure.input(inputs.byId).query(async ({ ctx, input }) => unwrap(await ctx.useCases.conversations.get(ctx.actor, input.id))),
  create: memberProcedure.input(inputs.conversationCreate).mutation(async ({ ctx, input }) => unwrap(await ctx.useCases.conversations.create(ctx.actor, input.agentId))),
  rename: memberProcedure.input(inputs.conversationRename).mutation(async ({ ctx, input }) => unwrap(await ctx.useCases.conversations.rename(ctx.actor, input.id, input.title))),
  archive: memberProcedure.input(inputs.byId).mutation(async ({ ctx, input }) => unwrap(await ctx.useCases.conversations.archive(ctx.actor, input.id))),
  restore: memberProcedure.input(inputs.byId).mutation(async ({ ctx, input }) => unwrap(await ctx.useCases.conversations.restore(ctx.actor, input.id))),
});

const messages = router({
  list: memberProcedure.input(inputs.messageList).query(async ({ ctx, input }) => unwrap(await ctx.useCases.messages.list(ctx.actor, input.conversationId, pageQuery(input)))),
});

const libraries = router({
  list: memberProcedure.input(inputs.libraryList).query(async ({ ctx, input }) => unwrap(await ctx.useCases.libraries.list(ctx.actor, { ...pageQuery(input), scope: input.scope, q: input.q, sort: input.sort }))),
  get: memberProcedure.input(inputs.byId).query(async ({ ctx, input }) => unwrap(await ctx.useCases.libraries.get(ctx.actor, input.id))),
  create: memberProcedure.input(inputs.libraryFields).mutation(async ({ ctx, input }) => unwrap(await ctx.useCases.libraries.create(ctx.actor, input))),
  update: memberProcedure.input(inputs.libraryUpdate).mutation(async ({ ctx, input }) => unwrap(await ctx.useCases.libraries.update(ctx.actor, input.id, { name: input.name, description: input.description }))),
  remove: memberProcedure.input(inputs.byId).mutation(async ({ ctx, input }) => {
    unwrap(await ctx.useCases.libraries.remove(ctx.actor, input.id));
    return { ok: true as const };
  }),
});

const documents = router({
  list: memberProcedure.input(inputs.documentList).query(async ({ ctx, input }) => unwrap(await ctx.useCases.documents.list(ctx.actor, input.libraryId, { ...pageQuery(input), status: input.status, q: input.q, sort: input.sort }))),
  get: memberProcedure.input(inputs.byId).query(async ({ ctx, input }) => unwrap(await ctx.useCases.documents.get(ctx.actor, input.id))),
  upload: memberProcedure.input(inputs.documentUpload).mutation(async ({ ctx, input }) => unwrap(await ctx.useCases.documents.upload(ctx.actor, input))),
  replace: memberProcedure.input(inputs.documentReplace).mutation(async ({ ctx, input }) => unwrap(await ctx.useCases.documents.replace(ctx.actor, input.id, { text: input.text, title: input.title }))),
  reindex: memberProcedure.input(inputs.byId).mutation(async ({ ctx, input }) => unwrap(await ctx.useCases.documents.reindex(ctx.actor, input.id))),
  remove: memberProcedure.input(inputs.byId).mutation(async ({ ctx, input }) => {
    unwrap(await ctx.useCases.documents.remove(ctx.actor, input.id));
    return { ok: true as const };
  }),
});

const agents = router({
  list: memberProcedure.input(inputs.agentList).query(async ({ ctx, input }) => unwrap(await ctx.useCases.agents.list(ctx.actor, { ...pageQuery(input), scope: input.scope, q: input.q, sort: input.sort }))),
  get: memberProcedure.input(inputs.byId).query(async ({ ctx, input }) => unwrap(await ctx.useCases.agents.get(ctx.actor, input.id))),
  create: memberProcedure.input(inputs.versionFields).mutation(async ({ ctx, input }) => unwrap(await ctx.useCases.agents.create(ctx.actor, input))),
  saveDraft: memberProcedure.input(inputs.agentSaveDraft).mutation(async ({ ctx, input }) => {
    const { agentId, ...fields } = input;
    return unwrap(await ctx.useCases.agents.saveDraft(ctx.actor, agentId, fields));
  }),
  publish: memberProcedure.input(inputs.versionRef).mutation(async ({ ctx, input }) => unwrap(await ctx.useCases.agents.publish(ctx.actor, input.versionId))),
  rollBack: memberProcedure.input(inputs.versionRef).mutation(async ({ ctx, input }) => unwrap(await ctx.useCases.agents.rollBack(ctx.actor, input.versionId))),
  archive: memberProcedure.input(inputs.byId).mutation(async ({ ctx, input }) => unwrap(await ctx.useCases.agents.archive(ctx.actor, input.id))),
});

const shares = router({
  request: memberProcedure.input(inputs.shareSubject).mutation(async ({ ctx, input }) => unwrap(await ctx.useCases.shares.request(ctx.actor, input))),
  withdraw: memberProcedure.input(inputs.byId).mutation(async ({ ctx, input }) => unwrap(await ctx.useCases.shares.withdraw(ctx.actor, input.id))),
  listMine: memberProcedure.input(inputs.page).query(async ({ ctx, input }) => unwrap(await ctx.useCases.shares.listMine(ctx.actor, pageQuery(input)))),
  /** The owner or an admin; the use case decides which. */
  unshare: memberProcedure.input(inputs.shareSubject).mutation(async ({ ctx, input }) => {
    unwrap(await ctx.useCases.shares.unshare(ctx.actor, input));
    return { ok: true as const };
  }),
  approve: adminProcedure.input(inputs.byId).mutation(async ({ ctx, input }) => unwrap(await ctx.useCases.shares.approve(ctx.actor, input.id))),
  decline: adminProcedure.input(inputs.shareDecline).mutation(async ({ ctx, input }) => unwrap(await ctx.useCases.shares.decline(ctx.actor, input.id, input.reason))),
});

const schedules = router({
  list: memberProcedure.input(inputs.page).query(async ({ ctx, input }) => unwrap(await ctx.useCases.schedules.list(ctx.actor, pageQuery(input)))),
  get: memberProcedure.input(inputs.byId).query(async ({ ctx, input }) => unwrap(await ctx.useCases.schedules.get(ctx.actor, input.id))),
  create: memberProcedure.input(inputs.scheduleCreate).mutation(async ({ ctx, input }) => unwrap(await ctx.useCases.schedules.create(ctx.actor, input))),
  pause: memberProcedure.input(inputs.byId).mutation(async ({ ctx, input }) => unwrap(await ctx.useCases.schedules.pause(ctx.actor, input.id))),
  resume: memberProcedure.input(inputs.byId).mutation(async ({ ctx, input }) => unwrap(await ctx.useCases.schedules.resume(ctx.actor, input.id))),
  end: memberProcedure.input(inputs.byId).mutation(async ({ ctx, input }) => unwrap(await ctx.useCases.schedules.end(ctx.actor, input.id))),
});

const usage = router({
  mine: memberProcedure.input(inputs.monthInput).query(async ({ ctx, input }) => unwrap(await ctx.useCases.usage.mine(ctx.actor, input.month))),
});

const admin = router({
  members: router({
    list: adminProcedure.input(inputs.memberList).query(async ({ ctx, input }) => unwrap(await ctx.useCases.members.list(ctx.actor, { ...pageQuery(input), status: input.status, role: input.role, q: input.q }))),
    invitations: adminProcedure.input(inputs.invitationList).query(async ({ ctx, input }) => unwrap(await ctx.useCases.members.invitations(ctx.actor, { ...pageQuery(input), status: input.status }))),
    invite: adminProcedure.input(inputs.invite).mutation(async ({ ctx, input }) => unwrap(await ctx.useCases.members.invite(ctx.actor, input))),
    revokeInvitation: adminProcedure.input(inputs.byId).mutation(async ({ ctx, input }) => unwrap(await ctx.useCases.members.revokeInvitation(ctx.actor, input.id))),
    suspend: adminProcedure.input(inputs.membershipRef).mutation(async ({ ctx, input }) => unwrap(await ctx.useCases.members.suspend(ctx.actor, input.membershipId))),
    reinstate: adminProcedure.input(inputs.membershipRef).mutation(async ({ ctx, input }) => unwrap(await ctx.useCases.members.reinstate(ctx.actor, input.membershipId))),
    setRole: adminProcedure.input(inputs.setRole).mutation(async ({ ctx, input }) => unwrap(await ctx.useCases.members.setRole(ctx.actor, input.membershipId, input.role))),
  }),
  shares: router({
    inbox: adminProcedure.input(inputs.shareInbox).query(async ({ ctx, input }) => unwrap(await ctx.useCases.shares.inbox(ctx.actor, { ...pageQuery(input), status: input.status }))),
  }),
  settings: router({
    get: adminProcedure.query(async ({ ctx }) => unwrap(await ctx.useCases.settings.get(ctx.actor))),
    update: adminProcedure.input(inputs.settingsUpdate).mutation(async ({ ctx, input }) => unwrap(await ctx.useCases.settings.update(ctx.actor, input))),
  }),
  budgets: router({
    set: adminProcedure.input(inputs.budgetSet).mutation(async ({ ctx, input }) => unwrap(await ctx.useCases.settings.setBudget(ctx.actor, input))),
  }),
  usage: router({
    report: adminProcedure.input(inputs.monthInput).query(async ({ ctx, input }) => unwrap(await ctx.useCases.usage.report(ctx.actor, input.month))),
  }),
  audit: router({
    list: adminProcedure.input(inputs.auditList).query(async ({ ctx, input }) => unwrap(await ctx.useCases.audit.list(ctx.actor, { ...pageQuery(input), entityKind: input.entityKind, entityId: input.entityId, actorId: input.actorId, action: input.action }))),
  }),
});

export const appRouter = router({
  health: publicProcedure.query(() => ({ ok: true as const })),
  auth,
  conversations,
  messages,
  libraries,
  documents,
  agents,
  shares,
  schedules,
  usage,
  admin,
});

export type AppRouter = typeof appRouter;
