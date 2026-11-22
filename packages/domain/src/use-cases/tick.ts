import type { Actor, Budget, Conversation, RunStatus, ScheduledPrompt, ScheduledRun } from "../entities.js";
import type { Deps } from "../ports.js";
import { fail, notFound, ok, type Result } from "../result.js";
import { nextOccurrence } from "../schedule.js";
import { monthOf } from "../time.js";
import { budgetTransitions, conversationTransitions, move, runTransitions, scheduleTransitions } from "../transitions.js";
import { auditRecorder } from "./audit.js";
import { conversationsUseCasesCreator } from "./conversations.js";
import { messagesUseCasesCreator } from "./messages.js";

/*
 * The tick: the server calls it every minute, the browser demo on an interval. It has no actor:
 * it closes the budgets of months that have ended, deletes archived conversations older than
 * their workspace's retention (the row stays with its counts; the text goes), and runs the
 * scheduled prompts that are due, each as a conversation opened with the member's own rights, so
 * a scheduled question never sees more than the member would. `runNow` is the same run, asked
 * for by the member, whatever the schedule's next time.
 */

export interface TickReport {
  closedBudgets: number;
  deletedConversations: number;
  runs: { scheduleId: string; runId: string; status: RunStatus }[];
}

const DAY = 24 * 60 * 60 * 1000;

export function tickUseCasesCreator(deps: Deps) {
  const { ports, unitOfWork, clock, ids } = deps;
  const audit = auditRecorder(deps);
  const { conversations } = conversationsUseCasesCreator(deps);
  const messages = messagesUseCasesCreator(deps);

  async function closeBudgets(now: Date): Promise<number> {
    const open = await ports.budgets.openBefore(monthOf(now));
    for (const budget of open) {
      const next = move(budgetTransitions, "budget", budget.status, "closed");
      if (!next.ok) continue;
      const closed: Budget = { ...budget, status: "closed" };
      await unitOfWork.run(async (on) => {
        await on.budgets.update(closed);
        await audit(on, { workspaceId: budget.workspaceId, actorId: null, action: "budget.closed", entityKind: "budget", entityId: budget.id, before: { status: "open" }, after: { status: "closed", month: budget.month } });
      });
    }
    return open.length;
  }

  async function applyRetention(now: Date): Promise<number> {
    let deleted = 0;
    for (const workspace of await ports.workspaces.list()) {
      const cutoff = new Date(now.getTime() - workspace.retentionDays * DAY);
      for (const conversation of await ports.conversations.archivedBefore(workspace.id, cutoff)) {
        const next = move(conversationTransitions, "conversation", conversation.status, "deleted");
        if (!next.ok) continue;
        const gone: Conversation = { ...conversation, status: "deleted" };
        await unitOfWork.run(async (on) => {
          const removed = await on.messages.deleteByConversation(conversation.id);
          await on.conversations.update(gone);
          await audit(on, {
            workspaceId: workspace.id, actorId: null, action: "conversation.deleted", entityKind: "conversation", entityId: conversation.id,
            before: { status: "archived", archivedAt: conversation.archivedAt }, after: { status: "deleted", messagesRemoved: removed }, reason: "retention",
          });
        });
        deleted++;
      }
    }
    return deleted;
  }

  /** The member behind the schedule, as the actor the run will use; null when they are no longer active. */
  async function actorOf(schedule: ScheduledPrompt): Promise<Actor | null> {
    const membership = await ports.memberships.find(schedule.workspaceId, schedule.userId);
    if (!membership || membership.status !== "active") return null;
    return { userId: schedule.userId, workspaceId: schedule.workspaceId, role: membership.role };
  }

  async function writeRun(run: ScheduledRun, isNew: boolean): Promise<void> {
    if (isNew) await ports.schedules.insertRun(run);
    else await ports.schedules.updateRun(run);
  }

  /** A run of the schedule at `scheduledFor`: queued, then running, then its outcome; the schedule's times move only when asked. */
  async function execute(schedule: ScheduledPrompt, scheduledFor: Date, advance: boolean): Promise<ScheduledRun> {
    const now = clock.now();
    let run: ScheduledRun = { id: ids.id("run"), scheduledPromptId: schedule.id, scheduledFor, startedAt: null, finishedAt: null, status: "queued", conversationId: null, error: null };
    await writeRun(run, true);

    const skip = async (error: string): Promise<ScheduledRun> => {
      run = { ...run, status: "skipped", finishedAt: now, error };
      await writeRun(run, false);
      return run;
    };

    const workspace = await ports.workspaces.findById(schedule.workspaceId);
    const outcome: ScheduledRun = await (async () => {
      if (!workspace?.tools.scheduledPrompts) return skip("scheduled prompts are switched off in this workspace");
      const running = (await ports.schedules.runs(schedule.id)).some((r) => r.status === "running");
      if (running) return skip("the previous run is still running");
      const actor = await actorOf(schedule);
      if (!actor) return skip("the member is no longer active");

      run = { ...run, status: "running", startedAt: now };
      await writeRun(run, false);
      const opened = await conversations.create(actor, schedule.agentId);
      if (!opened.ok) return finish("failed", null, opened.error.reason ?? opened.error.message);
      const conversation = opened.value;
      await ports.conversations.update({ ...conversation, title: schedule.name });
      const stream = await messages.send(actor, conversation.id, schedule.prompt);
      if (!stream.ok) return finish("failed", conversation.id, stream.error.reason ?? stream.error.message);
      let status: RunStatus = "failed";
      let error: string | null = "no answer";
      for await (const event of stream.value) {
        if (event.type === "done") {
          status = "succeeded";
          error = null;
        }
        if (event.type === "refused") error = event.reason;
        if (event.type === "failed") error = event.error;
      }
      return finish(status, conversation.id, error);
    })();

    async function finish(status: RunStatus, conversationId: string | null, error: string | null): Promise<ScheduledRun> {
      const next = move(runTransitions, "run", run.status, status);
      run = { ...run, status: next.ok ? status : "failed", finishedAt: clock.now(), conversationId, error };
      await writeRun(run, false);
      return run;
    }

    const updated: ScheduledPrompt = { ...schedule, lastRunAt: now };
    if (advance) {
      if (schedule.cadence === "once") {
        const ended = move(scheduleTransitions, "schedule", schedule.status, "ended");
        if (ended.ok) {
          await unitOfWork.run(async (on) => {
            await on.schedules.update({ ...updated, status: "ended", nextRunAt: null });
            await audit(on, { workspaceId: schedule.workspaceId, actorId: null, action: "schedule.ended", entityKind: "scheduled_prompt", entityId: schedule.id, before: { status: schedule.status }, after: { status: "ended" }, reason: "once" });
          });
          return outcome;
        }
      }
      await ports.schedules.update({ ...updated, nextRunAt: nextOccurrence(schedule, now) });
    } else {
      await ports.schedules.update(updated);
    }
    return outcome;
  }

  return {
    /** Everything due at `now`: closed months, retention, the due schedules. */
    async tick(now: Date = clock.now()): Promise<TickReport> {
      const closedBudgets = await closeBudgets(now);
      const deletedConversations = await applyRetention(now);
      const runs: TickReport["runs"] = [];
      for (const schedule of await ports.schedules.due(now)) {
        const run = await execute(schedule, schedule.nextRunAt ?? now, true);
        runs.push({ scheduleId: schedule.id, runId: run.id, status: run.status });
      }
      return { closedBudgets, deletedConversations, runs };
    },

    /** The member runs their own schedule now; its next time is left alone. */
    async runNow(actor: Actor, scheduleId: string): Promise<Result<ScheduledRun>> {
      const schedule = await ports.schedules.findById(scheduleId);
      if (!schedule || schedule.userId !== actor.userId || schedule.workspaceId !== actor.workspaceId) return notFound("schedule");
      if (schedule.status === "ended") return fail("conflict", "the schedule has ended", "forbidden_transition");
      return ok(await execute(schedule, clock.now(), false));
    },
  };
}
