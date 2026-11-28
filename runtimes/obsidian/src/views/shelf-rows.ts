import type { BookRecord, EditionRecord } from "../adapters/note-format/book-record.ts";
import { customValue, type ShelfEntry, type ShelfRow } from "../catalog/shelf-query.ts";
import type { FieldKey, ReadingStatus, ShelfTag } from "../core/catalog-core.ts";
import { chosenStatus } from "./reading-draft.ts";
import { readingChoices } from "./shelf-fields.ts";
import type { ShopSearch } from "./shop-searches.ts";

type RowActions = Readonly<{
  columns: ReadonlySet<FieldKey>;
  selectedTags: ReadonlySet<string>;
  /** まとめて読書状態を変えるために選んだ本のID。 */
  chosenBooks: ReadonlySet<string>;
  openBook: (path: string) => void;
  showAuthor: (name: string) => void;
  showPublisher: (publisher: string) => void;
  toggleTag: (tag: string, key: string) => void;
  chooseBook: (bookId: string, chosen: boolean) => void;
  setReading: (entry: ShelfEntry, status: ReadingStatus | undefined) => void;
  editReading: (entry: ShelfEntry) => void;
}>;

/**
 * 所有と購入希望の状態に続けて、本の読書状態を選ぶ欄と、読了なのに読了日がない本の読了日を入れる
 * 操作を一行に置く。読書状態はその場で保存し、読了日は変えない。
 */
function drawStates(
  row: HTMLElement,
  entry: ShelfEntry,
  editions: readonly EditionRecord[],
  actions: RowActions,
): void {
  const { book } = entry;
  const line = row.createDiv();
  const owned = editions.filter((edition) => edition.owned).length;
  const states = [owned ? `所有 ${owned}版` : "所有なし", book.wanted ? "欲しい本" : undefined];
  line.appendText(`${states.filter(Boolean).join("／")} `);
  const select = line.createEl("select", {
    cls: "dropdown",
    attr: { "aria-label": `「${book.title}」の読書状態` },
  });
  for (const [key, label] of Object.entries(readingChoices)) {
    select.createEl("option", { text: label, value: key });
  }
  select.value = book.readingStatus ?? "unset";
  select.addEventListener("change", () => actions.setReading(entry, chosenStatus(select.value)));
  if (book.readingStatus !== "finished" || book.finishedOn) return;
  line.appendText(" ");
  line
    .createEl("button", {
      text: "読了日を入れる",
      attr: { "aria-label": `「${book.title}」の読了日を入れる` },
    })
    .addEventListener("click", () => actions.editReading(entry));
}

/** 選ぶ欄と、本ページを開く書名の行。長い書名はモーダルの幅で折り返す。 */
function drawTitle(row: HTMLElement, { path, book }: ShelfEntry, actions: RowActions): void {
  const heading = row.createDiv();
  const choose = heading.createEl("input", {
    type: "checkbox",
    attr: { "aria-label": `「${book.title}」を選ぶ` },
  });
  choose.checked = actions.chosenBooks.has(book.id);
  choose.addEventListener("change", () => actions.chooseBook(book.id, choose.checked));
  heading.appendText(" ");
  heading
    .createEl("a", {
      text: book.title,
      href: "#",
      attr: { "aria-label": `「${book.title}」の本ページを開く` },
    })
    .addEventListener("click", (event) => {
      event.preventDefault();
      actions.openBook(path);
    });
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
    const role = book.authorRoles?.find((entry) => entry.name === name)?.role;
    line
      .createEl("button", {
        text: role ? `${name}（${role}）` : name,
        attr: { "aria-label": `著者「${name}」の本を表示` },
      })
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

function drawTags(
  row: HTMLElement,
  book: BookRecord,
  tags: readonly ShelfTag[],
  actions: RowActions,
): void {
  if (!tags.length) return;
  const line = row.createDiv();
  (book.tags ?? []).forEach((tag, index) => {
    const shown = tags[index];
    if (!shown) return;
    line
      .createEl("button", {
        text: `#${shown.name}`,
        attr: {
          "aria-label": `タグ「${shown.name}」で絞り込む`,
          "aria-pressed": String(actions.selectedTags.has(shown.key)),
        },
      })
      .addEventListener("click", () => actions.toggleTag(tag, shown.key));
  });
}

/** Draws one shelf book with the editions and tags the core shows, honoring the chosen columns. */
export function drawRow(
  list: HTMLElement,
  { entry, tags, editions }: ShelfRow<ShelfEntry>,
  actions: RowActions,
): void {
  const { book } = entry;
  const row = list.createEl("li");
  drawTitle(row, entry, actions);
  drawStates(row, entry, editions, actions);
  if (actions.columns.has("finishedOn") && book.finishedOn)
    row.createDiv({ text: `読了日: ${book.finishedOn}` });
  drawCustomColumns(row, book, actions.columns);
  drawAuthors(row, book, actions);
  drawEditions(row, editions, actions);
  drawTags(row, book, tags, actions);
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
