import { Modal, type App } from "obsidian";
import type { Catalog, StoredBook } from "../catalog/catalog.ts";
import {
  emptyFilter,
  type ShelfFilter,
  type ShelfQuery,
  type ShelfRow,
} from "../catalog/shelf-query.ts";
import type { FieldKey } from "../core/catalog-core.ts";
import { markSelectedTags, mountFilterControls, mountTagBar } from "./shelf-controls.ts";
import { defaultColumns, shelfFields } from "./shelf-fields.ts";
import { ShelfReading } from "./shelf-reading.ts";
import { drawFacet, drawRow, drawShops } from "./shelf-rows.ts";
import { shopSearches } from "./shop-searches.ts";

export class Shelf extends Modal {
  private readonly catalog: Catalog;
  private filter: ShelfFilter = emptyFilter;
  /** 絞り込みのタグそれぞれのキー。最後の絞り込みでcoreが示したもの。 */
  private selectedKeys: readonly string[] = [];
  private query: ShelfQuery<StoredBook> | undefined;
  /** いま並べている本。 */
  private rows: readonly ShelfRow<StoredBook>[] = [];

  constructor(app: App, catalog: Catalog) {
    super(app);
    this.catalog = catalog;
  }

  override async onOpen(): Promise<void> {
    this.setTitle("本棚");
    const loading = this.contentEl.createEl("p", { text: "読み込み中…", attr: { role: "status" } });
    const opened = await this.catalog.openShelf().catch(() => undefined);
    if (loading.parentElement !== this.contentEl) {
      opened?.query.close();
      return;
    }
    if (!opened) {
      loading.setText("本棚を読み取れませんでした。書籍フォルダと記録を確認してください。");
      return;
    }
    if (opened.moving)
      loading.setText("未確定の版の移動があります。「本・版を管理」から確認してください。");
    else loading.remove();
    this.query = opened.query;
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

  /** 書き込んだ後の本ページで本棚を開き直す。開き直せないか、本棚を閉じていれば偽。 */
  private async reload(): Promise<boolean> {
    const opened = await this.catalog.openShelf().catch(() => undefined);
    if (!opened) return false;
    if (!this.query) {
      opened.query.close();
      return false;
    }
    this.query.close();
    this.query = opened.query;
    return true;
  }

  /** 読書状態を変えた行の位置にいま並ぶ本の、読書状態の欄に移る。続けて次の本を選べるようにする。 */
  private focusReading(list: HTMLElement, index: number): void {
    const rows = list.children;
    rows
      .item(Math.min(index, rows.length - 1))
      ?.querySelector("select")
      ?.focus();
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
      fields: shelfFields(shelf.fields),
      columns,
      update,
      redraw: () => render(),
    });
    const toggleTag = (tag: string, key: string): void =>
      update({ tags: this.toggledTags(tag, key) });
    const tagButtons = mountTagBar(contentEl, shelf.tags, toggleTag);
    const facets = contentEl.createDiv();
    const count = contentEl.createEl("p", { attr: { role: "status" } });
    const reading = new ShelfReading(this.app, this.catalog, contentEl, {
      rows: () => this.rows,
      redraw: () => render(),
      refresh: async () => {
        const reloaded = await this.reload();
        render();
        return reloaded;
      },
      focusRow: (index) => this.focusReading(list, index),
    });
    const list = contentEl.createEl("ul");
    const shops = contentEl.createDiv();
    const focusFacet = (): void => {
      facets.querySelector("button")?.focus();
    };
    const rowActions = {
      columns,
      ...reading.rowActions,
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
      const selection = this.query?.select(filter);
      if (!selection) return;
      const { rows, tags } = selection;
      this.rows = rows;
      reading.shown(rows);
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
