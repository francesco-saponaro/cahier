"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DocumentStatus } from "@cahier/domain";
import { describe } from "../../api/errors";
import { useTRPC, useTRPCClient } from "../../api/trpc";
import { useSession } from "../../auth/SessionProvider";
import { count, plural, when } from "../../lib/format";
import { Button, Empty, Pill, Skeleton } from "../../ui/primitives";
import { DocumentForm } from "../libraries/DocumentForm";
import { segmentsOf, type Span } from "./segments";

/*
 * The page a citation opens: the document's text with the cited span highlighted and, in the
 * margin, where each chunk starts and under which heading. The question here is "is this quote
 * really on the page, and in what context?", so the page is the biggest thing and the span is
 * the one coloured mark on it.
 */

export const STATUS_TONE: Record<DocumentStatus, "neutral" | "pos" | "neg" | "warn"> = { uploaded: "neutral", processing: "warn", indexed: "pos", failed: "neg" };
export const STATUS_WORD: Record<DocumentStatus, string> = { uploaded: "Uploaded", processing: "Processing", indexed: "Indexed", failed: "Failed" };

function spanFrom(params: URLSearchParams): Span | null {
  const from = Number(params.get("from"));
  const to = Number(params.get("to"));
  return Number.isInteger(from) && Number.isInteger(to) && to > from ? { from, to } : null;
}

export function ViewerScreen() {
  const params = useSearchParams();
  const id = params.get("id") ?? "";
  const cited = useMemo(() => spanFrom(params), [params]);
  const citedVersion = params.get("v") ? Number(params.get("v")) : null;
  const trpc = useTRPC();
  const client = useTRPCClient();
  const queryClient = useQueryClient();
  const router = useRouter();
  const { session } = useSession();
  const query = useQuery({ ...trpc.documents.get.queryOptions({ id }), enabled: Boolean(id) });
  const [picked, setPicked] = useState<Span | null>(null);
  const [replacing, setReplacing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const markRef = useRef<HTMLElement>(null);
  const span = picked ?? cited;

  const document = query.data?.document;
  const chunks = query.data?.chunks ?? [];
  const library = query.data?.library;
  const manageable = Boolean(library && session && (library.ownerId === session.user.id || session.role === "admin"));
  const segments = useMemo(() => (document ? segmentsOf(document.body, chunks, span) : []), [document, chunks, span]);
  const versionMoved = document && citedVersion !== null && citedVersion !== document.version;

  useEffect(() => {
    markRef.current?.scrollIntoView({ block: "center" });
  }, [segments]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: trpc.documents.pathKey() });
    void queryClient.invalidateQueries({ queryKey: trpc.libraries.pathKey() });
  };
  const reindex = useMutation({ mutationFn: () => client.documents.reindex.mutate({ id }), onSuccess: refresh, onError: (e) => setError(describe(e).message) });
  const remove = useMutation({
    mutationFn: () => client.documents.remove.mutate({ id }),
    onSuccess: () => {
      refresh();
      router.push(`/libraries/view?id=${encodeURIComponent(library?.id ?? "")}`);
    },
    onError: (e) => setError(describe(e).message),
  });

  if (!id) return <Empty>No document named. Open one from a citation or a library.</Empty>;
  if (query.isPending) {
    return (
      <div className="page">
        <Skeleton width={320} height={28} />
        <div style={{ marginTop: 20 }}>
          <Skeleton height={400} />
        </div>
      </div>
    );
  }
  if (query.isError || !document || !library) {
    return (
      <div className="page">
        <div className="title-row">
          <h1>Document not found</h1>
        </div>
        <Empty>
          It was removed, or it is in a library you cannot read. <Link href="/libraries" className="link">Your libraries</Link>
        </Empty>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="title-row">
        <div style={{ minWidth: 0 }}>
          <h1>{document.title}</h1>
          <p className="sub">
            <Link href={`/libraries/view?id=${encodeURIComponent(library.id)}`} className="link">
              {library.name}
            </Link>{" "}
            · version {document.version} · {plural(document.charCount, "character")} · {plural(chunks.length, "chunk")}
            {document.indexedAt ? ` · indexed ${when(document.indexedAt)}` : ""}
          </p>
        </div>
        <div className="actions">
          <Pill tone={STATUS_TONE[document.status]}>{STATUS_WORD[document.status]}</Pill>
          {manageable ? (
            <>
              <Button small onClick={() => setReplacing((r) => !r)}>
                Replace
              </Button>
              <Button small onClick={() => reindex.mutate()} disabled={reindex.isPending}>
                Re-index
              </Button>
              <Button
                small
                tone="danger"
                onClick={() => {
                  if (window.confirm(`Remove "${document.title}"? Its chunks go; past citations keep their quotes.`)) remove.mutate();
                }}
                disabled={remove.isPending}
              >
                Remove
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
      {document.status === "failed" && document.error ? (
        <p className="alert" style={{ marginBottom: 12 }}>
          Indexing failed: {document.error}
        </p>
      ) : null}
      {versionMoved ? (
        <p className="notice" style={{ marginBottom: 12 }}>
          This citation quoted version {citedVersion}; the document is now version {document.version}, so the highlighted characters may no longer be the quoted ones.
        </p>
      ) : null}
      {replacing ? (
        <div className="panel" style={{ marginBottom: 12 }}>
          <header>
            <h2>Replace the text</h2>
            <span className="muted small">Becomes version {document.version + 1}; past citations keep their quotes.</span>
          </header>
          <DocumentForm
            mode="replace"
            initialTitle={document.title}
            onCancel={() => setReplacing(false)}
            onSubmit={async (values) => {
              try {
                await client.documents.replace.mutate({ id, text: values.text, title: values.title });
                setReplacing(false);
                refresh();
                return null;
              } catch (e) {
                return describe(e).message;
              }
            }}
          />
        </div>
      ) : null}
      <div className="viewer">
        <nav className="margin" aria-label="Chunks">
          <h3>{chunks.length === 0 ? "No chunks" : `${plural(chunks.length, "chunk")} · ${count(chunks.reduce((n, c) => n + c.tokenCount, 0))} tokens`}</h3>
          <ol>
            {chunks.map((c) => {
              const current = span !== null && c.startChar <= span.from && span.to <= c.endChar;
              return (
                <li key={c.id}>
                  <a
                    href={`#chunk-${c.ordinal}`}
                    aria-current={current ? "true" : undefined}
                    onClick={(e) => {
                      e.preventDefault();
                      setPicked({ from: c.startChar, to: c.endChar });
                    }}
                  >
                    <span className="num">
                      {c.ordinal + 1} · {c.tokenCount} tokens
                    </span>
                    <span className="path">{c.headingPath.length ? c.headingPath.join(" › ") : "(no heading)"}</span>
                  </a>
                </li>
              );
            })}
          </ol>
        </nav>
        <div className="page-text" lang="en">
          {document.body.length === 0 ? (
            <span className="muted">The document is empty.</span>
          ) : (
            segments.map((s) => {
              const firstHighlighted = s.highlighted && (span === null || s.start === span.from);
              const content = s.highlighted ? (
                <mark key={s.start} ref={firstHighlighted ? markRef : undefined}>
                  {s.text}
                </mark>
              ) : (
                s.text
              );
              return s.chunkStarts.length > 0 ? (
                <span key={s.start} id={`chunk-${s.chunkStarts[0]}`} className="chunk-start" data-ordinal={s.chunkStarts.map((o) => o + 1).join(",")}>
                  {content}
                </span>
              ) : (
                <span key={s.start}>{content}</span>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
