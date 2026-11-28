import { Modal, Notice, Setting, type App, type Plugin, type TextComponent } from "obsidian";
import type { Catalog, StoredBook } from "../catalog/catalog.ts";
import { chosenStatus, localDate, ReadingDraft, readingMessage } from "./reading-draft.ts";
import { readingChoices } from "./shelf-fields.ts";

/**
 * 一冊の読書状態と読了日を変える画面。読了にしたときに読了日が空なら、今日の日付を案として入れる。
 * 利用者が書き換えない限り、本ページにある読了日はそのまま残す。
 */
export class ReadingEditor extends Modal {
  private readonly draft: ReadingDraft;
  private field: TextComponent | undefined;

  constructor(
    app: App,
    private readonly catalog: Catalog,
    private readonly entry: StoredBook,
    private readonly done: () => void = () => undefined,
  ) {
    super(app);
    this.draft = new ReadingDraft(entry.book, localDate(new Date()));
  }

  override onOpen(): void {
    // 長い書名を題に入れると閉じるボタンに重なるので、題は短くし、書名は折り返す本文の行に置く。
    this.setTitle("読書状態と読了日");
    this.contentEl.createEl("p", { text: this.entry.book.title });
    new Setting(this.contentEl).setName("読書状態").addDropdown((dropdown) => {
      dropdown.selectEl.setAttribute("aria-label", "読書状態");
      dropdown
        .addOptions(readingChoices)
        .setValue(this.draft.status ?? "unset")
        .onChange((key) => {
          const shown = this.draft.choose(chosenStatus(key));
          if (shown !== undefined) this.field?.setValue(shown);
        });
    });
    this.mountFinishedOn();
    const message = this.contentEl.createEl("p", { attr: { role: "status" } });
    new Setting(this.contentEl).addButton((button) =>
      button
        .setButtonText("保存")
        .setCta()
        .onClick(async () => {
          button.setDisabled(true);
          await this.save(message);
          button.setDisabled(false);
        }),
    );
  }

  private mountFinishedOn(): void {
    const stored = this.entry.book.finishedOn;
    const shown = stored ? this.catalog.calendarDate(stored) : undefined;
    new Setting(this.contentEl)
      .setName("読了日")
      .setDesc(
        "読了にしたときに読了日が空なら、今日の日付を入れます。ほかの状態に変えても、未設定に戻しても、読了日は残ります。",
      )
      .addText((text) => {
        this.field = text;
        text.inputEl.setAttribute("aria-label", "読了日");
        // 日付として読めない手書きの値は、日付の欄に入れると消えて見えるので、文字のまま示す。
        if (shown || !stored) text.inputEl.type = "date";
        text.setValue(shown ?? stored ?? "").onChange((value) => this.draft.type(value));
      })
      .addButton((button) =>
        button.setButtonText("今日にする").onClick(() => {
          this.field?.setValue(this.draft.fillToday());
        }),
      );
  }

  private async save(message: HTMLElement): Promise<void> {
    const draft = this.draft.value((text) => this.catalog.calendarDate(text));
    if (draft.kind === "invalidDate") {
      message.setText(`読了日に実在する日付を入力してください: ${draft.text}`);
      return;
    }
    const { book } = this.entry;
    const [outcome = "unavailable"] = await this.catalog.reading.set([
      { book, value: draft.value },
    ]);
    message.setText(readingMessage[outcome]);
    if (outcome !== "saved") return;
    new Notice(readingMessage.saved);
    this.close();
    this.done();
  }
}

/** 開いている本ページの読書状態を変える画面を開く。書籍フォルダの本ページでなければ知らせる。 */
async function openReadingEditor(app: App, catalog: Catalog, path: string): Promise<void> {
  const entry = await catalog.entries().then(
    (entries) => entries.find((stored) => stored.path === path),
    () => undefined,
  );
  if (entry) new ReadingEditor(app, catalog, entry).open();
  else new Notice("開いているページを、書籍フォルダの本ページとして読み取れません。");
}

/**
 * 「読書状態を変える」コマンドを加える。書籍フォルダのMarkdownを開いているときだけ選べる。
 * @param books - 書籍フォルダとその目録。書籍フォルダを指定していなければ`undefined`
 */
export function addReadingCommand(
  plugin: Plugin,
  books: () => Readonly<{ catalog: Catalog; folder: string }> | undefined,
): void {
  plugin.addCommand({
    id: "set-reading-status",
    name: "読書状態を変える",
    checkCallback: (checking) => {
      const file = plugin.app.workspace.getActiveFile();
      const target = books();
      if (!target || file?.extension !== "md" || !file.path.startsWith(`${target.folder}/`))
        return false;
      if (!checking) void openReadingEditor(plugin.app, target.catalog, file.path);
      return true;
    },
  });
}
