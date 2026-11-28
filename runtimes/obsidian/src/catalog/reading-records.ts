import type { BookRecord } from "../adapters/note-format/book-record.ts";
import { readingOf } from "../adapters/note-format/reading.ts";
import type { Reading, ReadingStatus } from "../core/catalog-core.ts";
import { optionalField } from "../shared/optional-field.ts";
import type { BookContext, Serial } from "./book-change.ts";
import { manageRead, readBooks, type ManagementResult } from "./management.ts";

/** 本棚や本ページで見た本と、その本に付ける読書状態と読了日。 */
export type ReadingChange = Readonly<{ book: BookRecord; value: Reading }>;

/** 読書状態だけを変える。読了日は、ほかの状態に変えても未設定に戻しても、そのまま残す。 */
export function statusChange(book: BookRecord, status: ReadingStatus | undefined): ReadingChange {
  return {
    book,
    value: { ...optionalField("status", status), ...optionalField("finishedOn", book.finishedOn) },
  };
}

/**
 * 本の読書状態と読了日の記録。利用者が見た値を基準に、変える部分がその後に変わっていない本だけを
 * 書く。購入希望、版、本文は変えない。
 */
export class ReadingRecords {
  private readonly context: BookContext;
  private readonly serial: Serial;

  constructor(context: BookContext, serial: Serial) {
    this.context = context;
    this.serial = serial;
  }

  /**
   * 本ごとに読書状態と読了日を書き、本ごとの結果を同じ順に返す。本の一覧は一度だけ読み、書く直前に
   * 本ページごとに読み直す。書けない本があっても、残りの本は続ける。
   */
  set(changes: readonly ReadingChange[]): Promise<ManagementResult[]> {
    return this.serial(() => this.write(changes));
  }

  private async write(changes: readonly ReadingChange[]): Promise<ManagementResult[]> {
    const books = await readBooks(this.context);
    if (typeof books === "string") return changes.map(() => books);
    const outcomes: ManagementResult[] = [];
    for (const { book, value } of changes) {
      const baseline = readingOf(book);
      const command = { action: "setReading", bookId: book.id, baseline, value } as const;
      outcomes.push(await manageRead(this.context, books, command));
    }
    return outcomes;
  }
}
