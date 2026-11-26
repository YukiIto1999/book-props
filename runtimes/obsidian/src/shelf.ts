import { Modal, type App } from "obsidian";
import type { Catalog, StoredBook } from "./catalog.ts";
import { markSelectedTags, mountFilterControls, mountTagBar } from "./shelf-controls.ts";
import {
  defaultColumns,
  type FieldKey,
  type ShelfFilter,
  type ShopSearch,
} from "./shelf-fields.ts";
import { ShelfQuery } from "./shelf-query.ts";
import { drawFacet, drawRow, drawShops } from "./shelf-rows.ts";
import type { CatalogCore } from "./wasm.ts";

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
  private readonly core: CatalogCore;
  private filter: ShelfFilter = emptyFilter;
  /** 絞り込みのタグそれぞれのキー。最後の絞り込みでcoreが示したもの。 */
  private selectedKeys: readonly string[] = [];
  private query: ShelfQuery<StoredBook> | undefined;

  constructor(app: App, catalog: Catalog, core: CatalogCore) {
    super(app);
    this.catalog = catalog;
    this.core = core;
  }

  override async onOpen(): Promise<void> {
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
    this.query = ShelfQuery.open(this.core, snapshot.entries);
    this.mount(this.query);
  }

  override onClose(): void {
    this.query?.close();
    this.query = undefined;
    this.contentEl.empty();
  }

  private toggledTags(tag: string, key: string): string[] {
    const keys = this.selectedKeys;
    return keys.includes(key)
      ? this.filter.tags.filter((_, index) => keys[index] !== key)
      : [...this.filter.tags, tag];
  }

  private mount(shelf: ShelfQuery<StoredBook>): void {
    const { contentEl } = this;
    const columns = new Set<FieldKey>(defaultColumns);
    const update = (patch: Partial<ShelfFilter>): void => {
      this.filter = { ...this.filter, ...patch };
      render();
    };
    mountFilterControls(contentEl, {
      filter: this.filter,
      fields: shelf.fields,
      columns,
      update,
      redraw: () => render(),
    });
    const toggleTag = (tag: string, key: string): void =>
      update({ tags: this.toggledTags(tag, key) });
    const tagButtons = mountTagBar(contentEl, shelf.tags, toggleTag);
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
      toggleTag: (tag: string, key: string): void => {
        toggleTag(tag, key);
        tagButtons.get(key)?.focus();
      },
    };
    const render = (): void => {
      const filter = this.filter;
      const { rows, tags } = shelf.select(filter);
      this.selectedKeys = tags;
      const selectedTags = new Set(tags);
      markSelectedTags(tagButtons, selectedTags);
      facets.empty();
      if (filter.author !== undefined)
        drawFacet(facets, "著者", filter.author, () => update({ author: undefined }));
      if (filter.publisher !== undefined)
        drawFacet(facets, "出版社", filter.publisher, () => update({ publisher: undefined }));
      count.setText(`${rows.length}冊`);
      list.empty();
      for (const row of rows) drawRow(list, row, { ...rowActions, selectedTags });
      drawShops(shops, filter.text, shopSearches(filter.text));
    };
    render();
  }
}
