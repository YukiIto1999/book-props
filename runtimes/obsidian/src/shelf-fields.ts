import type { BookRecord, CustomField, EditionRecord } from "./book-note.ts";

export type ShelfEntry = Readonly<{ path: string; book: BookRecord }>;
export const readingLabels = {
  unread: "未読",
  reading: "読書中",
  rereading: "再読中",
  finished: "読了",
  reference: "参照用",
} as const;
type ReadingStatus = keyof typeof readingLabels;
type StandardKey =
  | "title"
  | "author"
  | "finishedOn"
  | "label"
  | "isbn"
  | "publisher"
  | "publishedOn"
  | "cover"
  | "purchasedOn"
  | "purchasedFrom";
type CustomKey = `custom:${string}`;
export type FieldKey = StandardKey | CustomKey;
export type Bounds = { key: FieldKey; from: string; through: string };
export type ShelfFilter = Readonly<{
  text: string;
  ownership: "any" | "owned" | "unowned";
  wish: "any" | "wanted" | "unwanted";
  reading: "any" | "unset" | ReadingStatus;
  tags: readonly string[];
  author?: string;
  publisher?: string;
  range?: Bounds;
  sort: FieldKey;
  descending: boolean;
}>;
export type ShopSearch = Readonly<{ name: string; url: string }>;
type RangeKind = "date" | "number";
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
const dateKeys: readonly StandardKey[] = ["finishedOn", "publishedOn", "purchasedOn"];
export const defaultColumns: readonly StandardKey[] = [
  "author",
  "label",
  "isbn",
  "publisher",
  "purchasedOn",
];
export const collator = new Intl.Collator("ja", { numeric: true, sensitivity: "base" });

export function fold(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, "");
}

export function tagKey(tag: string): string {
  return fold(tag).replace(/^#/, "");
}

export function tagName(tag: string): string {
  return tag.trim().replace(/^[#＃]/, "");
}

export function currentEditions(book: BookRecord): EditionRecord[] {
  return book.editions.filter(({ archivedAt }) => !archivedAt);
}

/** Reads a real calendar date written with `-`, `/`, or `.` separators and returns it as YYYY-MM-DD. */
export function calendarDate(value: string): string | undefined {
  const parts = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(value.normalize("NFKC").trim());
  if (!parts) return undefined;
  const day = `${parts[1]}-${parts[2].padStart(2, "0")}-${parts[3].padStart(2, "0")}`;
  const time = new Date(`${day}T00:00:00.000Z`);
  return Number.isFinite(time.getTime()) && time.toISOString().startsWith(day) ? day : undefined;
}

/** Orders a stored date by its day; a time of day after `T` or a space does not change the day. */
function dateKey(value: string | undefined): string | undefined {
  const day = value?.normalize("NFKC").trim().split(/[T ]/, 1)[0];
  return day ? calendarDate(day) : undefined;
}

/** Sums ASCII ISBN digits (`X` counts as ten) with a position-dependent weight. */
function weightedDigitSum(digits: string, weight: (index: number) => number): number {
  let sum = 0;
  for (let index = 0; index < digits.length; index += 1) {
    const digit = digits.charAt(index);
    sum += (digit === "X" ? 10 : Number(digit)) * weight(index);
  }
  return sum;
}

function isbn13(token: string): string | undefined {
  const value = token.normalize("NFKC").replace(/-/g, "").toUpperCase();
  if (/^97[89]\d{10}$/.test(value)) return value;
  if (!/^\d{9}[\dX]$/.test(value)) return undefined;
  if (weightedDigitSum(value, (index) => 10 - index) % 11 !== 0) return undefined;
  const body = `978${value.slice(0, 9)}`;
  const sum = weightedDigitSum(body, (index) => (index % 2 === 0 ? 1 : 3));
  return body + String((10 - (sum % 10)) % 10);
}

export function customValue(value: CustomField["value"]): string {
  return typeof value === "boolean" ? (value ? "はい" : "いいえ") : String(value);
}

export function matchesText(
  book: BookRecord,
  editions: readonly EditionRecord[],
  tokens: readonly string[],
): boolean {
  if (!tokens.length) return true;
  const isbns = editions.flatMap(({ isbns }) => isbns);
  const tags = (book.tags ?? []).map(tagKey);
  const fields = [
    book.title,
    ...book.authors,
    book.finishedOn,
    ...tags,
    ...(book.customFields ?? []).flatMap(({ name, value }) => [name, customValue(value)]),
    ...editions.flatMap(({ label, publisher, publishedOn, purchasedOn, purchasedFrom, cover }) => [
      label,
      publisher,
      publishedOn,
      purchasedOn,
      purchasedFrom,
      cover,
    ]),
  ]
    .filter((value): value is string => Boolean(value))
    .map(fold);
  return tokens.every((token) => {
    const isbn = isbn13(token);
    if (isbn) return isbns.includes(isbn);
    const needle = tagKey(token);
    // `#技術` names that one tag; a word without `#` still searches every field, tags included.
    if (needle && fold(token).startsWith("#")) return tags.includes(needle);
    const digits = needle.replace(/-/g, "");
    return (
      fields.some((field) => field.includes(needle)) ||
      (/^\d+$/.test(digits) && isbns.some((value) => value.includes(digits)))
    );
  });
}

export function fieldValues(
  book: BookRecord,
  editions: readonly EditionRecord[],
  key: FieldKey,
): (string | number)[] {
  if (key === "title") return [book.title];
  if (key === "author") return [...book.authors];
  if (key === "finishedOn") {
    const day = dateKey(book.finishedOn);
    return day === undefined ? [] : [day];
  }
  if (key === "isbn") return editions.flatMap(({ isbns }) => isbns);
  if (key === "publishedOn" || key === "purchasedOn") {
    return editions.flatMap((edition) => {
      const day = dateKey(edition[key]);
      return day === undefined ? [] : [day];
    });
  }
  if (key === "label" || key === "publisher" || key === "cover" || key === "purchasedFrom") {
    return editions.flatMap((edition) => (edition[key] ? [edition[key]] : []));
  }
  const field = book.customFields?.find(({ name }) => key === `custom:${name}`);
  if (!field) return [];
  if (field.kind === "date") {
    const day = dateKey(field.value);
    return day === undefined ? [] : [day];
  }
  return [typeof field.value === "number" ? field.value : customValue(field.value)];
}

export function compareValues(left: string | number, right: string | number): number {
  if (typeof left === "number") return typeof right === "number" ? left - right : -1;
  if (typeof right === "number") return 1;
  return collator.compare(left, right);
}

export function rangeIncludes(value: number | string, bounds: Bounds): boolean {
  if (typeof value === "number") {
    const from = bounds.from ? Number(bounds.from) : -Infinity;
    const through = bounds.through ? Number(bounds.through) : Infinity;
    return value >= from && value <= through;
  }
  return (!bounds.from || value >= bounds.from) && (!bounds.through || value <= bounds.through);
}

export function sortValue(
  book: BookRecord,
  key: FieldKey,
  descending: boolean,
): string | number | undefined {
  let choice: string | number | undefined;
  for (const value of fieldValues(book, currentEditions(book), key)) {
    if (
      choice === undefined ||
      (descending ? compareValues(value, choice) > 0 : compareValues(value, choice) < 0)
    )
      choice = value;
  }
  return choice;
}

/** Keeps a custom field rangeable only when every current book stores it as the same date or number kind. */
function rangeKindsOf(
  customKinds: ReadonlyMap<CustomKey, ReadonlySet<CustomField["kind"]>>,
): Map<FieldKey, RangeKind> {
  const rangeKinds = new Map<FieldKey, RangeKind>(dateKeys.map((key) => [key, "date"]));
  for (const [key, kinds] of customKinds) {
    if (kinds.size !== 1) continue;
    if (kinds.has("number")) rangeKinds.set(key, "number");
    if (kinds.has("date")) rangeKinds.set(key, "date");
  }
  return rangeKinds;
}

/** Lists the standard and custom fields the shelf can show, sort by, and limit to a range. */
export function shelfFields(entries: readonly ShelfEntry[]): ShelfFields {
  const customLabels: Record<CustomKey, string> = {};
  const customKinds = new Map<CustomKey, Set<CustomField["kind"]>>();
  for (const { book } of entries) {
    if (book.archivedAt) continue;
    for (const field of book.customFields ?? []) {
      const key = `custom:${field.name}` as const;
      customLabels[key] = field.name;
      const kinds = customKinds.get(key) ?? new Set();
      kinds.add(field.kind);
      customKinds.set(key, kinds);
    }
  }
  return { labels: { ...standardLabels, ...customLabels }, rangeKinds: rangeKindsOf(customKinds) };
}
