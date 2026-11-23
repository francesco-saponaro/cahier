"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AgentVersionStatus, VersionInput } from "@cahier/domain";
import { describe } from "../../api/errors";
import { useTRPC, useTRPCClient } from "../../api/trpc";
import { useSession } from "../../auth/SessionProvider";
import { ago, count, when } from "../../lib/format";
import { Button, Empty, Pill, Skeleton } from "../../ui/primitives";
import { VersionForm, type LibraryChoice } from "./VersionForm";

/*
 * The builder: the version's fields on the left, the versions on the right with publish and
 * roll back, the share request and the archive. Saving writes a draft (the open one, or the
 * next number); publishing makes it the version that answers; a published version is never
 * edited. The question is "what will this agent read, with what model, and which version is
 * answering now?".
 */

const VERSION_TONE: Record<AgentVersionStatus, "neutral" | "pos" | "accent"> = { draft: "neutral", published: "pos", retired: "neutral" };
const VERSION_WORD: Record<AgentVersionStatus, string> = { draft: "Draft", published: "Answering", retired: "Retired" };

export function BuilderScreen() {
  const params = useSearchParams();
  const id = params.get("id");
  const trpc = useTRPC();
  const client = useTRPCClient();
  const queryClient = useQueryClient();
  const router = useRouter();
  const { session } = useSession();
  const [error, setError] = useState<string | null>(null);

  const models = useQuery(trpc.agents.models.queryOptions());
  const ownLibraries = useQuery(trpc.libraries.list.queryOptions({ scope: "own", sort: "name", limit: 50 }));
  const sharedLibraries = useQuery(trpc.libraries.list.queryOptions({ scope: "shared", sort: "name", limit: 50 }));
  const agent = useQuery({ ...trpc.agents.get.queryOptions({ id: id ?? "" }), enabled: Boolean(id) });

  const libraries = useMemo<LibraryChoice[]>(() => {
    const seen = new Set<string>();
    return [...(ownLibraries.data?.items ?? []), ...(sharedLibraries.data?.items ?? [])]
      .filter((l) => !seen.has(l.id) && seen.add(l.id))
      .map((l) => ({ id: l.id, name: l.name, visibility: l.visibility, ownerName: l.ownerName, indexedCount: l.indexedCount, documentCount: l.documentCount }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [ownLibraries.data, sharedLibraries.data]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: trpc.agents.pathKey() });
  };
  const failing = (e: unknown) => setError(describe(e).message);
  const publish = useMutation({ mutationFn: (versionId: string) => client.agents.publish.mutate({ versionId }), onSuccess: refresh, onError: failing });
  const rollBack = useMutation({ mutationFn: (versionId: string) => client.agents.rollBack.mutate({ versionId }), onSuccess: refresh, onError: failing });
  const archive = useMutation({ mutationFn: () => client.agents.archive.mutate({ id: id ?? "" }), onSuccess: refresh, onError: failing });
  const requestShare = useMutation({ mutationFn: () => client.shares.request.mutate({ kind: "agent", id: id ?? "" }), onSuccess: refresh, onError: failing });
  const withdraw = useMutation({ mutationFn: (requestId: string) => client.shares.withdraw.mutate({ id: requestId }), onSuccess: refresh, onError: failing });
  const unshare = useMutation({ mutationFn: () => client.shares.unshare.mutate({ kind: "agent", id: id ?? "" }), onSuccess: refresh, onError: failing });

  const ready = models.data && ownLibraries.data && sharedLibraries.data && (!id || agent.data);
  const a = agent.data?.agent;
  const versions = agent.data?.versions ?? [];
  const draft = versions.find((v) => v.status === "draft");
  const current = versions.find((v) => v.id === a?.currentVersionId);
  const editable = draft ?? current ?? versions[versions.length - 1];
  const manageable = Boolean(a && session && (a.ownerId === session.user.id || session.role === "admin"));
  const pending = agent.data?.pendingShare ?? null;

  if (id && agent.isError) {
    return (
      <div className="page">
        <div className="title-row">
          <h1>Agent not found</h1>
        </div>
        <Empty>
          It is private to someone else or no longer exists. <Link href="/agents" className="link">Your agents</Link>
        </Empty>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="title-row">
        <div style={{ minWidth: 0 }}>
          <p className="muted small" style={{ marginBottom: 4 }}>
            <Link href="/agents" className="link">
              Agents
            </Link>
          </p>
          <h1>{id ? (a?.name ?? "…") : "New agent"}</h1>
          <p className="sub">
            {id && a
              ? `${a.ownerId === session?.user.id ? "Yours" : agent.data?.ownerName} · ${a.visibility === "workspace" ? "shared with the workspace" : pending ? "private, share requested" : "private"} · ${a.status === "archived" ? "archived" : current ? `version ${current.version} answering` : "no version published yet"}${draft ? ` · draft ${draft.version} open` : ""}`
              : "Saved as version 1, a draft; publish it so it answers."}
          </p>
        </div>
        {a && manageable && a.status === "active" ? (
          <div className="actions">
            {a.visibility === "private" && !pending ? (
              <Button onClick={() => requestShare.mutate()} disabled={requestShare.isPending || !current}>
                Share with the workspace
              </Button>
            ) : null}
            {pending ? (
              <Button onClick={() => withdraw.mutate(pending.id)} disabled={withdraw.isPending}>
                Withdraw the share request
              </Button>
            ) : null}
            {a.visibility === "workspace" ? (
              <Button onClick={() => unshare.mutate()} disabled={unshare.isPending}>
                Make private
              </Button>
            ) : null}
            <Button
              tone="danger"
              onClick={() => {
                if (window.confirm(`Archive "${a.name}"? Its conversations stay readable; no new ones can start. This cannot be undone.`)) archive.mutate();
              }}
              disabled={archive.isPending}
            >
              Archive
            </Button>
          </div>
        ) : null}
      </div>
      {error ? (
        <p className="alert" style={{ marginBottom: 12 }}>
          {error}
        </p>
      ) : null}
      {pending && session?.role !== "admin" ? (
        <p className="notice" style={{ marginBottom: 12 }}>
          Share requested {ago(pending.createdAt)}; an admin decides from the share inbox and sees which libraries the agent would expose.
        </p>
      ) : null}
      {!ready ? (
        <div className="two">
          <div className="panel">
            <Skeleton height={320} />
          </div>
          <div className="panel">
            <Skeleton height={120} />
          </div>
        </div>
      ) : (
        <div className="two">
          <div className="panel">
            <header>
              <h2>{id ? (draft ? `Draft ${draft.version}` : `Version ${(versions[versions.length - 1]?.version ?? 0) + 1}, from version ${editable?.version ?? "—"}`) : "Version 1"}</h2>
              <span className="muted small">{id ? (draft ? "Saving rewrites this draft" : "Saving opens a new draft; the published version keeps answering") : ""}</span>
            </header>
            {a && a.status === "archived" ? (
              <Empty>An archived agent is read-only. Its conversations stay readable.</Empty>
            ) : a && !manageable ? (
              <VersionSummary version={editable} libraries={libraries} />
            ) : (
              <VersionForm
                key={editable?.id ?? "new"}
                models={models.data!}
                libraries={libraries}
                initial={editable ? { name: editable.name, description: editable.description, instructions: editable.instructions, modelId: editable.modelId, maxContextTokens: editable.maxContextTokens, libraryIds: editable.libraryIds } : undefined}
                submitLabel={id ? "Save draft" : "Create as a draft"}
                onSubmit={async (values: VersionInput) => {
                  try {
                    if (id) {
                      await client.agents.saveDraft.mutate({ agentId: id, ...values });
                      refresh();
                    } else {
                      const made = await client.agents.create.mutate(values);
                      refresh();
                      router.push(`/agents/edit?id=${encodeURIComponent(made.agent.id)}`);
                    }
                    return null;
                  } catch (e) {
                    const f = describe(e);
                    return f.reason === "agent_archived" ? "The agent is archived." : f.message;
                  }
                }}
              />
            )}
          </div>
          <div className="stack">
            <div className="panel">
              <header>
                <h2>Versions</h2>
                <span className="muted small">{versions.length === 0 ? "" : `${count(versions.length)} · one answers`}</span>
              </header>
              {versions.length === 0 ? (
                <Empty>Version 1 appears once the agent is created.</Empty>
              ) : (
                <ol className="versions">
                  {[...versions].reverse().map((v) => (
                    <li key={v.id} className="version">
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <span className="name num">Version {v.version}</span>
                          <Pill tone={VERSION_TONE[v.status]}>{VERSION_WORD[v.status]}</Pill>
                        </div>
                        <div className="sub">
                          {v.modelId} · {count(v.maxContextTokens)} tokens · {v.libraryIds.length} {v.libraryIds.length === 1 ? "library" : "libraries"} · {v.publishedAt ? `published ${when(v.publishedAt)}` : `saved ${when(v.createdAt)}`}
                        </div>
                      </div>
                      {manageable && a?.status === "active" ? (
                        v.status === "draft" ? (
                          <Button small tone="primary" onClick={() => publish.mutate(v.id)} disabled={publish.isPending}>
                            Publish
                          </Button>
                        ) : v.status === "retired" ? (
                          <Button small onClick={() => rollBack.mutate(v.id)} disabled={rollBack.isPending}>
                            Roll back to it
                          </Button>
                        ) : null
                      ) : null}
                    </li>
                  ))}
                </ol>
              )}
            </div>
            {current ? (
              <div className="panel">
                <header>
                  <h2>Reads now</h2>
                  <span className="muted small">version {current.version}</span>
                </header>
                {current.libraryIds.length === 0 ? (
                  <Empty>No library: the agent finds nothing.</Empty>
                ) : (
                  <ul className="versions">
                    {current.libraryIds.map((libraryId) => {
                      const l = libraries.find((x) => x.id === libraryId);
                      return (
                        <li key={libraryId} className="version">
                          <div style={{ minWidth: 0 }}>
                            {l ? (
                              <Link href={`/libraries/view?id=${encodeURIComponent(l.id)}`} className="name">
                                {l.name}
                              </Link>
                            ) : (
                              <span className="muted">A library you cannot read</span>
                            )}
                            {l ? (
                              <div className="sub">
                                {l.visibility === "workspace" ? "Shared" : "Private"} · {l.ownerName}
                              </div>
                            ) : null}
                          </div>
                          {l ? <span className="num muted small">{l.indexedCount} of {l.documentCount} indexed</span> : null}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            ) : null}
            <div className="panel">
              <header>
                <h2>How versions work</h2>
              </header>
              <p className="muted">A published version is never edited: saving opens a draft, publishing makes the draft the one that answers and retires the previous one. Rolling back republishes a retired version under its own number. Every conversation records the version that answered it.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** What a colleague sees of a shared agent they do not manage. */
function VersionSummary({ version, libraries }: { version: { name: string; description: string; instructions: string; modelId: string; maxContextTokens: number; libraryIds: string[] } | undefined; libraries: LibraryChoice[] }) {
  if (!version) return <Empty>No version yet.</Empty>;
  const names = version.libraryIds.map((id) => libraries.find((l) => l.id === id)?.name ?? "a library you cannot read");
  return (
    <dl className="kv">
      <div>
        <dt>Description</dt>
        <dd>{version.description || "—"}</dd>
      </div>
      <div>
        <dt>Instructions</dt>
        <dd style={{ textAlign: "left", maxWidth: 480 }}>{version.instructions || "—"}</dd>
      </div>
      <div>
        <dt>Model</dt>
        <dd>{version.modelId}</dd>
      </div>
      <div>
        <dt>Context budget</dt>
        <dd className="num">{count(version.maxContextTokens)} tokens</dd>
      </div>
      <div>
        <dt>Reads</dt>
        <dd>{names.length ? names.join(", ") : "nothing"}</dd>
      </div>
    </dl>
  );
}
