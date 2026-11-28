import type { FieldKey, RangeKind, ReadingStatus, ShelfField } from "../core/catalog-core.ts";

type StandardKey = Exclude<FieldKey, `custom:${string}`>;
export type ShelfFields = Readonly<{
  labels: Readonly<Record<FieldKey, string>>;
  rangeKinds: ReadonlyMap<FieldKey, RangeKind>;
}>;

export const readingLabels: Record<ReadingStatus, string> = {
  unread: "未読",
  reading: "読書中",
  rereading: "再読中",
  finished: "読了",
  reference: "参照用",
};
/** 読書状態を付ける選択肢。`unset`は読書状態を外して未設定に戻す。 */
export const readingChoices: Readonly<Record<ReadingStatus | "unset", string>> = {
  unset: "未設定",
  ...readingLabels,
};

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
