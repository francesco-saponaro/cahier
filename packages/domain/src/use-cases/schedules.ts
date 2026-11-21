import type { Actor, Cadence, ScheduledPrompt, ScheduledRun } from "../entities.js";
import type { Page, PageQuery } from "../cursor.js";
import type { Deps, ScheduleRow } from "../ports.js";
import { fail, invalid, notFound, ok, type Result } from "../result.js";
import { isTimeZone, nextOccurrence } from "../schedule.js";
import { move, scheduleTransitions } from "../transitions.js";
import { auditRecorder } from "./audit.js";
import { conversationsUseCasesCreator } from "./conversations.js";

/*
 * Scheduled prompts: a question asked of an agent on a cadence, with the member's own rights.
 * Creating one computes its next run from now in its time zone; pausing clears it, resuming
 * computes it again, ending is final. The tick that runs them is session 3's.
 */

export interface ScheduleInput {
  agentId: string;
  name: string;
  prompt: string;
  cadence: Cadence;
  atMinute: number;
  weekday: number | null;
  dayOfMonth: number | null;
  timezone: string;
}

export const PROMPT_MAX = 2000;

export function checkSchedule(input: ScheduleInput): Result<ScheduleInput> {
  const name = input.name.trim();
  const prompt = input.prompt.trim();
  if (name.length === 0 || name.length > 80) return invalid("a name of 1 to 80 characters is needed");
  if (prompt.length === 0 || prompt.length > PROMPT_MAX) return invalid(`a prompt of 1 to ${PROMPT_MAX} characters is needed`);
  if (!Number.isInteger(input.atMinute) || input.atMinute < 0 || input.atMinute > 1439) return invalid("the time must be a minute of the day");
  if (input.cadence === "weekly" && (input.weekday === null || !Number.isInteger(input.weekday) || input.weekday < 0 || input.weekday > 6)) return invalid("a weekly schedule needs a weekday");
  if (input.cadence === "monthly" && (input.dayOfMonth === null || !Number.isInteger(input.dayOfMonth) || input.dayOfMonth < 1 || input.dayOfMonth > 28)) return invalid("a monthly schedule needs a day from 1 to 28");
  if (!isTimeZone(input.timezone)) return invalid("that is not a time zone");
  return ok({
    ...input,
    name,
    prompt,
    weekday: input.cadence === "weekly" ? input.weekday : null,
    dayOfMonth: input.cadence === "monthly" ? input.dayOfMonth : null,
  });
}

export function schedulesUseCasesCreator(deps: Deps) {
  const { ports, unitOfWork, clock, ids } = deps;
  const audit = auditRecorder(deps);
  const { conversations } = conversationsUseCasesCreator(deps);

  async function own(actor: Actor, scheduleId: string): Promise<Result<ScheduledPrompt>> {
    const schedule = await ports.schedules.findById(scheduleId);
    if (!schedule || schedule.userId !== actor.userId || schedule.workspaceId !== actor.workspaceId) return notFound("schedule");
    return ok(schedule);
  }

  async function setStatus(actor: Actor, scheduleId: string, to: ScheduledPrompt["status"], action: string): Promise<Result<ScheduledPrompt>> {
    const found = await own(actor, scheduleId);
    if (!found.ok) return found;
    const schedule = found.value;
    const next = move(scheduleTransitions, "schedule", schedule.status, to);
    if (!next.ok) return next;
    const updated: ScheduledPrompt = { ...schedule, status: to, nextRunAt: to === "active" ? nextOccurrence(schedule, clock.now()) : null };
    await unitOfWork.run(async (on) => {
      await on.schedules.update(updated);
      await audit(on, { workspaceId: actor.workspaceId, actorId: actor.userId, action: `schedule.${action}`, entityKind: "scheduled_prompt", entityId: schedule.id, before: { status: schedule.status }, after: { status: to } });
    });
    return ok(updated);
  }

  return {
    async list(actor: Actor, query: PageQuery): Promise<Result<Page<ScheduleRow>>> {
      return ok(await ports.schedules.list(actor.workspaceId, actor.userId, query));
    },

    async get(actor: Actor, scheduleId: string): Promise<Result<{ schedule: ScheduledPrompt; agentName: string; runs: ScheduledRun[] }>> {
      const found = await own(actor, scheduleId);
      if (!found.ok) return found;
      const agent = await ports.agents.findById(found.value.agentId);
      return ok({ schedule: found.value, agentName: agent?.name ?? "", runs: await ports.schedules.runs(scheduleId) });
    },

    async create(actor: Actor, input: ScheduleInput): Promise<Result<ScheduledPrompt>> {
      const workspace = await ports.workspaces.findById(actor.workspaceId);
      if (!workspace?.tools.scheduledPrompts) return fail("rule", "scheduled prompts are switched off in this workspace", "tool_off");
      const agent = await conversations.usableAgent(actor, input.agentId);
      if (!agent.ok) return agent;
      const checked = checkSchedule(input);
      if (!checked.ok) return checked;
      const now = clock.now();
      const schedule: ScheduledPrompt = {
        id: ids.id("sch"), workspaceId: actor.workspaceId, userId: actor.userId, agentId: input.agentId, name: checked.value.name, prompt: checked.value.prompt,
        cadence: input.cadence, atMinute: input.atMinute, weekday: checked.value.weekday, dayOfMonth: checked.value.dayOfMonth, timezone: input.timezone,
        nextRunAt: nextOccurrence(checked.value, now), status: "active", createdAt: now, lastRunAt: null,
      };
      await unitOfWork.run(async (on) => {
        await on.schedules.insert(schedule);
        await audit(on, { workspaceId: actor.workspaceId, actorId: actor.userId, action: "schedule.created", entityKind: "scheduled_prompt", entityId: schedule.id, after: { name: schedule.name, cadence: schedule.cadence, agentId: schedule.agentId } });
      });
      return ok(schedule);
    },

    pause: (actor: Actor, scheduleId: string) => setStatus(actor, scheduleId, "paused", "paused"),
    resume: (actor: Actor, scheduleId: string) => setStatus(actor, scheduleId, "active", "resumed"),
    end: (actor: Actor, scheduleId: string) => setStatus(actor, scheduleId, "ended", "ended"),
  };
}
