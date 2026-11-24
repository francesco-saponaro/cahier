"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { RunStatus, ScheduleStatus } from "@cahier/domain";
import { describe } from "../../api/errors";
import { useTRPC, useTRPCClient } from "../../api/trpc";
import { useSession } from "../../auth/SessionProvider";
import { ago, plural, when } from "../../lib/format";
import { Button, Empty, Pill, Skeleton } from "../../ui/primitives";
import { cadenceWords, runWords } from "./cadence";
import { ScheduleForm } from "./ScheduleForm";

/*
 * The person's scheduled prompts. The question is "which prompts run on their own, and did the
 * last run go through?", so the table leads with the next run and the last run's outcome, and a
 * failed or skipped last run is the finding under the title. The chosen schedule's runs open in
 * the rail, each one a conversation the person can read.
 */

const STATUS_TONE: Record<ScheduleStatus, "pos" | "neutral" | "warn"> = { active: "pos", paused: "warn", ended: "neutral" };
const RUN_TONE: Record<RunStatus, "pos" | "neg" | "warn" | "neutral"> = { succeeded: "pos", failed: "neg", skipped: "warn", queued: "neutral", running: "neutral", cancelled: "neutral" };

export function SchedulesScreen() {
  const trpc = useTRPC();
  const client = useTRPCClient();
  const queryClient = useQueryClient();
  const router = useRouter();
  const params = useSearchParams();
  const { session } = useSession();
  const openId = params.get("id");
  const [creating, setCreating] = useState(params.get("new") === "1");
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

  const list = useInfiniteQuery(trpc.schedules.list.infiniteQueryOptions({ limit: 30 }, { getNextPageParam: (last) => last.nextCursor }));
  const own = useQuery({ ...trpc.agents.list.queryOptions({ scope: "own", sort: "name", limit: 50 }), enabled: creating });
  const shared = useQuery({ ...trpc.agents.list.queryOptions({ scope: "shared", sort: "name", limit: 50 }), enabled: creating });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: trpc.schedules.pathKey() });
  const act = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: "pause" | "resume" | "end" | "runNow" }) => client.schedules[action].mutate({ id }),
    onSuccess: refresh,
  });

  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const active = items.filter((s) => s.status === "active");
  const nextDue = active.map((s) => s.nextRunAt).filter((d): d is Date => d !== null).sort((a, b) => a.getTime() - b.getTime())[0];
  const finding = list.isPending ? "…" : items.length === 0 ? "No prompt runs on its own yet." : active.length === 0 ? `${plural(items.length, "schedule")}, none active.` : `${plural(active.length, "schedule")} active${nextDue ? `; the next run is ${when(nextDue)}` : ""}.`;

  return (
    <div className="page">
      <div className="title-row">
        <div>
          <h1>Schedules</h1>
          <p className="sub">
            {session?.workspace.name} · {finding}
          </p>
        </div>
        <div className="actions">
          <Button tone="primary" onClick={() => setCreating((c) => !c)}>
            New schedule
          </Button>
        </div>
      </div>
      {creating ? (
        <div className="panel" style={{ marginBottom: 16, maxWidth: 760 }}>
          <header>
            <h2>New schedule</h2>
            <span className="muted small">Runs as you, with your rights, and each run is a conversation</span>
          </header>
          {own.isPending || shared.isPending ? (
            <Skeleton height={120} />
          ) : (
            <ScheduleForm
              agents={[...(own.data?.items ?? []), ...(shared.data?.items ?? [])]
                .filter((a, i, all) => a.status === "active" && all.findIndex((b) => b.id === a.id) === i)
                .map((a) => ({ id: a.id, name: a.name }))}
              timezone={zone}
              onCancel={() => setCreating(false)}
              onSubmit={async (values) => {
                try {
                  const made = await client.schedules.create.mutate(values);
                  refresh();
                  setCreating(false);
                  router.push(`/schedules?id=${encodeURIComponent(made.id)}`);
                  return null;
                } catch (e) {
                  const failure = describe(e);
                  return failure.reason === "tool_off" ? "Scheduled prompts are switched off in this workspace; an admin can switch them on in the settings." : failure.message;
                }
              }}
            />
          )}
        </div>
      ) : null}
      <div className="stack">
        <div className="table-wrap">
          <table className="wide">
            <thead>
              <tr>
                <th style={{ width: "36%" }}>Schedule</th>
                <th style={{ width: "22%" }}>Repeats</th>
                <th style={{ width: "15%" }}>Next run</th>
                <th style={{ width: "10%" }}>Last run</th>
                <th style={{ width: "9%" }}>Status</th>
                <th style={{ width: "8%" }} aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {list.isPending ? (
                [0, 1, 2].map((i) => (
                  <tr key={i}>
                    <td colSpan={6}>
                      <Skeleton height={20} />
                    </td>
                  </tr>
                ))
              ) : list.isError ? (
                <tr>
                  <td colSpan={6}>
                    <Empty>Could not load the schedules: {describe(list.error).message}</Empty>
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <Empty>Nothing is scheduled. A schedule asks an agent the same question on a cadence and keeps every answer.</Empty>
                  </td>
                </tr>
              ) : (
                items.map((s) => (
                  <tr key={s.id} aria-current={s.id === openId ? "true" : undefined} style={s.id === openId ? { background: "var(--active)" } : undefined}>
                    <td>
                      <Link href={`/schedules?id=${encodeURIComponent(s.id)}`} className="name">
                        {s.name}
                      </Link>
                      <span className="sub truncate">
                        {s.agentName} · {s.prompt}
                      </span>
                    </td>
                    <td>{cadenceWords(s)}</td>
                    <td>{s.nextRunAt ? when(s.nextRunAt) : <span className="muted">—</span>}</td>
                    <td>{s.lastRunAt ? ago(s.lastRunAt) : <span className="muted">Never</span>}</td>
                    <td>
                      <Pill tone={STATUS_TONE[s.status]}>{s.status === "active" ? "Active" : s.status === "paused" ? "Paused" : "Ended"}</Pill>
                    </td>
                    <td className="n">
                      {s.status === "active" ? (
                        <Button small onClick={() => act.mutate({ id: s.id, action: "pause" })} disabled={act.isPending}>
                          Pause
                        </Button>
                      ) : s.status === "paused" ? (
                        <Button small onClick={() => act.mutate({ id: s.id, action: "resume" })} disabled={act.isPending}>
                          Resume
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          {list.hasNextPage ? (
            <div className="table-foot">
              <span>{plural(items.length, "schedule")} shown</span>
              <Button small onClick={() => list.fetchNextPage()} disabled={list.isFetchingNextPage}>
                Show more
              </Button>
            </div>
          ) : null}
        </div>
        {openId ? <RunsPanel id={openId} onAct={(action) => act.mutate({ id: openId, action })} busy={act.isPending} /> : <HowItWorks />}
      </div>
    </div>
  );
}

/** The chosen schedule: its prompt, the actions, and every run as a row with its outcome and the conversation it wrote. */
const RUNS_SHOWN = 8;

function RunsPanel({ id, onAct, busy }: { id: string; onAct: (action: "pause" | "resume" | "end" | "runNow") => void; busy: boolean }) {
  const trpc = useTRPC();
  const query = useQuery(trpc.schedules.get.queryOptions({ id }));
  const [showAll, setShowAll] = useState(false);
  if (query.isPending) {
    return (
      <div className="panel">
        <Skeleton height={120} />
      </div>
    );
  }
  if (query.isError) {
    return (
      <div className="panel">
        <p className="muted small">Could not load the schedule: {describe(query.error).message}</p>
      </div>
    );
  }
  const { schedule, agentName, runs } = query.data;
  const failed = runs.filter((r) => r.status === "failed").length;
  const shown = showAll ? runs : runs.slice(0, RUNS_SHOWN);
  return (
    <div className="panel">
      <header>
        <div style={{ minWidth: 0 }}>
          <h2>
            {schedule.name} <Pill tone={STATUS_TONE[schedule.status]}>{schedule.status === "active" ? "Active" : schedule.status === "paused" ? "Paused" : "Ended"}</Pill>
          </h2>
          <p className="muted small" style={{ marginTop: 4 }}>
            Asks {agentName}: “{schedule.prompt}” · {cadenceWords(schedule)}
            {schedule.nextRunAt ? ` · next ${when(schedule.nextRunAt)}` : ""}
          </p>
        </div>
        {schedule.status !== "ended" ? (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", flex: "none" }}>
            <Button small onClick={() => onAct("runNow")} disabled={busy}>
              Run now
            </Button>
            {schedule.status === "active" ? (
              <Button small onClick={() => onAct("pause")} disabled={busy}>
                Pause
              </Button>
            ) : (
              <Button small onClick={() => onAct("resume")} disabled={busy}>
                Resume
              </Button>
            )}
            <Button small tone="ghost" onClick={() => onAct("end")} disabled={busy}>
              End
            </Button>
          </div>
        ) : null}
      </header>
      {runs.length === 0 ? (
        <Empty>No run yet. The first one is written at the next scheduled time, or now with “Run now”.</Empty>
      ) : (
        <div className="scroll-x">
        <table className="wide">
          <thead>
            <tr>
              <th>Scheduled for</th>
              <th>Outcome</th>
              <th>Finished</th>
              <th className="n">Answer</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id}>
                <td className="num">{when(r.scheduledFor)}</td>
                <td>
                  <Pill tone={RUN_TONE[r.status]}>{runWords(r)}</Pill>
                </td>
                <td>{r.finishedAt ? ago(r.finishedAt) : r.startedAt ? `started ${ago(r.startedAt)}` : <span className="muted">—</span>}</td>
                <td className="n">
                  {r.conversationId ? (
                    <Link href={`/chat?c=${encodeURIComponent(r.conversationId)}`} className="link">
                      Read the answer
                    </Link>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
      <div className="table-foot" style={{ padding: "10px 0 0" }}>
        <span>
          {plural(runs.length, "run")}
          {failed > 0 ? ` · ${failed} failed` : ""}
          {runs.length > RUNS_SHOWN && !showAll ? ` · the latest ${RUNS_SHOWN} shown` : ""}
        </span>
        {runs.length > RUNS_SHOWN && !showAll ? (
          <Button small onClick={() => setShowAll(true)}>
            Show all {runs.length}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function HowItWorks() {
  return (
    <div className="panel">
      <header>
        <h2>How a schedule runs</h2>
        <span className="muted small">Pick a schedule to read its runs</span>
      </header>
      <dl className="kv two-up">
        <div>
          <dt>Who asks</dt>
          <dd>You, with your rights</dd>
        </div>
        <div>
          <dt>What it reads</dt>
          <dd>The agent’s libraries you may read</dd>
        </div>
        <div>
          <dt>Where the answer goes</dt>
          <dd>A conversation in your chat</dd>
        </div>
        <div>
          <dt>If a run is still going</dt>
          <dd>The next one is skipped</dd>
        </div>
        <div>
          <dt>What it costs</dt>
          <dd>The workspace budget, like a question</dd>
        </div>
      </dl>
    </div>
  );
}
