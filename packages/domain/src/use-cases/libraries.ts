import type { Actor, Chunk, Document, Library, ShareRequest } from "../entities.js";
import type { Page } from "../cursor.js";
import type { Deps, DocumentFilter, DocumentSummary, LibraryFilter, LibraryRow, Ports } from "../ports.js";
import { forbidden, invalid, notFound, ok, type Result } from "../result.js";
import { canAdmin, canManageLibrary, canReadLibrary } from "../access.js";
import { auditRecorder } from "./audit.js";

/*
 * Libraries and the documents in them, without the ingestion (session 3 brings upload, replace
 * and re-index through the document state machine). A library starts private; its slug is made
 * from its name and kept unique in the workspace. Reading follows `canReadLibrary`; a thing the
 * actor may not read answers "not found", so a colleague's private library cannot be probed.
 */

export const NAME_MAX = 80;
export const DESCRIPTION_MAX = 500;

export interface LibraryInput {
  name: string;
  description: string;
}

export const slugify = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "untitled";

export function cleanName(name: string): Result<string> {
  const trimmed = name.trim();
  if (trimmed.length === 0) return invalid("a name is needed");
  if (trimmed.length > NAME_MAX) return invalid(`the name must be at most ${NAME_MAX} characters`);
  return ok(trimmed);
}

/** `handbook`, then `handbook-2`, `handbook-3`: the first slug nobody in the workspace has. */
export async function freshSlug(taken: (slug: string) => Promise<boolean>, name: string): Promise<string> {
  const base = slugify(name);
  for (let n = 1; ; n++) {
    const slug = n === 1 ? base : `${base}-${n}`;
    if (!(await taken(slug))) return slug;
  }
}

export function librariesUseCasesCreator(deps: Deps) {
  const { ports, unitOfWork, clock, ids } = deps;
  const audit = auditRecorder(deps);

  async function readable(actor: Actor, libraryId: string, on: Ports = ports): Promise<Result<Library>> {
    const library = await on.libraries.findById(libraryId);
    if (!library || !canReadLibrary(actor, library)) return notFound("library");
    return ok(library);
  }

  async function manageable(actor: Actor, libraryId: string): Promise<Result<Library>> {
    const found = await readable(actor, libraryId);
    if (!found.ok) return found;
    if (!canManageLibrary(actor, found.value)) return forbidden("only the owner or an admin changes a library");
    return found;
  }

  const libraries = {
    async list(actor: Actor, filter: Omit<LibraryFilter, "userId">): Promise<Result<Page<LibraryRow>>> {
      if (filter.scope === "all" && !canAdmin(actor, actor.workspaceId)) return forbidden("only an admin lists every library");
      return ok(await ports.libraries.list(actor.workspaceId, { ...filter, userId: actor.userId }));
    },

    async get(actor: Actor, libraryId: string): Promise<Result<{ library: Library; ownerName: string; pendingShare: ShareRequest | null }>> {
      const found = await readable(actor, libraryId);
      if (!found.ok) return found;
      const owner = await ports.users.findById(found.value.ownerId);
      const pendingShare = await ports.shareRequests.findPending("library", libraryId);
      return ok({ library: found.value, ownerName: owner?.name ?? "", pendingShare });
    },

    async create(actor: Actor, input: LibraryInput): Promise<Result<Library>> {
      const name = cleanName(input.name);
      if (!name.ok) return name;
      if (input.description.length > DESCRIPTION_MAX) return invalid(`the description must be at most ${DESCRIPTION_MAX} characters`);
      const now = clock.now();
      const slug = await freshSlug(async (s) => (await ports.libraries.findBySlug(actor.workspaceId, s)) !== null, name.value);
      const library: Library = { id: ids.id("lib"), workspaceId: actor.workspaceId, ownerId: actor.userId, slug, name: name.value, description: input.description.trim(), visibility: "private", createdAt: now, updatedAt: now };
      await unitOfWork.run(async (on) => {
        await on.libraries.insert(library);
        await audit(on, { workspaceId: actor.workspaceId, actorId: actor.userId, action: "library.created", entityKind: "library", entityId: library.id, after: { name: library.name } });
      });
      return ok(library);
    },

    async update(actor: Actor, libraryId: string, input: { name?: string | undefined; description?: string | undefined }): Promise<Result<Library>> {
      const found = await manageable(actor, libraryId);
      if (!found.ok) return found;
      const library = found.value;
      const name = input.name === undefined ? ok(library.name) : cleanName(input.name);
      if (!name.ok) return name;
      const description = input.description === undefined ? library.description : input.description.trim();
      if (description.length > DESCRIPTION_MAX) return invalid(`the description must be at most ${DESCRIPTION_MAX} characters`);
      const updated: Library = { ...library, name: name.value, description, updatedAt: clock.now() };
      await unitOfWork.run(async (on) => {
        await on.libraries.update(updated);
        await audit(on, {
          workspaceId: actor.workspaceId, actorId: actor.userId, action: "library.updated", entityKind: "library", entityId: library.id,
          before: { name: library.name, description: library.description }, after: { name: updated.name, description: updated.description },
        });
      });
      return ok(updated);
    },

    async remove(actor: Actor, libraryId: string): Promise<Result<void>> {
      const found = await manageable(actor, libraryId);
      if (!found.ok) return found;
      const library = found.value;
      await unitOfWork.run(async (on) => {
        await on.libraries.delete(library.id);
        await audit(on, { workspaceId: actor.workspaceId, actorId: actor.userId, action: "library.removed", entityKind: "library", entityId: library.id, before: { name: library.name, visibility: library.visibility } });
      });
      return ok(undefined);
    },
  };

  const documents = {
    async list(actor: Actor, libraryId: string, filter: DocumentFilter): Promise<Result<Page<DocumentSummary>>> {
      const found = await readable(actor, libraryId);
      if (!found.ok) return found;
      return ok(await ports.documents.list(libraryId, filter));
    },

    async get(actor: Actor, documentId: string): Promise<Result<{ document: Document; library: Library; chunks: Chunk[] }>> {
      const document = await ports.documents.findById(documentId);
      if (!document) return notFound("document");
      const found = await readable(actor, document.libraryId);
      if (!found.ok) return notFound("document");
      return ok({ document, library: found.value, chunks: await ports.chunks.listByDocument(documentId) });
    },

    async remove(actor: Actor, documentId: string): Promise<Result<void>> {
      const document = await ports.documents.findById(documentId);
      if (!document) return notFound("document");
      const found = await readable(actor, document.libraryId);
      if (!found.ok) return notFound("document");
      if (!canManageLibrary(actor, found.value)) return forbidden("only the library's owner or an admin removes a document");
      await unitOfWork.run(async (on) => {
        await on.documents.delete(document.id);
        await audit(on, { workspaceId: actor.workspaceId, actorId: actor.userId, action: "document.removed", entityKind: "document", entityId: document.id, before: { title: document.title, libraryId: document.libraryId } });
      });
      return ok(undefined);
    },
  };

  return { libraries, documents, readable };
}
