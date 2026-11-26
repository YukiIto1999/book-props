import { Modal, Notice, Setting, type App } from "obsidian";
import type { Catalog, StoredBook } from "./catalog.ts";
import type { CustomField, EditionRecord } from "./book-note.ts";
import type { Management } from "./book-management.ts";
import { EditionEditor, FieldEditor, customKinds } from "./book-editors.ts";
import { actionMessage, downloadText } from "./management-ui.ts";
import { renderMoveCopies } from "./move-recovery-view.ts";
import { PortableLibraryError } from "./portable-library.ts";

/** Names a book by title and authors, and by its page path so books with the same title and authors stay distinct. */
function bookLabel({ path, book }: StoredBook): string {
  const archived = book.archivedAt ? "（アーカイブ）" : "";
  return `${[book.title, book.authors.join("、"), path].filter(Boolean).join(" ／ ")}${archived}`;
}

export class LibraryTools extends Modal {
  private selectedId = "";
  constructor(
    app: App,
    private readonly catalog: Catalog,
    private readonly currentPath: string | undefined,
  ) {
    super(app);
  }

  override async onOpen(): Promise<void> {
    this.setTitle("本・版の管理");
    await this.render();
  }

  private async action(command: Management, status: HTMLElement): Promise<void> {
    const outcome = await this.catalog.manage(command);
    if (outcome === "saved" || outcome === "pending") await this.render();
    else status.setText(actionMessage[outcome]);
    new Notice(actionMessage[outcome]);
  }

  private readonly rerender = (): void => {
    void this.render();
  };

  private async render(): Promise<void> {
    const content = this.contentEl;
    content.empty();
    const status = content.createEl("p", { attr: { role: "status" } });
    let entries: StoredBook[];
    try {
      entries = await this.catalog.entries();
    } catch {
      status.setText("書籍フォルダを確認できません。");
      return;
    }
    entries.sort((left, right) => left.book.title.localeCompare(right.book.title, "ja"));
    void renderMoveCopies(content.createDiv(), entries, this.catalog, (command) =>
      this.action(command, status),
    );
    this.selectedId ||=
      entries.find(({ path }) => path === this.currentPath)?.book.id ?? entries[0]?.book.id ?? "";
    const selected = entries.find(({ book }) => book.id === this.selectedId);
    new Setting(content).setName("対象の本").addDropdown((field) => {
      field.selectEl.setAttribute("aria-label", "対象の本");
      field.addOption("", entries.length ? "選択してください" : "本がありません");
      for (const entry of entries) field.addOption(entry.book.id, bookLabel(entry));
      field.setValue(this.selectedId).onChange((id) => {
        this.selectedId = id;
        void this.render();
      });
    });
    if (selected) this.renderBook(content, selected, entries, status);
    this.renderTransfer(content, status);
  }

  private renderTransfer(content: HTMLElement, status: HTMLElement): void {
    const transfer = content.createEl("section");
    transfer.createEl("h3", { text: "JSON入出力" });
    new Setting(transfer).setName("書籍データ").addButton((button) =>
      button.setButtonText("JSONを書き出す").onClick(async () => {
        try {
          downloadText(
            transfer,
            "book-props-vault.json",
            "application/json",
            await this.catalog.exportLibrary(),
          );
        } catch {
          status.setText("JSONを書き出せません。書籍の重複や中断された移動を確認してください。");
        }
      }),
    );
    const importLabel = transfer.createEl("label", { text: "空の書籍フォルダに取り込むJSON " });
    const source = importLabel.createEl("input", {
      type: "file",
      attr: { accept: ".json,application/json" },
    });
    new Setting(transfer).addButton((button) =>
      button.setButtonText("JSONを取り込む").onClick(async () => {
        const file = source.files?.item(0);
        if (!file) {
          status.setText("書き出したJSONを選んでください。");
          return;
        }
        button.setDisabled(true);
        try {
          const imported = await this.catalog.importLibrary(await file.text());
          if (imported.status === "saved") {
            await this.render();
            new Notice(`${imported.count}冊を取り込みました。`);
          } else if (imported.status === "pending")
            status.setText(
              `${imported.count}冊の作成を観測しました。既存ファイルは上書きせず、同じJSONで続きから取り込めます。`,
            );
          else
            status.setText(
              "既存の書籍を上書きしません。空の書籍フォルダか、同じJSONを取り込み途中のフォルダを選んでください。",
            );
        } catch (error: unknown) {
          status.setText(
            error instanceof PortableLibraryError ? error.message : "JSONを読み取れませんでした。",
          );
        } finally {
          button.setDisabled(false);
        }
      }),
    );
  }

  private renderBook(
    content: HTMLElement,
    selected: StoredBook,
    entries: readonly StoredBook[],
    status: HTMLElement,
  ): void {
    const { book, path } = selected;
    if (book.pendingMove) {
      new Setting(content)
        .setName("中断された版の移動")
        .setDesc(
          "移動元と移動先を照合して再開します。移動先に書き込んでいない場合だけ取り消せます。",
        )
        .addButton((button) =>
          button
            .setButtonText("移動を再開")
            .onClick(() => this.action({ action: "recoverMove", bookId: book.id }, status)),
        )
        .addButton((button) =>
          button
            .setButtonText("移動を取り消す")
            .onClick(() => this.action({ action: "cancelMove", bookId: book.id }, status)),
        );
      return;
    }
    new Setting(content)
      .setName(book.title)
      .setDesc(book.archivedAt ? "アーカイブ済み" : "")
      .addButton((button) =>
        button.setButtonText("本ページを開く").onClick(() => {
          void this.app.workspace.openLinkText(path, "", false);
          this.close();
        }),
      )
      .addButton((button) =>
        button
          .setButtonText(book.archivedAt ? "本を復元" : "本をアーカイブ")
          .onClick(() =>
            this.action(
              { action: book.archivedAt ? "restore" : "archive", bookId: book.id },
              status,
            ),
          ),
      );
    if (book.archivedAt) return;
    this.renderCustomFields(content, book.id, book.customFields ?? [], status);
    new Setting(content).addButton((button) =>
      button.setButtonText("版を追加").onClick(() => {
        new EditionEditor(this.app, this.catalog, selected, undefined, this.rerender).open();
      }),
    );
    const destinations = entries.filter(
      ({ book: other }) => other.id !== book.id && !other.archivedAt,
    );
    for (const [index, edition] of book.editions.entries())
      this.renderEdition(content, selected, { index, edition, destinations }, status);
  }

  private renderCustomFields(
    content: HTMLElement,
    bookId: string,
    customFields: readonly CustomField[],
    status: HTMLElement,
  ): void {
    new Setting(content).setName("独自項目").addButton((button) =>
      button.setButtonText("項目を追加").onClick(() => {
        new FieldEditor(this.app, this.catalog, bookId, undefined, this.rerender).open();
      }),
    );
    for (const field of customFields) {
      new Setting(content)
        .setName(field.name)
        .setDesc(
          `${customKinds[field.kind]}／${typeof field.value === "boolean" ? (field.value ? "はい" : "いいえ") : field.value}`,
        )
        .addButton((button) =>
          button.setButtonText("項目を編集").onClick(() => {
            new FieldEditor(this.app, this.catalog, bookId, field, this.rerender).open();
          }),
        )
        .addButton((button) =>
          button
            .setButtonText("項目を削除")
            .onClick(() =>
              this.action({ action: "updateCustomField", bookId, baseline: field }, status),
            ),
        );
    }
  }

  private renderEdition(
    content: HTMLElement,
    selected: StoredBook,
    {
      index,
      edition,
      destinations,
    }: Readonly<{ index: number; edition: EditionRecord; destinations: readonly StoredBook[] }>,
    status: HTMLElement,
  ): void {
    const bookId = selected.book.id;
    const row = new Setting(content)
      .setName(edition.label || `版 ${index + 1}`)
      .setDesc(
        [
          edition.isbns.join("、"),
          edition.archivedAt ? "アーカイブ済み" : edition.owned ? "所有" : "未所有",
        ]
          .filter(Boolean)
          .join("／"),
      );
    if (!edition.archivedAt) {
      row.addButton((button) =>
        button.setButtonText("編集").onClick(() => {
          new EditionEditor(this.app, this.catalog, selected, edition, this.rerender).open();
        }),
      );
    }
    row.addButton((button) =>
      button
        .setButtonText(edition.archivedAt ? "版を復元" : "版をアーカイブ")
        .onClick(() =>
          this.action(
            { action: edition.archivedAt ? "restore" : "archive", bookId, editionId: edition.id },
            status,
          ),
        ),
    );
    if (edition.archivedAt || !destinations.length) return;
    let destinationId = "";
    new Setting(content)
      .setName("移動先")
      .addDropdown((field) => {
        field.selectEl.setAttribute("aria-label", `版 ${index + 1} の移動先`);
        field.addOption("", "別の本を選択");
        for (const destination of destinations)
          field.addOption(destination.book.id, bookLabel(destination));
        field.onChange((id) => {
          destinationId = id;
        });
      })
      .addButton((button) =>
        button.setButtonText("版を移動").onClick(() => {
          if (!destinationId) {
            status.setText("移動先の本を選んでください。");
            return;
          }
          return this.action(
            { action: "move", bookId, editionId: edition.id, destinationId },
            status,
          );
        }),
      );
  }
}
