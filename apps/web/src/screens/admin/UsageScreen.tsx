"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { monthOf, nextMonth, type UsageGroup } from "@cahier/domain";
import { describe } from "../../api/errors";
import { useTRPC } from "../../api/trpc";
import { useSession } from "../../auth/SessionProvider";
import { count, dollars, plural } from "../../lib/format";
import { Empty, Pill, Select, Skeleton } from "../../ui/primitives";
import { monthWords } from "./BudgetForm";
import { AdminTabs } from "./AdminTabs";
import { dailySeries, shareOf } from "./daily";
import { DailyChart } from "./DailyChart";

/*
 * The usage dashboard. The question is "how much of this month's budget is spent, and on what?",
 * so the spent figure leads, the budget is a track as long as the limit with the spent part
 * filled, the cost day by day is the biggest block, and the three breakdowns (by model, by
 * member, by agent) are ranked lists whose bars are the share of the month. The reconciliation
 * line says whether the four groupings agree with the plain sum, to the micro-dollar, because a
 * report that does not reconcile is worth nothing.
 */

const MONTHS_BACK = 6;

function monthsOffered(now: Date): string[] {
  const out: string[] = [];
  let m = monthOf(now);
  for (let i = 0; i < MONTHS_BACK; i++) {
    out.push(m);
    const [y, mo] = m.split("-").map(Number) as [number, number];
    m = monthOf(new Date(Date.UTC(y, mo - 2, 1)));
  }
  return out;
}

export function UsageScreen() {
  const trpc = useTRPC();
  const router = useRouter();
  const params = useSearchParams();
  const { session } = useSession();
  const now = new Date();
  const thisMonth = monthOf(now);
  const month = params.get("month") ?? thisMonth;
  const report = useQuery(trpc.admin.usage.report.queryOptions({ month }));
  const [y, mo] = month.split("-").map(Number) as [number, number];
  const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const daysLeft = month === thisMonth ? daysInMonth - now.getUTCDate() : 0;

  const data = report.data;
  const topAgent = data?.byAgent[0];
  const finding = report.isPending
    ? "…"
    : !data
      ? ""
      : data.total.rows === 0
        ? `Nothing was spent in ${monthWords(month)}.`
        : data.budget
          ? `${dollars(data.total.costMicros)} of the ${dollars(data.budget.limitMicros)} budget spent${month === thisMonth ? ` with ${plural(daysLeft, "day")} left` : ""}${topAgent && topAgent.label ? `; ${topAgent.label} is the biggest spender at ${dollars(topAgent.costMicros)}` : ""}.`
          : `${dollars(data.total.costMicros)} spent with no budget set for ${monthWords(month)}; answers are not limited.`;

  return (
    <div className="page">
      <AdminTabs />
      <div className="title-row">
        <div>
          <h1>Usage</h1>
          <p className="sub">
            {session?.workspace.name} · {finding}
          </p>
        </div>
        <div className="actions">
          <Select className="sm" aria-label="Month" value={month} onChange={(e) => router.push(`/admin/usage?month=${e.target.value}`)} style={{ width: 180 }}>
            {[...new Set([month, ...monthsOffered(now), nextMonth(thisMonth)])].sort().reverse().map((m) => (
              <option key={m} value={m}>
                {monthWords(m)}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {report.isError ? (
        <Empty>Could not load the report: {describe(report.error).message}</Empty>
      ) : (
        <div className="stack">
          <div className="panel kpis">
            <div className="kpi-strip">
              <div className="kpi lead">
                <span className="label">Spent in {monthWords(month)}</span>
                <span className="value">{data ? dollars(data.total.costMicros) : <Skeleton width={120} height={30} />}</span>
              </div>
              <div className="kpi">
                <span className="label">Budget</span>
                <span className="value">{data ? (data.budget ? dollars(data.budget.limitMicros) : <span className="muted">—</span>) : <Skeleton width={80} height={24} />}</span>
              </div>
              <div className="kpi">
                <span className="label">Remaining</span>
                <span className="value">{data ? (data.budget ? dollars(data.budget.remainingMicros) : <span className="muted">—</span>) : <Skeleton width={80} height={24} />}</span>
              </div>
              <div className="kpi">
                <span className="label">Tokens</span>
                <span className="value">{data ? count(data.total.tokens) : <Skeleton width={80} height={24} />}</span>
              </div>
              <div className="kpi">
                <span className="label">Usage rows</span>
                <span className="value">{data ? count(data.total.rows) : <Skeleton width={60} height={24} />}</span>
              </div>
            </div>
            {data?.budget ? (
              <div className="plan" role="img" aria-label={`${dollars(data.budget.spentMicros)} of ${dollars(data.budget.limitMicros)}`}>
                <div className="track">
                  <div className="spent" style={{ width: `${Math.min(100, 100 * shareOf(data.budget.spentMicros, data.budget.limitMicros))}%` }} />
                </div>
                <div className="ends small muted">
                  <span>{dollars(0)}</span>
                  <span>
                    {data.budget.status === "closed" ? "Closed month · " : ""}
                    {dollars(data.budget.limitMicros)}
                  </span>
                </div>
              </div>
            ) : null}
          </div>

          <div className="panel">
            <header>
              <h2>Cost per day</h2>
              {data ? data.reconciliation.agree ? <Pill tone="pos">Reconciles</Pill> : <Pill tone="neg">Does not reconcile</Pill> : null}
            </header>
            {data ? <DailyChart series={dailySeries(data.byDay, month, now)} daysInMonth={daysInMonth} /> : <Skeleton height={220} />}
            {data ? <ModelShare groups={data.byModel} total={data.total.costMicros} /> : null}
            {data ? (
              <p className="muted small" style={{ marginTop: 12 }}>
                The sum of every usage row, {dollars(data.reconciliation.rows)}, against the sums by day ({dollars(data.reconciliation.byDay)}), by model ({dollars(data.reconciliation.byModel)}), by member ({dollars(data.reconciliation.byMember)}) and by agent ({dollars(data.reconciliation.byAgent)}), to the micro-dollar.
              </p>
            ) : null}
          </div>

          <div className="usage-row even">
            <Breakdown title="By member" groups={data?.byMember} total={data?.total.costMicros} empty="Nobody asked" />
            <Breakdown title="By agent" groups={data?.byAgent} total={data?.total.costMicros} empty="No agent answered" />
          </div>
        </div>
      )}
    </div>
  );
}

const byCost = (groups: UsageGroup[]) => [...groups].sort((a, b) => b.costMicros - a.costMicros || a.label.localeCompare(b.label));
const TONES = ["var(--text)", "var(--muted)", "var(--control)", "var(--active)", "var(--raised)"];

/** The month's cost by model as one bar in shares, with 2px seams: the models are few and neutral tones tell them apart. */
function ModelShare({ groups, total }: { groups: UsageGroup[]; total: number }) {
  const rows = byCost(groups).slice(0, 5);
  if (rows.length === 0 || total === 0) return null;
  return (
    <div className="share">
      <div className="share-bar" role="img" aria-label={rows.map((g) => `${g.label} ${Math.round(100 * shareOf(g.costMicros, total))}%`).join(", ")}>
        {rows.map((g, i) => (
          <div key={g.key} style={{ width: `${100 * shareOf(g.costMicros, total)}%`, background: TONES[i] }} />
        ))}
      </div>
      <div className="share-key small">
        {rows.map((g, i) => (
          <span key={g.key}>
            <i style={{ background: TONES[i] }} />
            {g.label} <span className="muted">{dollars(g.costMicros)} · {Math.round(100 * shareOf(g.costMicros, total))}% · {count(g.tokens)} tokens</span>
          </span>
        ))}
      </div>
    </div>
  );
}

const SHOWN = 5;

/** A ranked list with a thin grey bar under each label, the top one in ink: most costly first. */
function Breakdown({ title, groups, total, empty }: { title: string; groups: UsageGroup[] | undefined; total: number | undefined; empty: string }) {
  const ranked = byCost(groups ?? []);
  const rows = ranked.slice(0, SHOWN);
  const biggest = rows[0]?.costMicros ?? 0;
  return (
    <div className="panel">
      <header>
        <h2>{title}</h2>
        {groups ? <span className="muted small">{ranked.length > SHOWN ? `the top ${SHOWN} of ${ranked.length}` : plural(ranked.length, "row")}</span> : null}
      </header>
      {!groups ? (
        <Skeleton height={120} />
      ) : rows.length === 0 ? (
        <Empty>{empty} this month.</Empty>
      ) : (
        <ol className="ranked">
          {rows.map((g, i) => (
            <li key={g.key}>
              <div className="line">
                <span className="name truncate">{g.label || "No agent"}</span>
                <span className="num">
                  {dollars(g.costMicros)} <span className="muted small">{total ? `${Math.round(100 * shareOf(g.costMicros, total))}%` : ""}</span>
                </span>
              </div>
              <div className="bar">
                <div style={{ width: `${100 * shareOf(g.costMicros, biggest)}%`, background: i === 0 ? "var(--text)" : "var(--control)" }} />
              </div>
              <div className="sub">{count(g.tokens)} tokens</div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
