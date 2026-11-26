import { change, type Scope } from "./book-change.ts";
import type { ManagementResult } from "./book-management.ts";
import { captureEdition, insertTransferredEdition } from "./book-note.ts";
import { readEditionBackup } from "./book-note-parse.ts";
import { catalogEdition, type CatalogRules } from "./catalog-core.ts";
import { assertUnchanged, CatalogChanged } from "./catalog-purchase.ts";
import { readEntry } from "./catalog-read.ts";
import type { StoredBook } from "./catalog.ts";

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

/** Vaultの外に控えた版のうち、どの本にも、どの移動記録にもないもの。 */
export async function missingMoveCopies(
  rules: CatalogRules,
  copies: MoveCopies,
  entries: readonly StoredBook[],
): Promise<MoveCopy[]> {
  const saved = await copies.list();
  const missing = rules.missing(
    entries,
    saved.map(({ editionId }) => editionId),
  );
  return saved.filter((_, index) => missing[index] === true);
}

/** 移動が終わるまで、移動中の版を本棚に一度だけ見せる。見せ方はcoreが決める。 */
export function settledShelf(
  rules: CatalogRules,
  books: StoredBook[],
): { entries: StoredBook[]; moving: boolean } {
  const { moving, books: changed } = rules.settle(books);
  if (!changed.length) return { entries: books, moving };
  const views = new Map(changed.map((view) => [view.id, view]));
  const entries = books.map(({ path, book }) => {
    const view = views.get(book.id);
    if (!view) return { path, book };
    const editions = book.editions.filter(({ id }) => !view.hidden.includes(id));
    const backup = book.pendingMove?.backup;
    if (view.backup && backup) editions.push(readEditionBackup(backup).edition);
    return { path, book: { ...book, editions } };
  });
  return { entries, moving };
}

/** Vaultの外に控えた版を、その移動の移動元か移動先へ戻す。 */
export async function restoreMoveCopy(
  { context, source, entries, versions }: Scope,
  editionId: string,
): Promise<ManagementResult> {
  const copy = (await context.files.moveCopies.list()).find((item) => item.editionId === editionId);
  const captured = copy && readEditionBackup(copy.snapshot);
  const saved = copy &&
    captured && {
      sourceId: copy.sourceId,
      destinationId: copy.destinationId,
      edition: catalogEdition(captured.edition),
    };
  const command = { action: "restoreMoveCopy", bookId: source.book.id, editionId } as const;
  const plan = context.rules.manage(command, entries, saved);
  if (plan.kind === "pending") return "pending";
  if (plan.kind !== "write" || !captured) return "conflict";
  let writing = false;
  try {
    const path = await change(context, source, plan.step, (raw) => {
      assertUnchanged(versions, context.files.versions());
      const restored = insertTransferredEdition(raw, captured);
      writing = true;
      return restored;
    });
    const raw = await context.files.read(path);
    return readEntry(path, raw)?.id === source.book.id &&
      captureEdition(raw, editionId)?.signature === captured.signature
      ? "saved"
      : "pending";
  } catch (error: unknown) {
    if (writing) return "pending";
    if (error instanceof CatalogChanged) return "conflict";
    throw error;
  }
}
