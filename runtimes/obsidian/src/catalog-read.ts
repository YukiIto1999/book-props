import { BookNoteError } from "./book-note-error.ts";
import { readScopedNote, type BookRecord } from "./book-note.ts";
import { assertUnchanged, CatalogChanged, Refuse } from "./catalog-purchase.ts";
import type { BookFiles, Result, StoredBook } from "./catalog.ts";

class UnreadableNote extends Error {
  readonly path: string;

  constructor(path: string, reason: string) {
    super(reason);
    this.path = path;
  }
}

export function readEntry(path: string, raw: string): BookRecord | undefined {
  try {
    return readScopedNote(raw);
  } catch (error: unknown) {
    if (error instanceof BookNoteError) throw new UnreadableNote(path, error.message);
    throw error;
  }
}

export function readFailure(error: unknown): Extract<Result, { kind: "unreadable" }> | undefined {
  if (error instanceof UnreadableNote)
    return { kind: "unreadable", path: error.path, reason: error.message };
  return undefined;
}

export async function readEntries(
  files: Pick<BookFiles, "read">,
  paths: Iterable<string>,
): Promise<StoredBook[]> {
  const sorted = [...paths].sort();
  const ids = new Set<string>();
  const books: StoredBook[] = [];
  for (const path of sorted) {
    const book = readEntry(path, await files.read(path));
    if (!book) continue;
    if (ids.has(book.id)) throw new Refuse("unavailable");
    ids.add(book.id);
    books.push({ path, book });
  }
  return books;
}

/**
 * 一時点のファイル一覧に基づく読み取り
 * @typeParam T - 一覧全体を読み取った結果の型
 * @param files - 同じ書籍範囲の更新情報を返すファイル群
 * @param read - 一度の試行で同じ一覧だけを読む処理
 * @returns 一覧が読取中に変わらなかった試行の値と更新情報
 */
export async function readStable<T>(
  files: Pick<BookFiles, "versions">,
  read: (versions: ReadonlyMap<string, string>) => Promise<T>,
): Promise<{ value: T; versions: ReadonlyMap<string, string> }> {
  const attempt = async () => {
    const versions = files.versions();
    let value: T;
    try {
      value = await read(versions);
    } catch (error: unknown) {
      assertUnchanged(versions, files.versions());
      throw error;
    }
    assertUnchanged(versions, files.versions());
    return { value, versions };
  };
  try {
    return await attempt();
  } catch (error: unknown) {
    if (!(error instanceof CatalogChanged)) throw error;
    return attempt();
  }
}

export function readCatalog(files: Pick<BookFiles, "versions" | "read">) {
  return readStable(files, (versions) => readEntries(files, versions.keys()));
}
