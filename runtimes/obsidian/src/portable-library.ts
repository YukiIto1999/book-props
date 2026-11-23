import { BookNoteError } from "./book-note-error.ts";
import { readBookNote, removeExpiredPurchases } from "./book-note.ts";
import { isJsonObject } from "./json-object.ts";

const portableFormat = "book-props-vault";
const portableVersion = 1;

/** 一冊分の本ページ。取り込み先では `bookId` だけでファイル名を決め、出力元のパスを持ち込まない。 */
export type PortableNote = Readonly<{ bookId: string; markdown: string }>;

type PortableLibrary = Readonly<{
  format: typeof portableFormat;
  version: typeof portableVersion;
  notes: readonly PortableNote[];
}>;

export class PortableLibraryError extends Error {
  readonly code:
    | "invalid-format"
    | "unsupported-version"
    | "invalid-note"
    | "duplicate-id"
    | "inconsistent-id";

  constructor(code: PortableLibraryError["code"], detail: string, options?: ErrorOptions) {
    super(detail, options);
    this.name = "PortableLibraryError";
    this.code = code;
  }
}

function invalid(detail: string): never {
  throw new PortableLibraryError("invalid-format", detail);
}

function record(
  value: unknown,
  keys: readonly string[],
  field: string,
): Readonly<Record<string, unknown>> {
  if (!isJsonObject(value)) return invalid(`${field} はJSONのオブジェクトで指定してください。`);
  const actual = Object.keys(value);
  if (actual.length !== keys.length || !keys.every((key) => Object.hasOwn(value, key))) {
    return invalid(`${field} の項目は ${keys.join("、")} だけにしてください。`);
  }
  return value;
}

function asNote<T>(position: number, read: () => T): T {
  try {
    return read();
  } catch (error) {
    if (!(error instanceof BookNoteError)) throw error;
    throw new PortableLibraryError(
      "invalid-note",
      `${position + 1}件目は読み取れる本ページではありません: ${error.message}`,
      { cause: error },
    );
  }
}

/** 書籍の保存範囲の中で本・版のIDが重ならないことを確かめ、出力にも取り込みにも同じ条件を課す。 */
class Collector {
  private readonly books = new Set<string>();
  private readonly editions = new Set<string>();
  readonly notes: PortableNote[] = [];

  add(markdown: string, position: number, expectedId?: string): void {
    const { book } = asNote(position, () => readBookNote(markdown));
    if (expectedId !== undefined && expectedId !== book.id) {
      throw new PortableLibraryError(
        "inconsistent-id",
        `${position + 1}件目の bookId が本ページの本IDと一致しません。`,
      );
    }
    if (book.appliedPurchases.length) {
      throw new PortableLibraryError(
        "invalid-note",
        `${position + 1}件目に購入の再確認記録が含まれています。`,
      );
    }
    if (this.books.has(book.id))
      throw new PortableLibraryError(
        "duplicate-id",
        `本ID ${book.id} が複数の本ページにあります。`,
      );
    this.books.add(book.id);
    for (const { id } of book.editions) {
      if (this.editions.has(id))
        throw new PortableLibraryError("duplicate-id", `版ID ${id} が複数の本ページにあります。`);
      this.editions.add(id);
    }
    this.notes.push({ bookId: book.id, markdown });
  }
}

/**
 * 書籍の保存範囲にある本ページの全文から、Vaultに依存しないJSONを作る。
 * 購入の再確認記録だけを取り除き、プロパティ、タグ、改行、本文はそのまま残す。
 */
export function encodePortableLibrary(raws: readonly string[]): string {
  const collector = new Collector();
  raws.forEach((raw, position) => {
    collector.add(
      asNote(position, () => removeExpiredPurchases(raw, Infinity)),
      position,
    );
  });
  const library: PortableLibrary = {
    format: portableFormat,
    version: portableVersion,
    notes: collector.notes.toSorted((left, right) =>
      left.bookId < right.bookId ? -1 : left.bookId > right.bookId ? 1 : 0,
    ),
  };
  return `${JSON.stringify(library, null, 2)}\n`;
}

/**
 * JSONを検証し、本が一冊もない書籍の保存範囲へ `bookId` ごとに作成できる本ページを返す。
 * `bookId` は本ページ内の本IDと一致したものだけを返すため、ファイル名に使ってもパスを制御されない。
 */
export function decodePortableLibrary(json: string): readonly PortableNote[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new PortableLibraryError("invalid-format", "JSONとして読み取れません。", {
      cause: error,
    });
  }
  const library = record(parsed, ["format", "version", "notes"], "入出力の記録");
  if (library.format !== portableFormat)
    return invalid(`format は ${portableFormat} で指定してください。`);
  if (typeof library.version !== "number" || !Number.isInteger(library.version))
    return invalid("version は整数で指定してください。");
  if (library.version !== portableVersion) {
    throw new PortableLibraryError(
      "unsupported-version",
      `未対応の入出力の版です: ${library.version}`,
    );
  }
  if (!Array.isArray(library.notes)) return invalid("notes はJSONの配列で指定してください。");
  const collector = new Collector();
  library.notes.forEach((entry: unknown, position) => {
    const note = record(entry, ["bookId", "markdown"], `${position + 1}件目`);
    if (typeof note.bookId !== "string" || typeof note.markdown !== "string") {
      return invalid(`${position + 1}件目の bookId と markdown は文字列で指定してください。`);
    }
    collector.add(note.markdown, position, note.bookId);
  });
  return collector.notes;
}
