import type { Actor, Chunk, Document, Library } from "../entities.js";
import type { Deps, Ports } from "../ports.js";
import { fail, forbidden, invalid, notFound, ok, type Result } from "../result.js";
import { documentTransitions, move } from "../transitions.js";
import { canManageLibrary, canReadLibrary } from "../access.js";
import { chunkText } from "../text/chunk.js";
import { auditRecorder } from "./audit.js";
import { cleanName } from "./libraries.js";

/*
 * The ingestion: a document goes in as text, is chunked and indexed, and from then on can be
 * retrieved. It walks the document state machine (uploaded → processing → indexed | failed, and
 * back to processing on a replace or a re-index), and each step writes an audit row, all inside
 * one unit of work so a document is never left half-indexed. Replacing the text bumps the
 * version; citations made against the old text keep their quote and the version they quoted.
 */

export const TEXT_MAX = 400_000;

export interface UploadInput {
  libraryId: string;
  title: string;
  text: string;
  sourceName?: string | undefined;
}

export interface ReplaceInput {
  text: string;
  title?: string | undefined;
}

export interface Ingested {
  document: Document;
  chunks: Chunk[];
}

const utf8Bytes = (text: string): number => new TextEncoder().encode(text).length;
const looksLikeMarkdown = (text: string, sourceName: string): boolean => sourceName.toLowerCase().endsWith(".md") || /^#{1,6}[ \t]+\S/mu.test(text);

function checkText(text: string): Result<string> {
  if (text.trim().length === 0) return invalid("the document has no text");
  if (text.length > TEXT_MAX) return invalid(`the document must be at most ${TEXT_MAX} characters`);
  return ok(text);
}

export function ingestionUseCasesCreator(deps: Deps) {
  const { ports, unitOfWork, clock, ids } = deps;
  const audit = auditRecorder(deps);

  /** The library the actor may change, or why not: not found when they may not even read it. */
  async function manageable(actor: Actor, libraryId: string): Promise<Result<Library>> {
    const library = await ports.libraries.findById(libraryId);
    if (!library || !canReadLibrary(actor, library)) return notFound("library");
    if (!canManageLibrary(actor, library)) return forbidden("only the library's owner or an admin changes its documents");
    return ok(library);
  }

  async function ownDocument(actor: Actor, documentId: string): Promise<Result<Document>> {
    const document = await ports.documents.findById(documentId);
    if (!document) return notFound("document");
    const library = await manageable(actor, document.libraryId);
    if (!library.ok) return library.error.code === "not_found" ? notFound("document") : library;
    return ok(document);
  }

  /** processing → indexed (or failed), chunks rewritten, audited; through the ports of the unit of work. */
  async function index(on: Ports, actor: Actor, document: Document): Promise<Ingested> {
    const processing = move(documentTransitions, "document", document.status, "processing");
    if (!processing.ok) throw new Error(processing.error.message);
    const now = clock.now();
    const working: Document = { ...document, status: "processing", error: null };
    await on.documents.update(working);
    await audit(on, { workspaceId: actor.workspaceId, actorId: actor.userId, action: "document.processing", entityKind: "document", entityId: document.id, before: { status: document.status }, after: { status: "processing" } });
    try {
      const chunks: Chunk[] = chunkText(document.body).map((c) => ({
        id: ids.id("chk"), documentId: document.id, ordinal: c.ordinal, headingPath: c.headingPath, headingText: c.headingPath.join(" > "), startChar: c.start, endChar: c.end, tokenCount: c.tokens, body: c.body,
      }));
      if (chunks.length === 0) throw new Error("the text has no words to index");
      await on.chunks.replaceForDocument(document.id, chunks);
      const indexed: Document = { ...working, status: "indexed", indexedAt: now };
      await on.documents.update(indexed);
      await audit(on, { workspaceId: actor.workspaceId, actorId: actor.userId, action: "document.indexed", entityKind: "document", entityId: document.id, before: { status: "processing" }, after: { status: "indexed", chunks: chunks.length } });
      return { document: indexed, chunks };
    } catch (e) {
      const failed: Document = { ...working, status: "failed", error: e instanceof Error ? e.message : String(e) };
      await on.chunks.replaceForDocument(document.id, []);
      await on.documents.update(failed);
      await audit(on, { workspaceId: actor.workspaceId, actorId: actor.userId, action: "document.failed", entityKind: "document", entityId: document.id, before: { status: "processing" }, after: { status: "failed", error: failed.error } });
      return { document: failed, chunks: [] };
    }
  }

  return {
    async upload(actor: Actor, input: UploadInput): Promise<Result<Ingested>> {
      const library = await manageable(actor, input.libraryId);
      if (!library.ok) return library;
      const workspace = await ports.workspaces.findById(actor.workspaceId);
      if (!workspace?.tools.uploads) return fail("rule", "document upload is switched off in this workspace", "tool_off");
      const title = cleanName(input.title);
      if (!title.ok) return title;
      const text = checkText(input.text);
      if (!text.ok) return text;
      const sourceName = input.sourceName?.trim() || `${title.value}.${looksLikeMarkdown(text.value, "") ? "md" : "txt"}`;
      const now = clock.now();
      const document: Document = {
        id: ids.id("doc"), libraryId: library.value.id, title: title.value, sourceName, mime: looksLikeMarkdown(text.value, sourceName) ? "text/markdown" : "text/plain",
        byteSize: utf8Bytes(text.value), charCount: text.value.length, body: text.value, status: "uploaded", error: null, version: 1, uploadedBy: actor.userId, createdAt: now, indexedAt: null,
      };
      return ok(
        await unitOfWork.run(async (on) => {
          await on.documents.insert(document);
          await audit(on, { workspaceId: actor.workspaceId, actorId: actor.userId, action: "document.uploaded", entityKind: "document", entityId: document.id, after: { title: document.title, libraryId: document.libraryId, version: 1 } });
          await on.libraries.update({ ...library.value, updatedAt: now });
          return index(on, actor, document);
        }),
      );
    },

    async replace(actor: Actor, documentId: string, input: ReplaceInput): Promise<Result<Ingested>> {
      const found = await ownDocument(actor, documentId);
      if (!found.ok) return found;
      const document = found.value;
      const text = checkText(input.text);
      if (!text.ok) return text;
      const title = input.title === undefined ? ok(document.title) : cleanName(input.title);
      if (!title.ok) return title;
      const replaced: Document = { ...document, title: title.value, body: text.value, byteSize: utf8Bytes(text.value), charCount: text.value.length, version: document.version + 1, mime: looksLikeMarkdown(text.value, document.sourceName) ? "text/markdown" : "text/plain" };
      return ok(
        await unitOfWork.run(async (on) => {
          await on.documents.update(replaced);
          await audit(on, { workspaceId: actor.workspaceId, actorId: actor.userId, action: "document.replaced", entityKind: "document", entityId: document.id, before: { version: document.version, title: document.title }, after: { version: replaced.version, title: replaced.title } });
          return index(on, actor, replaced);
        }),
      );
    },

    async reindex(actor: Actor, documentId: string): Promise<Result<Ingested>> {
      const found = await ownDocument(actor, documentId);
      if (!found.ok) return found;
      if (found.value.status === "processing") return fail("conflict", "the document is being indexed", "forbidden_transition");
      return ok(await unitOfWork.run((on) => index(on, actor, found.value)));
    },
  };
}
