import { Modal, Notice, Setting, type App } from "obsidian";
import type { Catalog } from "../catalog/catalog.ts";
import type { NoteRename, RenameResult } from "../catalog/note-name.ts";

type Renames = Pick<Catalog, "proposeNoteNames" | "renameNotes">;

/**
 * Obsidianの「内部リンクを自動更新」の設定。公開されたAPIにない設定なので、
 * 読み取れなければ`undefined`を返す。
 */
function updatesLinks(app: App): boolean | undefined {
  const getConfig: unknown = Reflect.get(app.vault, "getConfig");
  if (typeof getConfig !== "function") return undefined;
  const value: unknown = Reflect.apply(getConfig, app.vault, ["alwaysUpdateLinks"]);
  return typeof value === "boolean" ? value : undefined;
}

function linkNotice(updates: boolean | undefined): string {
  const where = "「設定」→「ファイルとリンク」";
  if (updates === true)
    return "「内部リンクを自動更新」は有効です。ほかのページからのリンクも新しい名前に書き換わります。";
  if (updates === false)
    return `「内部リンクを自動更新」は無効です。このまま変えると、ほかのページからのリンクは古い名前のまま残ります。リンクがあるときは、${where}で有効にしてから変えてください。`;
  return `ほかのページからのリンクが新しい名前に書き換わるのは、${where}で「内部リンクを自動更新」が有効なときだけです。`;
}

function resultText({ renamed, skipped, failed }: RenameResult): string {
  const parts = [`${renamed}件のファイル名を変えました。`];
  if (skipped)
    parts.push(
      `${skipped}件は一覧を作った後に変わったか、新しい名前が使われていたので変えていません。`,
    );
  if (failed) parts.push(`${failed}件は変えられませんでした。`);
  return parts.join("");
}

/** ファイル名をいまの書名に合わせる本ページを一覧で見せ、選んだ本ページだけ名前を変える。 */
export class NoteNameReview extends Modal {
  private readonly renames: Renames;

  constructor(app: App, renames: Renames) {
    super(app);
    this.renames = renames;
  }

  override onOpen(): void {
    this.setTitle("ファイル名を書名に合わせる");
    const status = this.contentEl.createEl("p", {
      text: "本ページを確かめています…",
      attr: { role: "status" },
    });
    this.renames.proposeNoteNames().then(
      (renames) => this.renderRenames(renames),
      () => status.setText("書籍フォルダを確認できません。"),
    );
  }

  override onClose(): void {
    this.contentEl.empty();
  }

  private renderRenames(renames: readonly NoteRename[]): void {
    const content = this.contentEl;
    content.empty();
    if (!renames.length) {
      content.createEl("p", { text: "ファイル名を変える本ページはありません。" });
      return;
    }
    content.createEl("p", {
      text: `${renames.length}件の本ページのファイル名が、いまの書名から決まる名前と違います。名前を変える本ページを選んでください。`,
    });
    content.createEl("p", { text: linkNotice(updatesLinks(this.app)) });
    const chosen = new Set(renames);
    for (const rename of renames) {
      new Setting(content).setName(`${rename.from} → ${rename.to}`).addToggle((toggle) =>
        toggle.setValue(true).onChange((value) => {
          if (value) chosen.add(rename);
          else chosen.delete(rename);
        }),
      );
    }
    const status = content.createEl("p", { attr: { role: "status" } });
    new Setting(content).addButton((button) =>
      button
        .setButtonText("選んだ本ページの名前を変える")
        .setCta()
        .onClick(async () => {
          button.setDisabled(true);
          await this.rename(
            renames.filter((rename) => chosen.has(rename)),
            status,
          );
        }),
    );
  }

  private async rename(chosen: readonly NoteRename[], status: HTMLElement): Promise<void> {
    try {
      const text = resultText(await this.renames.renameNotes(chosen));
      status.setText(text);
      new Notice(text);
    } catch {
      status.setText("書籍フォルダを確認できません。");
    }
  }
}
