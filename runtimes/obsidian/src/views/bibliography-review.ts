import { Modal, Notice, Setting, type App } from "obsidian";
import type { AuthorRole, BookRecord } from "../adapters/note-format/book-record.ts";
import type { Proposal } from "../catalog/bibliography.ts";
import type { Catalog } from "../catalog/catalog.ts";
import type { BibliographyRevision } from "../core/catalog-core.ts";

type Review = Pick<Catalog["bibliography"], "propose" | "apply">;

function people(authors: readonly string[], roles: readonly AuthorRole[] | undefined): string {
  const named = authors.map((name) => {
    const role = roles?.find((entry) => entry.name === name)?.role;
    return role ? `${name}（${role}）` : name;
  });
  return named.join("、") || "なし";
}

function seriesText(series: readonly Readonly<{ isbn: string; name: string }>[] | undefined) {
  return series?.map(({ isbn, name }) => `${name}（${isbn}）`).join("、") || "なし";
}

/** 一冊の本で、書き換える項目ごとの「いま → 書き換え後」。 */
function revisionLines(book: BookRecord, revision: BibliographyRevision): string[] {
  const lines: string[] = [];
  if (revision.title !== undefined) lines.push(`書名：${book.title} → ${revision.title}`);
  if (revision.authors !== undefined) {
    const before = people(book.authors, book.authorRoles);
    lines.push(`著者：${before} → ${people(revision.authors, revision.authorRoles)}`);
  }
  for (const text of revision.editions) {
    const edition = book.editions.find(({ id }) => id === text.id);
    const name = edition?.label ?? edition?.isbns[0] ?? "版";
    if (text.publisher !== undefined)
      lines.push(`${name}の出版社：${edition?.publisher ?? "なし"} → ${text.publisher}`);
    if (text.label !== undefined)
      lines.push(`${name}の版：${edition?.label ?? "なし"} → ${text.label}`);
    if (text.series !== undefined)
      lines.push(`${name}のシリーズ：${seriesText(edition?.series)} → ${seriesText(text.series)}`);
  }
  return lines;
}

/**
 * 登録済みの本の書名・著者・出版社・シリーズを、保存する表記にそろえる。案を一覧で見せ、
 * 選んだ本だけを書き換える。ファイル名は変えない。
 */
export class BibliographyReview extends Modal {
  private running: AbortController | undefined;
  private readonly review: Review;

  constructor(app: App, review: Review) {
    super(app);
    this.review = review;
  }

  override onOpen(): void {
    this.setTitle("本の表記をそろえる");
    this.renderStart();
  }

  override onClose(): void {
    this.running?.abort();
    this.contentEl.empty();
  }

  private renderStart(): void {
    const content = this.contentEl;
    content.empty();
    content.createEl("p", {
      text: "書名・著者・出版社・シリーズの表記をそろえる案を作ります。案を確かめてから、選んだ本だけを書き換えます。ファイル名は変えません。書名を書き換えた本のファイル名は、「ファイル名を書名に合わせる」で合わせられます。",
    });
    let library = false;
    new Setting(content)
      .setName("国立国会図書館サーチで確かめる")
      .setDesc(
        "ISBNのある本は、国立国会図書館の書誌の書名・著者・出版社・シリーズを使います。ISBNごとに間をあけて問い合わせ、混み合っているときは待って問い直すため、1冊に数十秒から1分ほどかかることがあります。",
      )
      .addToggle((toggle) =>
        toggle.setValue(false).onChange((value) => {
          library = value;
        }),
      );
    const status = content.createEl("p", { attr: { role: "status" } });
    new Setting(content).addButton((button) =>
      button
        .setButtonText("案を作る")
        .setCta()
        .onClick(() => {
          button.setDisabled(true);
          void this.propose(library, status);
        }),
    );
  }

  private async propose(library: boolean, status: HTMLElement): Promise<void> {
    const controller = new AbortController();
    this.running = controller;
    new Setting(this.contentEl).addButton((button) =>
      button.setButtonText("中止").onClick(() => controller.abort()),
    );
    status.setText("本を確かめています…");
    try {
      const { proposals, failedLookups } = await this.review.propose(
        library,
        controller.signal,
        (done, total) => status.setText(`${total}件中${done}件を確かめました。`),
      );
      this.renderProposals(proposals, failedLookups);
    } catch {
      if (controller.signal.aborted) this.renderStart();
      else status.setText("書籍フォルダを確認できません。");
    } finally {
      if (this.running === controller) this.running = undefined;
    }
  }

  private renderProposals(proposals: readonly Proposal[], failedLookups: number): void {
    const content = this.contentEl;
    content.empty();
    const failed = failedLookups
      ? `国立国会図書館サーチに問い合わせられなかったISBNが${failedLookups}件あり、その本は表記だけをそろえる案にしました。`
      : "";
    if (!proposals.length) {
      content.createEl("p", { text: `表記をそろえる本はありません。${failed}` });
      return;
    }
    content.createEl("p", {
      text: `${proposals.length}冊に書き換えの案があります。書き換える本を選んでください。${failed}`,
    });
    const chosen = new Set(proposals);
    for (const proposal of proposals) {
      const row = new Setting(content).setName(`${proposal.book.title}（${proposal.path}）`);
      const lines = row.descEl.createEl("ul");
      for (const line of revisionLines(proposal.book, proposal.revision))
        lines.createEl("li", { text: line });
      row.addToggle((toggle) =>
        toggle.setValue(true).onChange((value) => {
          if (value) chosen.add(proposal);
          else chosen.delete(proposal);
        }),
      );
    }
    const status = content.createEl("p", { attr: { role: "status" } });
    new Setting(content).addButton((button) =>
      button
        .setButtonText("選んだ本を書き換える")
        .setCta()
        .onClick(async () => {
          button.setDisabled(true);
          await this.apply([...chosen], status);
        }),
    );
  }

  private async apply(chosen: readonly Proposal[], status: HTMLElement): Promise<void> {
    try {
      const { applied, changed, failed } = await this.review.apply(chosen);
      const parts = [`${applied}冊を書き換えました。`];
      if (changed) parts.push(`${changed}冊は案を作った後に変わっていたので書き換えていません。`);
      if (failed)
        parts.push(`${failed}冊は書き換えられませんでした。編集中でないか確かめてください。`);
      status.setText(parts.join(""));
      new Notice(parts.join(""));
    } catch {
      status.setText("書籍フォルダを確認できません。");
    }
  }
}
