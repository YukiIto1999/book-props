import type { EditionRecord } from "../adapters/note-format/book-record.ts";
import { change, type BookContext, type Scope } from "./book-change.ts";
import type { StoredBook } from "./catalog.ts";
import type { ManagementResult } from "./management.ts";
import type { MoveCopy } from "./ports.ts";
import { assertUnchanged, CatalogChanged } from "./purchase.ts";
import { readEntry } from "./read.ts";
import { catalogEdition } from "./rules.ts";

/** Vaultの外に控えた版のうち、どの本にもないもの。`restoreTo`は戻してよい本で、移動元、移動先の順。 */
export type MissingCopy = MoveCopy &
  Readonly<{ edition: EditionRecord; restoreTo: readonly string[] }>;

/** Vaultの外に控えた版のうち、どの本にも、どの移動記録にもないもの。戻し先はcoreが決める。 */
export async function missingMoveCopies(
  { files, notes, rules }: BookContext,
  entries: readonly StoredBook[],
): Promise<MissingCopy[]> {
  const saved = await files.moveCopies.list();
  const missing = rules.missing(
    entries,
    saved.map(({ editionId }) => editionId),
  );
  const lost = saved.filter((_, index) => missing[index] === true);
  const targets = rules.restoreTargets(entries, lost);
  return lost.map((copy, index) => ({
    ...copy,
    edition: notes.readEditionBackup(copy.snapshot).edition,
    restoreTo: targets[index] ?? [],
  }));
}

/** 移動が終わるまで、移動中の版を本棚に一度だけ見せる。見せ方はcoreが決める。 */
export function settledShelf(
  { notes, rules }: BookContext,
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
    if (view.backup && backup) editions.push(notes.readEditionBackup(backup).edition);
    return { path, book: { ...book, editions } };
  });
  return { entries, moving };
}

/** Vaultの外に控えた版を、その移動の移動元か移動先へ戻す。 */
export async function restoreMoveCopy(
  { context, source, entries, versions }: Scope,
  editionId: string,
): Promise<ManagementResult> {
  const { notes } = context;
  const copy = (await context.files.moveCopies.list()).find((item) => item.editionId === editionId);
  const captured = copy && notes.readEditionBackup(copy.snapshot);
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
      const restored = notes.insertTransferredEdition(raw, captured);
      writing = true;
      return restored;
    });
    const raw = await context.files.read(path);
    return readEntry(notes, path, raw)?.id === source.book.id &&
      notes.captureEdition(raw, editionId)?.signature === captured.signature
      ? "saved"
      : "pending";
  } catch (error: unknown) {
    if (writing) return "pending";
    if (error instanceof CatalogChanged) return "conflict";
    throw error;
  }
}
