"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DocumentStatus } from "@cahier/domain";
import { describe } from "../../api/errors";
import { useTRPC, useTRPCClient } from "../../api/trpc";
import { useSession } from "../../auth/SessionProvider";
import { ago, count, plural } from "../../lib/format";
import { Button, Empty, Input, Pill, SearchIcon, Select, Skeleton } from "../../ui/primitives";
import { STATUS_TONE, STATUS_WORD } from "../documents/ViewerScreen";
import { DocumentForm } from "./DocumentForm";
import { LibraryForm } from "./LibraryForm";

/*
 * One library: its documents with their status, version and size, searchable and sortable on the
 * server; the upload form; and for the owner (or an admin) the share request, the edit and the
 * removal. The question is "is every document here indexed?": a failed or stuck one is the
 * finding, named under the title.
 */

type Sort = "newest" | "title";

export function LibraryScreen() {
  const params = useSearchParams();
  const id = params.get("id") ?? "";
  const trpc = useTRPC();
  const client = useTRPCClient();
  const queryClient = useQueryClient();
  const router = useRouter();
  const { session } = useSession();
  const library = useQuery({ ...trpc.libraries.get.queryOptions({ id }), enabled: Boolean(id) });
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<DocumentStatus | "">("");
  const [sort, setSort] = useState<Sort>("newest");
  const [uploading, setUploading] = useState(params.get("upload") === "1");
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const documents = useInfiniteQuery(trpc.documents.list.infiniteQueryOptions({ libraryId: id, q: q || undefined, status: status || undefined, sort, limit: 30 }, { getNextPageParam: (last) => last.nextCursor, enabled: Boolean(id) }));
  const items = documents.data?.pages.flatMap((p) => p.items) ?? [];

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: trpc.libraries.pathKey() });
    void queryClient.invalidateQueries({ queryKey: trpc.documents.pathKey() });
  };
  const failing = (e: unknown) => setError(describe(e).message);
  const requestShare = useMutation({ mutationFn: () => client.shares.request.mutate({ kind: "library", id }), onSuccess: refresh, onError: failing });
  const withdraw = useMutation({ mutationFn: (requestId: string) => client.shares.withdraw.mutate({ id: requestId }), onSuccess: refresh, onError: failing });
  const unshare = useMutation({ mutationFn: () => client.shares.unshare.mutate({ kind: "library", id }), onSuccess: refresh, onError: failing });
  const removeLibrary = useMutation({ mutationFn: () => client.libraries.remove.mutate({ id }), onSuccess: () => router.push("/libraries"), onError: failing });
  const removeDocument = useMutation({ mutationFn: (documentId: string) => client.documents.remove.mutate({ id: documentId }), onSuccess: refresh, onError: failing });
  const reindex = useMutation({ mutationFn: (documentId: string) => client.documents.reindex.mutate({ id: documentId }), onSuccess: refresh, onError: failing });

  if (!id) return <Empty>No library named.</Empty>;
  if (library.isPending) {
    return (
      <div className="page">
        <Skeleton width={280} height={28} />
      </div>
    );
  }
  if (library.isError) {
    return (
      <div className="page">
        <div className="title-row">
          <h1>Library not found</h1>
        </div>
        <Empty>
          It was removed, or it is private to someone else. <Link href="/libraries" className="link">Your libraries</Link>
        </Empty>
      </div>
    );
  }

  const l = library.data.library;
  const mine = session?.user.id === l.ownerId;
  const manageable = mine || session?.role === "admin";
  const pending = library.data.pendingShare;
  const notIndexed = items.filter((d) => d.status !== "indexed");

  return (
    <div className="page">
      <div className="title-row">
        <div style={{ minWidth: 0 }}>
          <p className="muted small" style={{ marginBottom: 4 }}>
            <Link href="/libraries" className="link">
              Libraries
            </Link>
          </p>
          <h1>{l.name}</h1>
          <p className="sub">
            {l.description ? `${l.description} · ` : ""}
            {mine ? "Yours" : library.data.ownerName} · {l.visibility === "workspace" ? "shared with the workspace" : pending ? "private, share requested" : "private"}
            {documents.data ? (notIndexed.length > 0 ? ` · ${plural(notIndexed.length, "document")} not indexed` : items.length > 0 ? " · every document indexed" : "") : ""}
          </p>
        </div>
        <div className="actions">
          {manageable ? (
            <>
              {l.visibility === "private" && !pending ? (
                <Button onClick={() => requestShare.mutate()} disabled={requestShare.isPending}>
                  Share with the workspace
                </Button>
              ) : null}
              {pending ? (
                <Button onClick={() => withdraw.mutate(pending.id)} disabled={withdraw.isPending}>
                  Withdraw the share request
                </Button>
              ) : null}
              {l.visibility === "workspace" ? (
                <Button onClick={() => unshare.mutate()} disabled={unshare.isPending}>
                  Make private
                </Button>
              ) : null}
              <Button onClick={() => setEditing((e) => !e)}>Edit</Button>
              <Button tone="primary" onClick={() => setUploading((u) => !u)}>
                Upload a document
              </Button>
            </>
          ) : null}
        </div>
      </div>
      {error ? (
        <p className="alert" style={{ marginBottom: 12 }}>
          {error}
        </p>
      ) : null}
      {pending && session?.role !== "admin" ? (
        <p className="notice" style={{ marginBottom: 12 }}>
          Share requested {ago(pending.createdAt)}; an admin approves or declines it from the share inbox. Until then the library stays private.
        </p>
      ) : null}
      {editing ? (
        <div className="panel" style={{ marginBottom: 16, maxWidth: 640 }}>
          <header>
            <h2>Edit the library</h2>
          </header>
          <LibraryForm
            initial={{ name: l.name, description: l.description }}
            onCancel={() => setEditing(false)}
            onSubmit={async (values) => {
              try {
                await client.libraries.update.mutate({ id, ...values });
                setEditing(false);
                refresh();
                return null;
              } catch (e) {
                return describe(e).message;
              }
            }}
          />
        </div>
      ) : null}
      {uploading ? (
        <div className="panel" style={{ marginBottom: 16, maxWidth: 760 }}>
          <header>
            <h2>Upload a document</h2>
            <span className="muted small">Indexed on upload; the viewer shows the chunks</span>
          </header>
          <DocumentForm
            mode="upload"
            onCancel={() => setUploading(false)}
            onSubmit={async (values) => {
              try {
                const made = await client.documents.upload.mutate({ libraryId: id, title: values.title, text: values.text, ...(values.sourceName ? { sourceName: values.sourceName } : {}) });
                setUploading(false);
                refresh();
                router.push(`/documents/view?id=${encodeURIComponent(made.document.id)}`);
                return null;
              } catch (e) {
                const f = describe(e);
                return f.reason === "tool_off" ? "Uploads are switched off in this workspace; an admin can switch them on in Settings." : f.message;
              }
            }}
          />
        </div>
      ) : null}
      <div className="filters">
        <div className="search" style={{ width: 280 }}>
          <SearchIcon />
          <Input className="sm" type="search" aria-label="Search documents" placeholder="Search by title" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Select className="sm" aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as DocumentStatus | "")} style={{ width: 160 }}>
          <option value="">Any status</option>
          <option value="indexed">Indexed</option>
          <option value="failed">Failed</option>
          <option value="processing">Processing</option>
          <option value="uploaded">Uploaded</option>
        </Select>
        <Select className="sm" aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)} style={{ width: 160 }}>
          <option value="newest">Newest first</option>
          <option value="title">By title</option>
        </Select>
        <span className="spacer" />
        <span className="muted small">{documents.isPending ? "" : `${plural(items.length, "document")}${documents.hasNextPage ? " shown" : ""}`}</span>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th style={{ width: "40%" }}>Document</th>
              <th>Status</th>
              <th className="n">Version</th>
              <th className="n">Characters</th>
              <th className="n">Uploaded</th>
              {manageable ? <th /> : null}
            </tr>
          </thead>
          <tbody>
            {documents.isPending ? (
              [0, 1, 2].map((i) => (
                <tr key={i}>
                  <td colSpan={6}>
                    <Skeleton height={20} />
                  </td>
                </tr>
              ))
            ) : documents.isError ? (
              <tr>
                <td colSpan={6}>
                  <Empty>Could not load the documents: {describe(documents.error).message}</Empty>
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={6}>
                  <Empty>{q || status ? "No document matches." : manageable ? "Nothing here yet. Upload a page of text or Markdown." : "This library is empty."}</Empty>
                </td>
              </tr>
            ) : (
              items.map((d) => (
                <tr key={d.id}>
                  <td>
                    <Link href={`/documents/view?id=${encodeURIComponent(d.id)}`} className="name">
                      {d.title}
                    </Link>
                    {d.sourceName && d.sourceName !== d.title ? <span className="sub truncate">{d.sourceName}</span> : null}
                  </td>
                  <td>
                    <Pill tone={STATUS_TONE[d.status]}>{STATUS_WORD[d.status]}</Pill>
                    {d.status === "failed" && d.error ? <span className="sub truncate">{d.error}</span> : null}
                  </td>
                  <td className="n num">{d.version}</td>
                  <td className="n num">{count(d.charCount)}</td>
                  <td className="n">{ago(d.createdAt)}</td>
                  {manageable ? (
                    <td className="n" style={{ whiteSpace: "nowrap" }}>
                      <Button small tone="ghost" onClick={() => reindex.mutate(d.id)} disabled={reindex.isPending}>
                        Re-index
                      </Button>
                      <Button
                        small
                        tone="ghost"
                        onClick={() => {
                          if (window.confirm(`Remove "${d.title}"? Its chunks go; past citations keep their quotes.`)) removeDocument.mutate(d.id);
                        }}
                        disabled={removeDocument.isPending}
                      >
                        Remove
                      </Button>
                    </td>
                  ) : null}
                </tr>
              ))
            )}
          </tbody>
        </table>
        {documents.hasNextPage ? (
          <div className="table-foot">
            <span>{plural(items.length, "document")} shown</span>
            <Button small onClick={() => documents.fetchNextPage()} disabled={documents.isFetchingNextPage}>
              Show more
            </Button>
          </div>
        ) : null}
      </div>
      {manageable ? (
        <div style={{ marginTop: 32, paddingTop: 20, borderTop: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16 }}>
          <p className="muted">Removing the library removes its documents and their chunks. Agents that read it lose that source; past citations keep their quotes.</p>
          <Button
            tone="danger"
            onClick={() => {
              if (window.confirm(`Remove the library "${l.name}" and its ${plural(items.length, "document")}?`)) removeLibrary.mutate();
            }}
            disabled={removeLibrary.isPending}
          >
            Remove the library
          </Button>
        </div>
      ) : null}
    </div>
  );
}
