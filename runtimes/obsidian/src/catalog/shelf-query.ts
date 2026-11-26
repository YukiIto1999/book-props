import type {
  BookRecord,
  CustomField,
  EditionRecord,
} from "../adapters/note-format/book-record.ts";
import type {
  CatalogCore,
  FieldKey,
  OpenShelf,
  ShelfBound,
  ShelfField,
  ShelfQuery as Query,
  ShelfRecord,
  ShelfRequest,
  ShelfTag,
  ShelfView,
} from "../core/catalog-core.ts";
import { optionalField } from "../shared/optional-field.ts";
import { catalogEdition, catalogField } from "./rules.ts";

export type ShelfEntry = Readonly<{ path: string; book: BookRecord }>;
/** 本ページに書ける読書状態。 */
export type ReadingStatus = "unread" | "reading" | "rereading" | "finished" | "reference";
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
/** 本棚に並べる一冊。タグと版は、coreが決めた見せ方で並べる。 */
export type ShelfRow<T extends ShelfEntry> = Readonly<{
  entry: T;
  tags: readonly ShelfTag[];
  editions: readonly EditionRecord[];
}>;
/** 絞り込んだ本の並びと、絞り込みに指定したタグそれぞれのキー。 */
type ShelfSelection<T extends ShelfEntry> = Readonly<{
  rows: ShelfRow<T>[];
  tags: readonly string[];
}>;

/** 何も絞り込まず、書名の順に並べる本棚。 */
export const emptyFilter: ShelfFilter = {
  text: "",
  ownership: "any",
  wish: "any",
  reading: "any",
  tags: [],
  sort: "title",
  descending: false,
};

/** 本棚の文字列の並び。並べ替えの規則はcoreが持ち、ここでは日本語の文字列どうしの前後だけを決める。 */
const collator = new Intl.Collator("ja", { numeric: true, sensitivity: "base" });

/** 独自の項目の値を、本棚に表示する文字列にする。検索もこの文字列に一致させる。 */
export function customValue(value: CustomField["value"]): string {
  return typeof value === "boolean" ? (value ? "はい" : "いいえ") : String(value);
}

function shelfRecord({ path, book }: ShelfEntry): ShelfRecord {
  return {
    path,
    title: book.title,
    authors: [...book.authors],
    wanted: book.wanted,
    ...optionalField("archivedAt", book.archivedAt),
    ...optionalField("readingStatus", book.readingStatus),
    ...optionalField("finishedOn", book.finishedOn),
    tags: [...(book.tags ?? [])],
    customFields: (book.customFields ?? []).map((field) => ({
      field: catalogField(field),
      text: customValue(field.value),
    })),
    editions: book.editions.map(catalogEdition),
  };
}

/** 範囲の端を、入力した文字列と、数値として読める場合の数値で渡す。 */
function bound(text: string): ShelfBound {
  const number = Number(text);
  return { text, ...optionalField("number", Number.isNaN(number) ? undefined : number) };
}

function shelfQuery(filter: ShelfFilter): Query {
  const range = (bounds: Bounds) => ({
    key: bounds.key,
    from: bound(bounds.from),
    through: bound(bounds.through),
  });
  return {
    text: filter.text,
    ownership: filter.ownership,
    wish: filter.wish,
    reading: filter.reading,
    tags: [...filter.tags],
    ...optionalField("author", filter.author),
    ...optionalField("publisher", filter.publisher),
    ...optionalField("range", filter.range && range(filter.range)),
    sort: filter.sort,
    descending: filter.descending,
  };
}

/** 文字列ごとの日本語の並びの順位。等しく並ぶ文字列は同じ順位にする。 */
function ranks(texts: readonly string[]): Uint32Array {
  const order = texts
    .map((text, index) => ({ text, index }))
    .sort((left, right) => collator.compare(left.text, right.text));
  const ranked = new Uint32Array(texts.length);
  let rank = 0;
  let previous: string | undefined;
  for (const { text, index } of order) {
    if (previous !== undefined && collator.compare(previous, text) !== 0) rank += 1;
    ranked[index] = rank;
    previous = text;
  }
  return ranked;
}

/**
 * 開いている本棚の本をcoreに置いたまま、絞り込みと並べ替えをcoreに問い合わせる。
 * 並べ替えの規則はcoreが持つ。日本語の文字列の前後だけは、項目ごとに一度ここで順位にして渡す。
 */
export class ShelfQuery<T extends ShelfEntry> {
  /** 本棚の項目。独自の項目の名前と、範囲を指定できる項目の種類をcoreが示す。 */
  readonly fields: readonly ShelfField[];
  /** 本棚のタグ。表示名の日本語の並び。 */
  readonly tags: readonly ShelfTag[];
  private readonly shelf: OpenShelf;
  private readonly entries: readonly T[];
  private readonly views: readonly ShelfView[];
  private readonly collated = new Set<FieldKey>();

  private constructor(shelf: OpenShelf, entries: readonly T[]) {
    this.shelf = shelf;
    this.entries = entries;
    const { fields, tags, books } = shelf.overview();
    this.fields = fields;
    this.tags = tags.toSorted((left, right) => collator.compare(left.name, right.name));
    this.views = books;
  }

  static open<T extends ShelfEntry>(core: CatalogCore, entries: readonly T[]): ShelfQuery<T> {
    const request: ShelfRequest = { books: entries.map(shelfRecord) };
    return new ShelfQuery(core.openShelf(JSON.stringify(request)), entries);
  }

  private collate(key: FieldKey): void {
    if (this.collated.has(key)) return;
    this.shelf.collate(key, ranks(this.shelf.collationTexts(key)));
    this.collated.add(key);
  }

  private row(index: number): ShelfRow<T>[] {
    const entry = this.entries[index];
    const view = this.views[index];
    if (!entry || !view) return [];
    const editions = view.editions.flatMap((position) => entry.book.editions[position] ?? []);
    return [{ entry, tags: view.tags, editions }];
  }

  select(filter: ShelfFilter): ShelfSelection<T> {
    this.collate("title");
    this.collate(filter.sort);
    const { books, tags } = this.shelf.select(JSON.stringify(shelfQuery(filter)));
    return { rows: books.flatMap((index) => this.row(index)), tags };
  }

  close(): void {
    this.shelf.free();
  }
}
