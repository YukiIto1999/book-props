import type { BookRecord, EditionRecord } from "./book-note.ts";
import { isOptionKey } from "./option-keys.ts";
import {
  currentEditions,
  customValue,
  readingLabels,
  tagKey,
  tagName,
  type FieldKey,
  type ShelfEntry,
  type ShopSearch,
} from "./shelf-fields.ts";

type RowActions = Readonly<{
  columns: ReadonlySet<FieldKey>;
  selectedTags: ReadonlySet<string>;
  openBook: (path: string) => void;
  showAuthor: (name: string) => void;
  showPublisher: (publisher: string) => void;
  toggleTag: (tag: string) => void;
}>;

function readingLabel(status: string | undefined): string | undefined {
  if (!status) return undefined;
  return isOptionKey(readingLabels, status) ? readingLabels[status] : status;
}

function drawHeading(
  row: HTMLElement,
  { path, book }: ShelfEntry,
  editions: readonly EditionRecord[],
  actions: RowActions,
): void {
  const heading = row.createDiv();
  heading
    .createEl("button", {
      text: book.title,
      attr: { "aria-label": `「${book.title}」の本ページを開く` },
    })
    .addEventListener("click", () => actions.openBook(path));
  const owned = editions.filter((edition) => edition.owned).length;
  const states = [
    owned ? `所有 ${owned}版` : "所有なし",
    book.wanted ? "欲しい本" : undefined,
    readingLabel(book.readingStatus),
  ];
  heading.appendText(` ${states.filter(Boolean).join("／")}`);
}

function drawCustomColumns(
  row: HTMLElement,
  book: BookRecord,
  columns: ReadonlySet<FieldKey>,
): void {
  for (const { name, value } of book.customFields ?? []) {
    if (columns.has(`custom:${name}`)) row.createDiv({ text: `${name}: ${customValue(value)}` });
  }
}

function drawAuthors(row: HTMLElement, book: BookRecord, actions: RowActions): void {
  if (!actions.columns.has("author") || !book.authors.length) return;
  const line = row.createDiv({ text: "著者: " });
  for (const name of book.authors) {
    line
      .createEl("button", { text: name, attr: { "aria-label": `著者「${name}」の本を表示` } })
      .addEventListener("click", () => actions.showAuthor(name));
  }
}

function editionSummary(edition: EditionRecord, columns: ReadonlySet<FieldKey>): string {
  return [
    columns.has("label") ? (edition.label ?? "版の表記なし") : undefined,
    edition.owned ? "所有" : "未所有",
    columns.has("isbn") && edition.isbns.length ? `ISBN ${edition.isbns.join("、")}` : undefined,
    columns.has("publishedOn") && edition.publishedOn && `出版日 ${edition.publishedOn}`,
    columns.has("purchasedOn") && edition.purchasedOn && `購入日 ${edition.purchasedOn}`,
    columns.has("purchasedFrom") && edition.purchasedFrom && `購入元 ${edition.purchasedFrom}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

function drawEdition(
  item: HTMLElement,
  edition: EditionRecord,
  { columns, showPublisher }: RowActions,
): void {
  item.appendText(editionSummary(edition, columns));
  if (columns.has("cover") && edition.cover) item.appendText(` · 表紙: ${edition.cover}`);
  const publisher = edition.publisher;
  if (!columns.has("publisher") || publisher === undefined) return;
  item.appendText(" · 出版社: ");
  item
    .createEl("button", {
      text: publisher,
      attr: { "aria-label": `出版社「${publisher}」の版を含む本を表示` },
    })
    .addEventListener("click", () => showPublisher(publisher));
}

function drawEditions(
  row: HTMLElement,
  editions: readonly EditionRecord[],
  actions: RowActions,
): void {
  if (!editions.length) return;
  const items = row.createEl("ul");
  for (const edition of editions) drawEdition(items.createEl("li"), edition, actions);
}

function drawTags(row: HTMLElement, book: BookRecord, actions: RowActions): void {
  if (!book.tags?.length) return;
  const line = row.createDiv();
  for (const tag of book.tags) {
    const name = tagName(tag);
    line
      .createEl("button", {
        text: `#${name}`,
        attr: {
          "aria-label": `タグ「${name}」で絞り込む`,
          "aria-pressed": String(actions.selectedTags.has(tagKey(tag))),
        },
      })
      .addEventListener("click", () => actions.toggleTag(tag));
  }
}

/** Draws one shelf book with its current editions, honoring the chosen columns. */
export function drawRow(list: HTMLElement, entry: ShelfEntry, actions: RowActions): void {
  const { book } = entry;
  const editions = currentEditions(book);
  const row = list.createEl("li");
  drawHeading(row, entry, editions, actions);
  if (actions.columns.has("finishedOn") && book.finishedOn)
    row.createDiv({ text: `読了日: ${book.finishedOn}` });
  drawCustomColumns(row, book, actions.columns);
  drawAuthors(row, book, actions);
  drawEditions(row, editions, actions);
  drawTags(row, book, actions);
}

export function drawFacet(
  facets: HTMLElement,
  label: string,
  value: string,
  clear: () => void,
): void {
  const item = facets.createDiv();
  item.createSpan({ text: `${label}: ${value} ` });
  item
    .createEl("button", {
      text: "解除",
      attr: { "aria-label": `${label}「${value}」の絞り込みを解除` },
    })
    .addEventListener("click", clear);
}

export function drawShops(shops: HTMLElement, text: string, searches: readonly ShopSearch[]): void {
  shops.empty();
  if (!searches.length) {
    shops.createEl("p", { text: "検索語を入れると、登録していない本を書店で探せます。" });
    return;
  }
  const line = shops.createEl("p", { text: `登録していない本を書店で「${text.trim()}」と探す: ` });
  searches.forEach(({ name, url }, index) => {
    if (index) line.appendText("、");
    line.createEl("a", {
      text: name,
      cls: "external-link",
      attr: { href: url, target: "_blank", rel: "noopener noreferrer" },
    });
  });
}
