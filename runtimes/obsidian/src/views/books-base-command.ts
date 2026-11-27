import { Notice, type Plugin } from "obsidian";
import { booksBasePath, placeBooksBase, type BooksBasePlacement } from "./books-base.ts";

/** 書籍フォルダの本をBasesで一覧するファイルを、なければ作って開く。 */
async function openBooksBase(plugin: Plugin, folder: string): Promise<void> {
  const { vault, workspace } = plugin.app;
  let placed: BooksBasePlacement;
  try {
    placed = await placeBooksBase(
      {
        exists: (path) => vault.getAbstractFileByPath(path) !== null,
        create: (path, text) => vault.create(path, text),
      },
      folder,
    );
  } catch {
    new Notice(`「${booksBasePath}」を作れませんでした。`);
    return;
  }
  if (placed === "existing") {
    new Notice(
      `「${booksBasePath}」はすでにあるため、書き換えずに開きました。作り直すときは、このファイルを削除してから実行してください。`,
    );
  }
  await workspace.openLinkText(booksBasePath, "", false);
}

export function addBooksBaseCommand(plugin: Plugin, bookFolder: () => string): void {
  plugin.addCommand({
    id: "create-books-base",
    name: "本の一覧を作る",
    callback: () => {
      const folder = bookFolder();
      if (!folder) new Notice("Book Propsの設定で書籍フォルダを指定してください。");
      else void openBooksBase(plugin, folder);
    },
  });
}
