import type { BookRecord, CustomField } from "./book-note.ts";
import type { FieldKey, RangeKind, ShelfField } from "./wasm.ts";

export type { FieldKey } from "./wasm.ts";
export type ShelfEntry = Readonly<{ path: string; book: BookRecord }>;
export const readingLabels = {
  unread: "未読",
  reading: "読書中",
  rereading: "再読中",
  finished: "読了",
  reference: "参照用",
} as const;
type ReadingStatus = keyof typeof readingLabels;
type StandardKey = Exclude<FieldKey, `custom:${string}`>;
export type Bounds = { key: FieldKey; from: string; through: string };
/** 著者・出版社・範囲の絞り込みは、変更で`undefined`を書いて解除する。 */
export type ShelfFilter = Readonly<{
  text: string;
  ownership: "any" | "owned" | "unowned";
  wish: "any" | "wanted" | "unwanted";
  reading: "any" | "unset" | ReadingStatus;
  tags: readonly string[];
  author?: string | undefined;
  publisher?: string | undefined;
  range?: Bounds | undefined;
  sort: FieldKey;
  descending: boolean;
}>;
export type ShopSearch = Readonly<{ name: string; url: string }>;
export type ShelfFields = Readonly<{
  labels: Readonly<Record<FieldKey, string>>;
  rangeKinds: ReadonlyMap<FieldKey, RangeKind>;
}>;

const standardLabels: Record<StandardKey, string> = {
  title: "書名",
  author: "著者",
  finishedOn: "読了日",
  label: "版",
  isbn: "ISBN",
  publisher: "出版社",
  publishedOn: "出版日",
  cover: "表紙",
  purchasedOn: "購入日",
  purchasedFrom: "購入元",
};
export const defaultColumns: readonly StandardKey[] = [
  "author",
  "label",
  "isbn",
  "publisher",
  "purchasedOn",
];
/** 本棚の文字列の並び。並べ替えの規則はcoreが持ち、ここでは日本語の文字列どうしの前後だけを決める。 */
export const collator = new Intl.Collator("ja", { numeric: true, sensitivity: "base" });

/** 独自の項目の値を、本棚に表示する文字列にする。検索もこの文字列に一致させる。 */
export function customValue(value: CustomField["value"]): string {
  return typeof value === "boolean" ? (value ? "はい" : "いいえ") : String(value);
}

/** coreが示す本棚の項目に表示名を付け、範囲を指定できる項目をまとめる。 */
export function shelfFields(fields: readonly ShelfField[]): ShelfFields {
  const labels: Record<FieldKey, string> = { ...standardLabels };
  const rangeKinds = new Map<FieldKey, RangeKind>();
  for (const { key, name, range } of fields) {
    if (name !== undefined) labels[key] = name;
    if (range !== undefined) rangeKinds.set(key, range);
  }
  return { labels, rangeKinds };
}
