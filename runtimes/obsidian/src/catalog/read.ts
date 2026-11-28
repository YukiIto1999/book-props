import type { BookRecord } from "../adapters/note-format/book-record.ts";
import { BookNoteError } from "../adapters/note-format/error.ts";
import type { NoteFormat } from "../adapters/note-format/note-format.ts";
import type { Result, StoredBook } from "./catalog.ts";
import type { BookFiles } from "./ports.ts";
import { assertUnchanged, CatalogChanged, Refuse } from "./purchase.ts";

/** 書籍の保存範囲の本ページと、それを読む本ページの書式。 */
type NoteSource = Readonly<{ files: Pick<BookFiles, "versions" | "read">; notes: NoteFormat }>;
/** 一覧が読み取りの間に変わらなかった試行の値と、その一覧の更新情報。 */
export type StableRead<T> = Readonly<{ value: T; versions: ReadonlyMap<string, string> }>;

class UnreadableNote extends Error {
  readonly path: string;

  constructor(path: string, reason: string) {
    super(reason);
    this.path = path;
  }
}

export function readEntry(notes: NoteFormat, path: string, raw: string): BookRecord | undefined {
  try {
    return notes.readScoped(raw);
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
  { files, notes }: NoteSource,
  paths: Iterable<string>,
  signal?: AbortSignal,
): Promise<StoredBook[]> {
  const sorted = [...paths].sort();
  const ids = new Set<string>();
  const books: StoredBook[] = [];
  for (const path of sorted) {
    signal?.throwIfAborted();
    const book = readEntry(notes, path, await files.read(path));
    signal?.throwIfAborted();
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
): Promise<StableRead<T>> {
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

export function readCatalog(source: NoteSource, signal?: AbortSignal) {
  return readStable(source.files, (versions) => readEntries(source, versions.keys(), signal));
}
