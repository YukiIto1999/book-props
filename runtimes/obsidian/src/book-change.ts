import { readScopedNote, type BookRecord, type EditionRecord } from "./book-note.ts";
import type { BookFiles, StoredBook } from "./catalog.ts";

/** 書籍の保存範囲の本ページを読み書きする手段と、操作を受け付けているか。 */
export type BookContext = Readonly<{
  files: BookFiles;
  entries: () => Promise<StoredBook[]>;
  active: () => boolean;
}>;
/** 一つの管理操作で読んだ本。版の移動を書き始めた後の失敗は、保留として返す。 */
export type Scope = Readonly<{
  context: BookContext;
  source: StoredBook;
  entries: readonly StoredBook[];
  progress: { moveStarted: boolean };
}>;

export class Stop extends Error {
  readonly reason: "conflict" | "unavailable";

  constructor(reason: Stop["reason"]) {
    super(reason);
    this.reason = reason;
  }
}

/** 本ページの最新の内容が同じ本で、利用者が編集中でなければ書き換える。 */
export async function change(
  context: BookContext,
  entry: StoredBook,
  update: (raw: string, book: BookRecord) => string,
): Promise<string> {
  return context.files.process(entry.path, (raw, currentPath) => {
    if (!context.active() || !context.files.canUpdate(currentPath, raw))
      throw new Stop("unavailable");
    const latest = readScopedNote(raw);
    if (latest?.id !== entry.book.id) throw new Stop("conflict");
    return update(raw, latest);
  });
}

export function hasEdition(book: BookRecord, editionId: string): boolean {
  return book.editions.some(({ id }) => id === editionId);
}

/** 別の本が同じ版IDを持っているか。 */
export function heldElsewhere(
  entries: readonly StoredBook[],
  source: StoredBook,
  editionId: string,
): boolean {
  return entries.some(({ book }) => book.id !== source.book.id && hasEdition(book, editionId));
}

/** 本の別の版が、指定した版のISBNを一つでも持っているか。 */
export function editionCollision(book: BookRecord, edition: EditionRecord): boolean {
  return book.editions.some(
    ({ id, isbns }) => id !== edition.id && isbns.some((isbn) => edition.isbns.includes(isbn)),
  );
}
