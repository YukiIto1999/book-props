import { change, editionCollision, hasEdition, Stop, type Scope } from "./book-change.ts";
import { captureEdition, insertTransferredEdition } from "./book-note.ts";
import { readEditionBackup } from "./book-note-parse.ts";
import { assertUnchanged, CatalogChanged } from "./catalog-purchase.ts";
import { readCatalog, readEntry } from "./catalog-read.ts";
import type { StoredBook } from "./catalog.ts";
import type { ManagementResult } from "./book-management.ts";

export type MoveCopy = Readonly<{
  editionId: string;
  sourceId: string;
  destinationId: string;
  snapshot: string;
}>;

export interface MoveCopies {
  keep(copy: MoveCopy): Promise<void>;
  list(): Promise<readonly MoveCopy[]>;
}

export async function missingMoveCopies(copies: MoveCopies, entries: readonly StoredBook[]) {
  const present = new Set<string>();
  for (const { book } of entries) {
    for (const { id } of book.editions) present.add(id);
    if (book.pendingMove) present.add(book.pendingMove.editionId);
  }
  return (await copies.list()).filter(({ editionId }) => !present.has(editionId));
}

export async function restoreMoveCopy(
  { context, source }: Scope,
  editionId: string,
): Promise<ManagementResult> {
  const copy = (await context.files.moveCopies.list()).find((item) => item.editionId === editionId);
  if (!copy || (source.book.id !== copy.sourceId && source.book.id !== copy.destinationId))
    return "conflict";
  const captured = readEditionBackup(copy.snapshot);
  const { edition } = captured;
  if (edition.id !== editionId || edition.archivedAt) return "conflict";
  const { value: entries, versions } = await readCatalog(context.files);
  const blocksRestore = (book: StoredBook["book"]) =>
    book.pendingMove || hasEdition(book, editionId) || editionCollision(book, edition);
  if (entries.some(({ book }) => blocksRestore(book))) return "conflict";
  const target = entries.find(({ book }) => book.id === source.book.id);
  if (!target || target.book.archivedAt) return "conflict";
  let writing = false;
  try {
    const path = await change(context, target, (raw, book) => {
      assertUnchanged(versions, context.files.versions());
      if (book.archivedAt || blocksRestore(book)) throw new Stop("conflict");
      const restored = insertTransferredEdition(raw, captured);
      writing = true;
      return restored;
    });
    const raw = await context.files.read(path);
    return readEntry(path, raw)?.id === target.book.id &&
      captureEdition(raw, editionId)?.signature === captured.signature
      ? "saved"
      : "pending";
  } catch (error: unknown) {
    if (writing) return "pending";
    if (error instanceof CatalogChanged) return "conflict";
    throw error;
  }
}
