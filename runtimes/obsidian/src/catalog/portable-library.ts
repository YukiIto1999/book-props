import { BookNoteError } from "../adapters/note-format/error.ts";
import type { NoteFormat } from "../adapters/note-format/note-format.ts";
import type {
  CatalogCore,
  NoteFacts,
  PortableExport,
  PortableNote,
  PortableNotes,
  PortableProblem,
} from "../core/catalog-core.ts";
import { optionalField } from "../shared/optional-field.ts";

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

/** 本ページを読んだ結果。coreに渡す事実と、読めたときの本ページか、読めなかった理由。 */
type Reading = Readonly<{ facts: NoteFacts; note?: PortableNote; error?: BookNoteError }>;

function readNote(notes: NoteFormat, read: () => string, declaredId?: string): Reading {
  try {
    const markdown = read();
    const { book } = notes.read(markdown);
    return {
      facts: {
        kind: "readable",
        ...optionalField("declaredId", declaredId),
        bookId: book.id,
        editionIds: book.editions.map(({ id }) => id),
        purchases: book.appliedPurchases.length > 0,
      },
      note: { bookId: book.id, markdown },
    };
  } catch (error) {
    if (!(error instanceof BookNoteError)) throw error;
    return { facts: { kind: "unreadable" }, error };
  }
}

function place(position: number | undefined): string {
  return position === undefined ? "入出力の記録" : `${position + 1}件目`;
}

function invalidFormat(detail: string): PortableLibraryError {
  return new PortableLibraryError("invalid-format", detail);
}

function failure(problem: PortableProblem, readings: readonly Reading[]): PortableLibraryError {
  switch (problem.kind) {
    case "notJson":
      return invalidFormat("JSONとして読み取れません。");
    case "notObject":
      return invalidFormat(`${place(problem.position)} はJSONのオブジェクトで指定してください。`);
    case "unexpectedKeys":
      return invalidFormat(
        `${place(problem.position)} の項目は ${problem.keys.join("、")} だけにしてください。`,
      );
    case "wrongFormat":
      return invalidFormat(`format は ${problem.format} で指定してください。`);
    case "versionNotInteger":
      return invalidFormat("version は整数で指定してください。");
    case "unsupportedVersion":
      return new PortableLibraryError(
        "unsupported-version",
        `未対応の入出力の版です: ${problem.version}`,
      );
    case "notesNotArray":
      return invalidFormat("notes はJSONの配列で指定してください。");
    case "noteNotText":
      return invalidFormat(
        `${place(problem.position)}の bookId と markdown は文字列で指定してください。`,
      );
    case "unreadableNote": {
      const cause = readings[problem.position]?.error;
      return new PortableLibraryError(
        "invalid-note",
        `${place(problem.position)}は読み取れる本ページではありません: ${cause?.message}`,
        { cause },
      );
    }
    case "carriesPurchases":
      return new PortableLibraryError(
        "invalid-note",
        `${place(problem.position)}に購入の再確認記録が含まれています。`,
      );
    case "inconsistentId":
      return new PortableLibraryError(
        "inconsistent-id",
        `${place(problem.position)}の bookId が本ページの本IDと一致しません。`,
      );
    case "duplicateBook":
      return new PortableLibraryError(
        "duplicate-id",
        `本ID ${problem.id} が複数の本ページにあります。`,
      );
    case "duplicateEdition":
      return new PortableLibraryError(
        "duplicate-id",
        `版ID ${problem.id} が複数の本ページにあります。`,
      );
  }
}

/**
 * 書籍の保存範囲の本ページと、Vaultに依存しない入出力のJSONとを行き来させる。
 * JSONの形、一緒に運べる本ページの条件、本ページの並びはcoreが決め、ここでは本ページを読み書きする。
 */
export class PortableLibrary {
  private readonly core: CatalogCore;
  private readonly notes: NoteFormat;

  constructor(core: CatalogCore, notes: NoteFormat) {
    this.core = core;
    this.notes = notes;
  }

  /** 本・版のIDが重ならず、購入の再確認記録のない本ページだけを一緒に運ぶ。 */
  private check(readings: readonly Reading[]): readonly PortableNote[] {
    const request: PortableNotes = { notes: readings.map(({ facts }) => facts) };
    const { problem } = this.core.checkPortableNotes(JSON.stringify(request));
    if (problem) throw failure(problem, readings);
    return readings.flatMap(({ note }) => note ?? []);
  }

  /**
   * 書籍の保存範囲にある本ページの全文から、Vaultに依存しないJSONを作る。
   * 購入の再確認記録だけを取り除き、プロパティ、タグ、改行、本文はそのまま残す。
   */
  encode(raws: readonly string[]): string {
    const { notes } = this;
    const readings = raws.map((raw) =>
      readNote(notes, () => notes.removePurchases(raw, (purchases) => purchases.map(() => true))),
    );
    const request: PortableExport = { notes: [...this.check(readings)] };
    return this.core.encodePortableLibrary(JSON.stringify(request));
  }

  /**
   * JSONを検証し、本が一冊もない書籍の保存範囲へ `bookId` ごとに作成できる本ページを返す。
   * `bookId` は本ページ内の本IDと一致したものだけを返すため、ファイル名に使ってもパスを制御されない。
   */
  decode(json: string): readonly PortableNote[] {
    const { notes, problem } = this.core.decodePortableLibrary(json);
    const readings = notes.map(({ bookId, markdown }) =>
      readNote(this.notes, () => markdown, bookId),
    );
    const checked = this.check(readings);
    if (problem) throw failure(problem, readings);
    return checked;
  }
}
