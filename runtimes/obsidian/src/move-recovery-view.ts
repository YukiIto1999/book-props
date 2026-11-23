import { Setting } from "obsidian";
import type { Management } from "./book-management.ts";
import { readEditionBackup } from "./book-note-parse.ts";
import type { Catalog, StoredBook } from "./catalog.ts";
import type { MoveCopy } from "./edition-recovery.ts";
import { downloadText } from "./management-ui.ts";

type Restore = (command: Extract<Management, { action: "restoreMoveCopy" }>) => Promise<void>;

export async function renderMoveCopies(
  content: HTMLElement,
  entries: readonly StoredBook[],
  catalog: Pick<Catalog, "moveCopiesMissingFrom">,
  restore: Restore,
): Promise<void> {
  try {
    for (const copy of await catalog.moveCopiesMissingFrom(entries))
      renderMoveCopy(content, entries, copy, restore);
  } catch {
    content.createEl("p", { text: "この端末に保存した版の控えを読み取れません。" });
  }
}

function renderMoveCopy(
  content: HTMLElement,
  entries: readonly StoredBook[],
  copy: MoveCopy,
  restore: Restore,
): void {
  const { edition } = readEditionBackup(copy.snapshot);
  const from = entries.find(({ book }) => book.id === copy.sourceId);
  const to = entries.find(({ book }) => book.id === copy.destinationId);
  const label = [edition.label, ...edition.isbns].filter(Boolean).join(" ／ ") || copy.editionId;
  const row = new Setting(content).setName(`見つからない版：${label}`);
  row.setDesc(
    `移動元：${from?.path ?? "見つかりません"} ／ 移動先：${to?.path ?? "見つかりません"}`,
  );
  for (const [target, buttonLabel] of [
    [from, "移動元に戻す"],
    [to, "移動先に戻す"],
  ] as const) {
    if (!target || target.book.archivedAt) continue;
    row.addButton((button) =>
      button
        .setButtonText(buttonLabel)
        .onClick(() =>
          restore({ action: "restoreMoveCopy", bookId: target.book.id, editionId: copy.editionId }),
        ),
    );
  }
  row.addButton((button) =>
    button
      .setButtonText("控えをファイルに保存")
      .onClick(() =>
        downloadText(
          content,
          `${copy.editionId}.json`,
          "application/json",
          JSON.stringify(copy, null, 2),
        ),
      ),
  );
}
