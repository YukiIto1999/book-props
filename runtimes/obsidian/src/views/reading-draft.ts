import type { BookRecord } from "../adapters/note-format/book-record.ts";
import type { ManagementResult } from "../catalog/management.ts";
import type { Reading, ReadingStatus } from "../core/catalog-core.ts";
import { optionalField } from "../shared/optional-field.ts";
import { actionMessage } from "./management-ui.ts";
import { isOptionKey } from "./option-keys.ts";
import { readingChoices, readingLabels } from "./shelf-fields.ts";

/** 一冊の読書状態を保存したときの知らせ。 */
export const readingMessage: Record<ManagementResult, string> = {
  saved: "読書状態を保存しました。",
  conflict:
    "表示した後に、この本の読書状態か読了日が変わったか、本がアーカイブされました。確かめてからやり直してください。",
  unavailable: actionMessage.unavailable,
  pending:
    "版の移動が終わっていないか、保存を確かめられません。「本・版を管理」で確かめてください。",
};

/** 変えなかった本の数を、理由ごとに伝える文。 */
const skipped: Record<Exclude<ManagementResult, "saved">, (count: number) => string> = {
  conflict: (count) => `${count}冊は、表示した後に変わっていたため変えていません。`,
  unavailable: (count) => `${count}冊は、編集中か最新の記録を確認できないため変えていません。`,
  pending: (count) =>
    `${count}冊は、版の移動が終わっていないか、保存を確かめられませんでした。「本・版を管理」で確かめてください。`,
};

/** 選んだ値から読書状態を取り出す。`unset`は読書状態なし。 */
export function chosenStatus(key: string): ReadingStatus | undefined {
  return isOptionKey(readingLabels, key) ? key : undefined;
}

/**
 * 読書状態を変えた結果を、一つの知らせにする。
 * @param outcomes - 本ごとの保存の結果
 * @param status - 付けた読書状態。`undefined`なら未設定に戻した
 */
export function readingNotice(
  outcomes: readonly ManagementResult[],
  status: ReadingStatus | undefined,
): string {
  const label = status ? readingLabels[status] : readingChoices.unset;
  const count = (kind: ManagementResult) => outcomes.filter((outcome) => outcome === kind).length;
  const saved = count("saved");
  const lines = saved ? [`${saved}冊の読書状態を「${label}」にしました。`] : [];
  for (const kind of ["conflict", "unavailable", "pending"] as const) {
    const missed = count(kind);
    if (missed) lines.push(skipped[kind](missed));
  }
  return lines.join("");
}

/** この端末の暦での日付を`YYYY-MM-DD`で返す。 */
export function localDate(now: Date): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/** 保存する読書状態と読了日か、日付として読めなかった読了日の入力。 */
type DraftValue =
  | Readonly<{ kind: "value"; value: Reading }>
  | Readonly<{ kind: "invalidDate"; text: string }>;

/**
 * 一冊の読書状態と読了日の入力。読了にしたときに読了日が空なら今日の日付を案として入れ、読了を
 * やめたら案を取り下げる。利用者が読了日を書き換えない限り、本ページにある読了日はそのまま残す。
 */
export class ReadingDraft {
  status: ReadingStatus | undefined;
  /** 入力欄の読了日。`edited`が偽の間は、本ページの読了日を書き換えない。 */
  private readonly day: { text: string | undefined; edited: boolean };
  /** 今日の日付を案として入れる前に、読了日を書き換えるつもりだったか。案を入れていなければ`undefined`。 */
  private proposal: { edited: boolean } | undefined;
  private readonly book: BookRecord;
  private readonly today: string;

  constructor(book: BookRecord, today: string) {
    this.book = book;
    this.today = today;
    this.status = book.readingStatus;
    this.day = { text: book.finishedOn, edited: false };
  }

  /**
   * 読書状態を選ぶ。
   * @returns 読了日の欄に示し直す値。欄を変えなければ`undefined`
   */
  choose(status: ReadingStatus | undefined): string | undefined {
    this.status = status;
    if (status === "finished" && !this.day.text) {
      const proposal = { edited: this.day.edited };
      this.fillToday();
      this.proposal = proposal;
      return this.today;
    }
    if (status === "finished" || !this.proposal) return undefined;
    Object.assign(this.day, { text: undefined, edited: this.proposal.edited });
    this.proposal = undefined;
    return "";
  }

  /** 利用者が読了日の欄に書いた値を受け取る。空なら読了日を消す。 */
  type(text: string): void {
    Object.assign(this.day, { text: text.trim() || undefined, edited: true });
    this.proposal = undefined;
  }

  /** 読了日を今日にする。欄に示す値を返す。 */
  fillToday(): string {
    Object.assign(this.day, { text: this.today, edited: true });
    this.proposal = undefined;
    return this.today;
  }

  /**
   * 保存する値。書き換えた読了日は、実在する日付として`YYYY-MM-DD`にそろえる。
   * @param calendarDate - 人が書いた日付を`YYYY-MM-DD`にする、coreの日付の規則
   */
  value(calendarDate: (text: string) => string | undefined): DraftValue {
    const { text, edited } = this.day;
    const entered = text === undefined ? undefined : calendarDate(text);
    if (edited && text !== undefined && entered === undefined) return { kind: "invalidDate", text };
    const finishedOn = edited ? entered : this.book.finishedOn;
    return {
      kind: "value",
      value: {
        ...optionalField("status", this.status),
        ...optionalField("finishedOn", finishedOn),
      },
    };
  }
}
