import { Modal, type App } from "obsidian";
import type { BookRecord, EditionRecord } from "./book-note.ts";
import type { Catalog } from "./catalog.ts";
import { markSelectedTags, mountFilterControls, mountTagBar } from "./shelf-controls.ts";
import {
  collator,
  compareValues,
  currentEditions,
  defaultColumns,
  fieldValues,
  fold,
  matchesText,
  rangeIncludes,
  shelfFields,
  sortValue,
  tagKey,
  tagName,
  type Bounds,
  type FieldKey,
  type ShelfEntry,
  type ShelfFilter,
  type ShopSearch,
} from "./shelf-fields.ts";
import { drawFacet, drawRow, drawShops } from "./shelf-rows.ts";

type Criteria = Readonly<{
  filter: ShelfFilter;
  tokens: readonly string[];
  tags: readonly string[];
  author?: string;
  publisher?: string;
  range?: Bounds;
}>;
type SortedEntry<T extends ShelfEntry> = Readonly<{ entry: T; value: string | number | undefined }>;

export const emptyFilter: ShelfFilter = {
  text: "",
  ownership: "any",
  wish: "any",
  reading: "any",
  tags: [],
  sort: "title",
  descending: false,
};

const bookoffSearch = "https://shopping.bookoff.co.jp/search/keyword/";

function matchesStates(
  book: BookRecord,
  editions: readonly EditionRecord[],
  filter: ShelfFilter,
): boolean {
  if (
    filter.ownership !== "any" &&
    editions.some(({ owned }) => owned) !== (filter.ownership === "owned")
  )
    return false;
  if (filter.wish !== "any" && book.wanted !== (filter.wish === "wanted")) return false;
  return filter.reading === "unset"
    ? book.readingStatus === undefined
    : filter.reading === "any" || book.readingStatus === filter.reading;
}

function matchesFacets(
  book: BookRecord,
  editions: readonly EditionRecord[],
  { tags, author, publisher, range }: Criteria,
): boolean {
  if (tags.length) {
    const own = new Set((book.tags ?? []).map(tagKey));
    if (!tags.every((tag) => own.has(tag))) return false;
  }
  if (author !== undefined && !book.authors.some((name) => fold(name) === author)) return false;
  if (
    publisher !== undefined &&
    !editions.some(
      (edition) => edition.publisher !== undefined && fold(edition.publisher) === publisher,
    )
  )
    return false;
  return (
    !range || fieldValues(book, editions, range.key).some((value) => rangeIncludes(value, range))
  );
}

function matchesCriteria(book: BookRecord, criteria: Criteria): boolean {
  if (book.archivedAt) return false;
  const editions = currentEditions(book);
  return (
    matchesStates(book, editions, criteria.filter) &&
    matchesFacets(book, editions, criteria) &&
    matchesText(book, editions, criteria.tokens)
  );
}

function compareSorted<T extends ShelfEntry>(
  left: SortedEntry<T>,
  right: SortedEntry<T>,
  descending: boolean,
): number {
  if (left.value !== right.value) {
    if (left.value === undefined) return 1;
    if (right.value === undefined) return -1;
    const order = compareValues(left.value, right.value);
    if (order) return descending ? -order : order;
  }
  const byTitle = collator.compare(left.entry.book.title, right.entry.book.title);
  if (byTitle) return byTitle;
  if (left.entry.path === right.entry.path) return 0;
  return left.entry.path < right.entry.path ? -1 : 1;
}

export function selectBooks<T extends ShelfEntry>(entries: readonly T[], filter: ShelfFilter): T[] {
  const criteria: Criteria = {
    filter,
    tokens: filter.text.normalize("NFKC").split(/\s+/).filter(Boolean),
    tags: filter.tags.map(tagKey),
    author: filter.author === undefined ? undefined : fold(filter.author),
    publisher: filter.publisher === undefined ? undefined : fold(filter.publisher),
    range: filter.range?.from || filter.range?.through ? filter.range : undefined,
  };
  const keyed = entries
    .filter(({ book }) => matchesCriteria(book, criteria))
    .map((entry) => ({ entry, value: sortValue(entry.book, filter.sort, filter.descending) }));
  keyed.sort((left, right) => compareSorted(left, right, filter.descending));
  return keyed.map(({ entry }) => entry);
}

export function shelfTags(entries: readonly ShelfEntry[]): string[] {
  const tags = new Map<string, string>();
  for (const { book } of entries) {
    if (book.archivedAt) continue;
    for (const tag of book.tags ?? []) {
      const key = tagKey(tag);
      if (key && !tags.has(key)) tags.set(key, tagName(tag));
    }
  }
  return [...tags.values()].sort(collator.compare);
}

function searchUrl(base: string, parameter: string, query: string): string {
  const url = new URL(base);
  url.searchParams.set(parameter, query);
  return url.href;
}

export function shopSearches(text: string): ShopSearch[] {
  const query = text.trim().replace(/\s+/g, " ");
  if (!query) return [];
  const searches: ShopSearch[] = [
    { name: "Amazon", url: searchUrl("https://www.amazon.co.jp/s", "k", query) },
    { name: "楽天ブックス", url: searchUrl("https://books.rakuten.co.jp/search", "sitem", query) },
    {
      name: "バリューブックス",
      url: searchUrl("https://www.valuebooks.jp/search", "keyword", query),
    },
  ];
  const bookoff = new URL(bookoffSearch + encodeURIComponent(query)).href;
  if (
    bookoff.startsWith(bookoffSearch) &&
    decodeURIComponent(bookoff.slice(bookoffSearch.length)) === query
  )
    searches.push({ name: "BOOKOFF", url: bookoff });
  return searches;
}

export class Shelf extends Modal {
  private readonly catalog: Catalog;
  private filter: ShelfFilter = emptyFilter;

  constructor(app: App, catalog: Catalog) {
    super(app);
    this.catalog = catalog;
  }

  async onOpen(): Promise<void> {
    this.setTitle("本棚");
    const loading = this.contentEl.createEl("p", { text: "読み込み中…", attr: { role: "status" } });
    const snapshot = await this.catalog.shelf().catch(() => undefined);
    if (loading.parentElement !== this.contentEl) return;
    if (!snapshot) {
      loading.setText("本棚を読み取れませんでした。書籍フォルダと記録を確認してください。");
      return;
    }
    if (snapshot.moving)
      loading.setText("未確定の版の移動があります。「本・版を管理」から確認してください。");
    else loading.remove();
    this.mount(snapshot.entries);
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private toggledTags(tag: string): string[] {
    const key = tagKey(tag);
    const selected = this.filter.tags.some((chosen) => tagKey(chosen) === key);
    return selected
      ? this.filter.tags.filter((chosen) => tagKey(chosen) !== key)
      : [...this.filter.tags, tag];
  }

  private mount(entries: readonly ShelfEntry[]): void {
    const { contentEl } = this;
    const columns = new Set<FieldKey>(defaultColumns);
    const update = (patch: Partial<ShelfFilter>): void => {
      this.filter = { ...this.filter, ...patch };
      render();
    };
    mountFilterControls(contentEl, {
      filter: this.filter,
      fields: shelfFields(entries),
      columns,
      update,
      redraw: () => render(),
    });
    const toggleTag = (tag: string): void => update({ tags: this.toggledTags(tag) });
    const tagButtons = mountTagBar(contentEl, shelfTags(entries), toggleTag);
    const facets = contentEl.createDiv();
    const count = contentEl.createEl("p", { attr: { role: "status" } });
    const list = contentEl.createEl("ul");
    const shops = contentEl.createDiv();
    const focusFacet = (): void => {
      facets.querySelector("button")?.focus();
    };
    const rowActions = {
      columns,
      openBook: (path: string): void => {
        void this.app.workspace.openLinkText(path, "", false);
        this.close();
      },
      showAuthor: (author: string): void => {
        update({ author });
        focusFacet();
      },
      showPublisher: (publisher: string): void => {
        update({ publisher });
        focusFacet();
      },
      toggleTag: (tag: string): void => {
        toggleTag(tag);
        tagButtons.get(tagKey(tag))?.focus();
      },
    };
    const render = (): void => {
      const filter = this.filter;
      const selectedTags = new Set(filter.tags.map(tagKey));
      markSelectedTags(tagButtons, selectedTags);
      facets.empty();
      if (filter.author !== undefined)
        drawFacet(facets, "著者", filter.author, () => update({ author: undefined }));
      if (filter.publisher !== undefined)
        drawFacet(facets, "出版社", filter.publisher, () => update({ publisher: undefined }));
      const matches = selectBooks(entries, filter);
      count.setText(`${matches.length}冊`);
      list.empty();
      for (const entry of matches) drawRow(list, entry, { ...rowActions, selectedTags });
      drawShops(shops, filter.text, shopSearches(filter.text));
    };
    render();
  }
}
