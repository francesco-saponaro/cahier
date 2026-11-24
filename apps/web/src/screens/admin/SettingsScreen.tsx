"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { monthOf, nextMonth } from "@cahier/domain";
import { describe } from "../../api/errors";
import { useTRPC, useTRPCClient } from "../../api/trpc";
import { useSession } from "../../auth/SessionProvider";
import { dollars, plural } from "../../lib/format";
import { Empty, Pill, Skeleton } from "../../ui/primitives";
import { AdminTabs } from "./AdminTabs";
import { BudgetForm, monthWords, type BudgetValues } from "./BudgetForm";
import { SettingsForm, type SettingsValues } from "./SettingsForm";

/*
 * The workspace's settings: which tools are on, how long archived conversations are kept, and
 * the budget for this month and the next. Each section is a label column beside its panel; the
 * label column says what the setting produces, so the screen is not three controls on a sheet.
 * The budget months are the two the API will take: a past month is closed and stays as it was.
 */

export function SettingsScreen() {
  const trpc = useTRPC();
  const client = useTRPCClient();
  const queryClient = useQueryClient();
  const { session } = useSession();
  const query = useQuery(trpc.admin.settings.get.queryOptions());
  const refresh = () => void queryClient.invalidateQueries({ queryKey: trpc.admin.pathKey() });
  const update = useMutation({ mutationFn: (values: SettingsValues) => client.admin.settings.update.mutate(values), onSuccess: refresh });
  const setBudget = useMutation({ mutationFn: (values: BudgetValues) => client.admin.budgets.set.mutate(values), onSuccess: refresh });
  const thisMonth = monthOf(new Date());
  const next = nextMonth(thisMonth);
  const data = query.data;
  const off = data ? (Object.entries(data.tools) as [string, boolean][]).filter(([, on]) => !on).length : 0;
  const finding = query.isPending ? "…" : !data ? "" : `${off === 0 ? "Every tool is on" : `${plural(off, "tool")} switched off`}; archived conversations are kept ${plural(data.retentionDays, "day")}; ${data.budgets.find((b) => b.month === thisMonth) ? `this month's budget is ${dollars(data.budgets.find((b) => b.month === thisMonth)!.limitMicros)}` : "this month has no budget"}.`;

  return (
    <div className="page">
      <AdminTabs />
      <div className="title-row">
        <div>
          <h1>Settings</h1>
          <p className="sub">
            {session?.workspace.name} · {finding}
          </p>
        </div>
      </div>
      {query.isError ? (
        <Empty>Could not load the settings: {describe(query.error).message}</Empty>
      ) : (
        <div className="settings">
          <section className="setting">
            <div className="about">
              <h2>Tools and retention</h2>
              <p className="muted">
                A tool switched off stops at once for every member: a question is refused as “tool off”, an upload is refused, a schedule stops running. Retention deletes the messages of an archived conversation after the days set; the conversation’s counts and its usage rows stay, so the month still reconciles.
              </p>
            </div>
            <div className="panel split">
              {data ? (
                <SettingsForm
                  key={`${JSON.stringify(data.tools)}-${data.retentionDays}`}
                  initial={{ tools: data.tools, retentionDays: data.retentionDays }}
                  onSubmit={async (values) => {
                    try {
                      await update.mutateAsync(values);
                      return null;
                    } catch (e) {
                      return describe(e).message;
                    }
                  }}
                />
              ) : (
                <Skeleton height={200} />
              )}
              <div>
                <h3 className="small-title">In force now</h3>
                {data ? (
                  <dl className="kv">
                    <div>
                      <dt>Grounded answers</dt>
                      <dd>{data.tools.groundedAnswers ? <Pill tone="pos">On</Pill> : <Pill>Off</Pill>}</dd>
                    </div>
                    <div>
                      <dt>Scheduled prompts</dt>
                      <dd>{data.tools.scheduledPrompts ? <Pill tone="pos">On</Pill> : <Pill>Off</Pill>}</dd>
                    </div>
                    <div>
                      <dt>Document upload</dt>
                      <dd>{data.tools.uploads ? <Pill tone="pos">On</Pill> : <Pill>Off</Pill>}</dd>
                    </div>
                    <div>
                      <dt>Retention</dt>
                      <dd>{plural(data.retentionDays, "day")}</dd>
                    </div>
                    <div>
                      <dt>Workspace</dt>
                      <dd>{data.workspace.name}</dd>
                    </div>
                  </dl>
                ) : (
                  <Skeleton height={120} />
                )}
              </div>
            </div>
          </section>
          <section className="setting">
            <div className="about">
              <h2>Budget</h2>
              <p className="muted">
                The month’s limit in dollars. Every answer is costed at the model’s price in force when it was produced, and a question is refused as “budget exhausted” when the month’s usage would pass the limit. This month’s limit can be raised or lowered in place; next month’s can be set ahead. A past month is closed and stays as it was spent.
              </p>
            </div>
            <div className="panel split">
              <div className="stack">
                {data ? (
                  <>
                  <BudgetForm
                    key={`this-${data.budgets.find((b) => b.month === thisMonth)?.limitMicros ?? "none"}`}
                    month={thisMonth}
                    limitMicros={data.budgets.find((b) => b.month === thisMonth)?.limitMicros ?? null}
                    onSubmit={async (values) => {
                      try {
                        await setBudget.mutateAsync(values);
                        return null;
                      } catch (e) {
                        return describe(e).message;
                      }
                    }}
                  />
                  <BudgetForm
                    key={`next-${data.budgets.find((b) => b.month === next)?.limitMicros ?? "none"}`}
                    month={next}
                    limitMicros={data.budgets.find((b) => b.month === next)?.limitMicros ?? null}
                    onSubmit={async (values) => {
                      try {
                        await setBudget.mutateAsync(values);
                        return null;
                      } catch (e) {
                        return describe(e).message;
                      }
                    }}
                  />
                  </>
                ) : (
                  <Skeleton height={160} />
                )}
              </div>
              <div>
                <h3 className="small-title">Budgets so far</h3>
                {!data ? (
                  <Skeleton height={120} />
                ) : data.budgets.length === 0 ? (
                  <p className="muted small">No month has a budget yet.</p>
                ) : (
                  <dl className="kv">
                    {data.budgets.slice(0, 8).map((b) => (
                      <div key={b.id}>
                        <dt>{monthWords(b.month)}</dt>
                        <dd>
                          {dollars(b.limitMicros)} {b.status === "closed" ? <Pill>Closed</Pill> : <Pill tone="pos">Open</Pill>}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
