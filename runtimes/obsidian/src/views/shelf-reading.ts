import { ButtonComponent, DropdownComponent, Notice, Setting, type App } from "obsidian";
import type { Catalog, StoredBook } from "../catalog/catalog.ts";
import { statusChange } from "../catalog/reading-records.ts";
import type { ShelfRow } from "../catalog/shelf-query.ts";
import type { ReadingStatus } from "../core/catalog-core.ts";
import { chosenStatus, readingNotice } from "./reading-draft.ts";
import { ReadingEditor } from "./reading.ts";
import { readingChoices } from "./shelf-fields.ts";

/** 本棚のうち、読書状態を変えるのに使う部分。 */
type ShelfAccess = Readonly<{
  /** いま並べている本。 */
  rows: () => readonly ShelfRow<StoredBook>[];
  /** 並べている本を描き直す。 */
  redraw: () => void;
  /** 書き込んだ後の本ページで本棚を開き直して描き直す。開き直せなければ偽。 */
  refresh: () => Promise<boolean>;
  /** 指定した位置にいま並ぶ本の、読書状態の欄に移る。 */
  focusRow: (index: number) => void;
}>;
/** 読書状態を変えた結果を伝える文と、すべての本を変えて本棚を開き直せたか。 */
type Outcome = Readonly<{ text: string; complete: boolean }>;

const unreloaded = "本棚を読み直せません。閉じてから開き直してください。";

/**
 * 本棚で読書状態を変える操作。行ごとに選んだ読書状態はその場で保存し、選んだ本にはまとめて付ける。
 * どちらも読了日は変えない。読了日は、読了なのに読了日がない本の行から開く画面で入れる。
 */
export class ShelfReading {
  /** まとめて読書状態を変えるために選んだ本のID。並べている本のものだけを残す。 */
  readonly chosen = new Set<string>();
  /** 選んでいる冊数を示す行。 */
  private readonly selection: HTMLElement;
  private readonly apply: ButtonComponent;
  private target: ReadingStatus | undefined = "unread";
  private readonly feedback: HTMLElement;
  /** 本棚の行から、選ぶ本を変え、読書状態を変え、読書状態と読了日の画面を開く操作。 */
  readonly rowActions = {
    chosenBooks: this.chosen,
    chooseBook: (bookId: string, chosen: boolean): void => this.choose(bookId, chosen),
    setReading: (entry: StoredBook, status: ReadingStatus | undefined): void =>
      this.setRow(entry, status),
    editReading: (entry: StoredBook): void => this.edit(entry),
  };

  constructor(
    private readonly app: App,
    private readonly catalog: Catalog,
    parent: HTMLElement,
    private readonly shelf: ShelfAccess,
  ) {
    const section = parent.createDiv();
    new Setting(section).setName("選んだ本の読書状態").setHeading();
    this.selection = section.createEl("p");
    this.apply = this.mountControls(section.createDiv());
    this.feedback = parent.createEl("p", { attr: { role: "status" } });
  }

  /**
   * 選ぶ操作と付ける読書状態の欄を、モーダルの幅で折り返す一行に並べる。
   * @returns 選んだ本に読書状態を付けるボタン
   */
  private mountControls(controls: HTMLElement): ButtonComponent {
    new ButtonComponent(controls).setButtonText("表示中の本をすべて選ぶ").onClick(() => {
      for (const { entry } of this.shelf.rows()) this.chosen.add(entry.book.id);
      this.shelf.redraw();
    });
    controls.appendText(" ");
    new ButtonComponent(controls).setButtonText("選択を外す").onClick(() => {
      this.chosen.clear();
      this.shelf.redraw();
    });
    controls.appendText(" ");
    const dropdown = new DropdownComponent(controls)
      .addOptions(readingChoices)
      .setValue("unread")
      .onChange((key) => {
        this.target = chosenStatus(key);
      });
    dropdown.selectEl.setAttribute("aria-label", "選んだ本に付ける読書状態");
    controls.appendText(" ");
    return new ButtonComponent(controls)
      .setButtonText("選んだ本に付ける")
      .setCta()
      .onClick(() => void this.applyChosen());
  }

  /** 本棚を描くたびに呼ぶ。並べていない本の選択を外し、選んでいる冊数を示す。 */
  shown(rows: readonly ShelfRow<StoredBook>[]): void {
    const ids = new Set(rows.map(({ entry }) => entry.book.id));
    for (const id of this.chosen) if (!ids.has(id)) this.chosen.delete(id);
    this.count();
  }

  private count(): void {
    this.selection.setText(`${this.chosen.size}冊を選んでいます。読了日は変えません。`);
    this.apply.setDisabled(this.chosen.size === 0);
  }

  private choose(bookId: string, chosen: boolean): void {
    if (chosen) this.chosen.add(bookId);
    else this.chosen.delete(bookId);
    this.count();
  }

  /** 一冊の読書状態をその場で変え、同じ位置に並ぶ本の読書状態の欄に移る。 */
  private setRow(entry: StoredBook, status: ReadingStatus | undefined): void {
    const index = this.shelf.rows().findIndex((row) => row.entry === entry);
    void this.write([entry], status).then((outcome) => {
      this.report(outcome, false);
      this.shelf.focusRow(index);
    });
  }

  /** 一冊の読書状態と読了日を変える画面を開き、保存したら本棚を開き直す。 */
  private edit(entry: StoredBook): void {
    const index = this.shelf.rows().findIndex((row) => row.entry === entry);
    const done = async (): Promise<void> => {
      const reloaded = await this.shelf.refresh();
      this.report({ text: reloaded ? "" : unreloaded, complete: reloaded }, false);
      this.shelf.focusRow(index);
    };
    new ReadingEditor(this.app, this.catalog, entry, () => void done()).open();
  }

  private async applyChosen(): Promise<void> {
    this.apply.setDisabled(true);
    const entries = this.shelf
      .rows()
      .flatMap(({ entry }) => (this.chosen.has(entry.book.id) ? [entry] : []));
    this.report(await this.write(entries, this.target), true);
  }

  /** 結果を本棚に示す。まとめて変えたときと、変えられない本があったときは通知も出す。 */
  private report({ text, complete }: Outcome, bulk: boolean): void {
    this.feedback.setText(text);
    if (text && (bulk || !complete)) new Notice(text);
  }

  /** 本の読書状態を変えて本棚を開き直す。すでにその読書状態の本と、読了日は変えない。 */
  private async write(
    entries: readonly StoredBook[],
    status: ReadingStatus | undefined,
  ): Promise<Outcome> {
    const changes = entries
      .filter(({ book }) => book.readingStatus !== status)
      .map(({ book }) => statusChange(book, status));
    if (!changes.length) return { text: "選んだ本は、すでにその読書状態です。", complete: true };
    const saves = await this.catalog.reading.set(changes);
    saves.forEach((save, index) => {
      const id = changes[index]?.book.id;
      if (save === "saved" && id !== undefined) this.chosen.delete(id);
    });
    const text = readingNotice(saves, status);
    const reloaded = await this.shelf.refresh();
    return {
      text: reloaded ? text : `${text}${unreloaded}`,
      complete: reloaded && saves.every((save) => save === "saved"),
    };
  }
}
