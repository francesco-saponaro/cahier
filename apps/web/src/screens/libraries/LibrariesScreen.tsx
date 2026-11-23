"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { describe } from "../../api/errors";
import { useTRPC, useTRPCClient } from "../../api/trpc";
import { useSession } from "../../auth/SessionProvider";
import { ago, count, plural } from "../../lib/format";
import { Button, Empty, Input, Pill, SearchIcon, Select, Skeleton } from "../../ui/primitives";
import { ShareRequestsPanel } from "../shares/ShareRequestsPanel";
import { LibraryForm } from "./LibraryForm";

/*
 * The libraries: the person's own and the ones shared with the workspace (an admin sees every
 * one), with how many documents each holds and how many of those are indexed. The question is
 * "which libraries can my agents read, and is everything in them indexed?", so the indexed
 * count is the figure on every row and a shortfall is the finding.
 */

type Scope = "own" | "shared" | "all";
type Sort = "name" | "newest" | "updated";

export function LibrariesScreen() {
  const trpc = useTRPC();
  const client = useTRPCClient();
  const queryClient = useQueryClient();
  const router = useRouter();
  const params = useSearchParams();
  const { session } = useSession();
  const isAdmin = session?.role === "admin";
  const [scope, setScope] = useState<Scope>((params.get("scope") as Scope | null) ?? "own");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("name");
  const [creating, setCreating] = useState(params.get("new") === "1");
  const query = useInfiniteQuery(trpc.libraries.list.infiniteQueryOptions({ scope, q: q || undefined, sort, limit: 30 }, { getNextPageParam: (last) => last.nextCursor }));
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  const notIndexed = items.reduce((n, l) => n + (l.documentCount - l.indexedCount), 0);

  return (
    <div className="page">
      <div className="title-row">
        <div>
          <h1>Libraries</h1>
          <p className="sub">
            {session?.workspace.name} ·{" "}
            {query.isPending ? "…" : notIndexed > 0 ? `${plural(notIndexed, "document")} not indexed in ${scope === "own" ? "your libraries" : "these libraries"}; an agent cannot read them until they are.` : `every document in ${scope === "own" ? "your libraries" : "these libraries"} is indexed.`}
          </p>
        </div>
        <div className="actions">
          <Button tone="primary" onClick={() => setCreating((c) => !c)}>
            New library
          </Button>
        </div>
      </div>
      {creating ? (
        <div className="panel" style={{ marginBottom: 16, maxWidth: 640 }}>
          <header>
            <h2>New library</h2>
            <span className="muted small">Private until you share it with the workspace</span>
          </header>
          <LibraryForm
            onCancel={() => setCreating(false)}
            onSubmit={async (values) => {
              try {
                const made = await client.libraries.create.mutate(values);
                void queryClient.invalidateQueries({ queryKey: trpc.libraries.pathKey() });
                router.push(`/libraries/view?id=${encodeURIComponent(made.id)}`);
                return null;
              } catch (e) {
                return describe(e).message;
              }
            }}
          />
        </div>
      ) : null}
      <div className="tabs" role="tablist" aria-label="Which libraries" style={{ marginBottom: 12 }}>
        <button type="button" role="tab" aria-selected={scope === "own"} onClick={() => setScope("own")}>
          Mine
        </button>
        <button type="button" role="tab" aria-selected={scope === "shared"} onClick={() => setScope("shared")}>
          Shared with the workspace
        </button>
        {isAdmin ? (
          <button type="button" role="tab" aria-selected={scope === "all"} onClick={() => setScope("all")}>
            Every library
          </button>
        ) : null}
      </div>
      <div className="filters">
        <div className="search" style={{ width: 280 }}>
          <SearchIcon />
          <Input className="sm" type="search" aria-label="Search libraries" placeholder="Search by name" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Select className="sm" aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)} style={{ width: 180 }}>
          <option value="name">By name</option>
          <option value="updated">Recently updated</option>
          <option value="newest">Newest first</option>
        </Select>
        <span className="spacer" />
        <span className="muted small">{query.isPending ? "" : `${plural(items.length, "library", "libraries")}${query.hasNextPage ? " shown" : ""}`}</span>
      </div>
      <div className="with-rail">
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th style={{ width: "36%" }}>Library</th>
              <th>Owner</th>
              <th>Visibility</th>
              <th className="n">Documents</th>
              <th className="n">Indexed</th>
              <th className="n">Updated</th>
            </tr>
          </thead>
          <tbody>
            {query.isPending ? (
              [0, 1, 2].map((i) => (
                <tr key={i}>
                  <td colSpan={6}>
                    <Skeleton height={20} />
                  </td>
                </tr>
              ))
            ) : query.isError ? (
              <tr>
                <td colSpan={6}>
                  <Empty>Could not load the libraries: {describe(query.error).message}</Empty>
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={6}>
                  <Empty>{q ? "No library has that in its name." : scope === "own" ? "You have no library yet. Create one and upload a page." : "Nothing is shared with the workspace yet."}</Empty>
                </td>
              </tr>
            ) : (
              items.map((l) => (
                <tr key={l.id}>
                  <td>
                    <Link href={`/libraries/view?id=${encodeURIComponent(l.id)}`} className="name">
                      {l.name}
                    </Link>
                    {l.description ? <span className="sub truncate">{l.description}</span> : null}
                  </td>
                  <td>{l.ownerName}</td>
                  <td>{l.visibility === "workspace" ? <Pill tone="accent">Shared</Pill> : <Pill>Private</Pill>}</td>
                  <td className="n num">{count(l.documentCount)}</td>
                  <td className="n num" style={l.indexedCount < l.documentCount ? { color: "var(--negative)" } : undefined}>
                    {count(l.indexedCount)}
                  </td>
                  <td className="n">{ago(l.updatedAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        {query.hasNextPage ? (
          <div className="table-foot">
            <span>{plural(items.length, "library", "libraries")} shown</span>
            <Button small onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage}>
              Show more
            </Button>
          </div>
        ) : null}
      </div>
      <ShareRequestsPanel kind="library" />
      </div>
    </div>
  );
}
