import { FileSystemAdapter, MarkdownView, TFile, TFolder, normalizePath, type App } from "obsidian";
import type { BookFiles } from "./catalog.ts";
import { LocalMoveCopies, moveCopyDirectory } from "./local-move-copies.ts";

export class VaultFiles implements BookFiles {
  readonly moveCopies = new LocalMoveCopies(() => {
    const { adapter } = this.app.vault;
    if (!(adapter instanceof FileSystemAdapter)) throw new Error("Vaultの場所を確定できません。");
    return moveCopyDirectory(adapter.getBasePath(), this.folder);
  });

  constructor(
    private readonly app: App,
    readonly folder: string,
    private readonly fileVersion: (file: TFile) => number,
  ) {}

  versions(): ReadonlyMap<string, string> {
    if (!(this.app.vault.getAbstractFileByPath(this.folder) instanceof TFolder))
      throw new Error("書籍フォルダが見つかりません。");
    const files = new Map<string, string>();
    const prefix = `${this.folder}/`;
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!file.path.startsWith(prefix)) continue;
      const { ctime, mtime, size } = file.stat;
      files.set(file.path, `${this.fileVersion(file)}:${ctime}:${mtime}:${size}`);
    }
    return files;
  }

  private file(path: string): TFile {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (
      !(file instanceof TFile) ||
      file.extension !== "md" ||
      !path.startsWith(`${this.folder}/`) ||
      normalizePath(path) !== path
    ) {
      throw new Error("書籍フォルダの外にはアクセスできません。");
    }
    return file;
  }

  read(path: string): Promise<string> {
    return this.app.vault.read(this.file(path));
  }

  async process(
    path: string,
    update: (raw: string, currentPath: string) => string,
  ): Promise<string> {
    const file = this.file(path);
    await this.app.vault.process(file, (latest) => {
      if (this.file(file.path) !== file) throw new Error("対象の本ページが置き換わりました。");
      return update(latest, file.path);
    });
    return file.path;
  }

  async create(bookId: string, raw: string): Promise<string> {
    if (!(this.app.vault.getAbstractFileByPath(this.folder) instanceof TFolder))
      throw new Error("書籍フォルダが見つかりません。");
    const created = await this.app.vault.create(`${this.folder}/${bookId}.md`, raw);
    return created.path;
  }

  canUpdate(path: string, latest: string): boolean {
    return this.app.workspace.getLeavesOfType("markdown").every(({ view }) => {
      if (
        !(view instanceof MarkdownView) ||
        view.file?.path !== path ||
        view.getMode() === "preview"
      )
        return true;
      return view.editor.getValue().replaceAll("\r\n", "\n") === latest.replaceAll("\r\n", "\n");
    });
  }
}
