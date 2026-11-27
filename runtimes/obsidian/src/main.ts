import { FileSystemAdapter, Notice, Plugin, TFolder, normalizePath } from "obsidian";
import type { TAbstractFile } from "obsidian";
import { bibliographySources, type BibliographySources } from "./adapters/bibliography-sources.ts";
import { decodeConfiguration, type Configuration } from "./adapters/configuration.ts";
import type { ConnectionGrant } from "./adapters/connection/connection-grant.ts";
import { Connection } from "./adapters/connection/connection.ts";
import { VaultConnection } from "./adapters/connection/vault-connection.ts";
import { NoteFormat } from "./adapters/note-format/note-format.ts";
import { VaultFiles } from "./adapters/vault-files.ts";
import { Catalog, type Product } from "./catalog/catalog.ts";
import type { BibliographyLookup } from "./catalog/ports.ts";
import { startCatalogCore, type CatalogCore } from "./core/catalog-core.ts";
import { BibliographyReview } from "./views/bibliography-review.ts";
import { addBooksBaseCommand } from "./views/books-base-command.ts";
import { answerExtension, type ExtensionHost } from "./views/extension-requests.ts";
import { LibraryTools } from "./views/library-tools.ts";
import { addNoteTemplates } from "./views/note-templates.ts";
import { NoteNameReview } from "./views/note-name-review.ts";
import type { LocalAction } from "./views/registration-messages.ts";
import { Registration } from "./views/registration.ts";
import { Settings } from "./views/settings.ts";
import { Shelf } from "./views/shelf.ts";

/** 起動したcoreと、それを使う本ページの書式と書誌の取得先。プラグインの読み込みで一度だけ作る。 */
type Runtime = Readonly<{
  core: CatalogCore;
  notes: NoteFormat;
  sources: BibliographySources & BibliographyLookup;
}>;

export default class BookProps extends Plugin {
  folder = "";
  private catalog?: Catalog;
  private readonly clientId = crypto.randomUUID();
  private readonly fileVersions = new WeakMap<TAbstractFile, number>();
  private fileSequence = 0;
  private runtime?: Runtime;
  private config: Configuration = {};
  private readonly link = new VaultConnection({
    vaultPath: () => this.vaultPath(),
    folder: () => this.folder,
    config: () => this.config,
    save: async (next) => {
      await this.saveData(next);
      this.config = next;
    },
    listen: (host, port, scope, grant) => this.listen(host, port, scope, grant),
    unloaded: () => this.unloaded,
  });
  private changing = false;
  private unloaded = false;

  get connectionDirectory(): string | undefined {
    return this.link.directory;
  }

  private readonly fileVersion = (file: TAbstractFile): number => {
    const known = this.fileVersions.get(file);
    if (known !== undefined) return known;
    const version = ++this.fileSequence;
    this.fileVersions.set(file, version);
    return version;
  };

  /** 書籍フォルダの本を扱う目録を、Vaultのファイルと起動済みのcoreで組み立てる。 */
  private openCatalog(folder: string, { core, notes, sources }: Runtime): Catalog {
    const files = new VaultFiles(this.app, folder, this.fileVersion);
    return new Catalog(files, core, notes, sources);
  }

  private openRegistration(catalog: Catalog, product?: Product, intent?: LocalAction): void {
    const sources = this.runtime?.sources;
    if (!sources) return;
    const services = { catalog, sources, clientId: this.clientId };
    new Registration(this.app, services, product, intent).open();
  }

  override async onload(): Promise<void> {
    const core = startCatalogCore();
    const runtime = { core, notes: new NoteFormat(core), sources: bibliographySources(core) };
    this.runtime = runtime;
    const saved: unknown = await this.loadData();
    this.config = decodeConfiguration(saved);
    this.registerEvent(this.app.vault.on("modify", (file) => this.fileVersions.delete(file)));
    const { folder } = this.config;
    if (folder && normalizePath(folder) === folder) {
      this.folder = folder;
      this.catalog = this.openCatalog(folder, runtime);
    }
    const settings = new Settings(this.app, this);
    this.addSettingTab(settings);
    this.addCommand({
      id: "register-book",
      name: "書籍を登録・編集",
      callback: () => {
        if (!this.catalog) new Notice("Book Propsの設定で書籍フォルダを指定してください。");
        else this.openRegistration(this.catalog);
      },
    });
    this.addCommand({
      id: "open-shelf",
      name: "本棚を開く",
      callback: () => {
        if (!this.catalog) new Notice("Book Propsの設定で書籍フォルダを指定してください。");
        else new Shelf(this.app, this.catalog).open();
      },
    });
    this.addCommand({
      id: "manage-books",
      name: "本・版を管理",
      callback: () => {
        if (!this.catalog) new Notice("Book Propsの設定で書籍フォルダを指定してください。");
        else
          new LibraryTools(this.app, this.catalog, this.app.workspace.getActiveFile()?.path).open();
      },
    });
    this.addCommand({
      // 以前の「本IDのファイル名を書名に変える」と同じIDのままにして、割り当てたホットキーを保つ。
      id: "rename-id-named-notes",
      name: "ファイル名を書名に合わせる",
      callback: () => {
        if (!this.catalog) new Notice("Book Propsの設定で書籍フォルダを指定してください。");
        else new NoteNameReview(this.app, this.catalog).open();
      },
    });
    this.addCommand({
      id: "normalize-book-text",
      name: "本の表記をそろえる",
      callback: () => {
        if (!this.catalog) new Notice("Book Propsの設定で書籍フォルダを指定してください。");
        else new BibliographyReview(this.app, this.catalog.bibliography).open();
      },
    });
    addBooksBaseCommand(this, () => this.folder);
    addNoteTemplates(this, () => this.folder, runtime.notes);
    this.app.workspace.onLayoutReady(() => {
      if (this.unloaded) return;
      if (!this.changing) {
        this.changing = true;
        void this.link.restore().finally(() => {
          this.changing = false;
          settings.update();
        });
      }
      void this.catalog?.maintain();
      this.registerInterval(
        window.setInterval(
          () => {
            void this.catalog?.maintain();
          },
          60 * 60 * 1000,
        ),
      );
    });
  }

  async selectFolder(proposed: string): Promise<boolean> {
    const folder = proposed.trim();
    const { runtime } = this;
    if (
      !runtime ||
      !folder ||
      normalizePath(folder) !== folder ||
      !(this.app.vault.getAbstractFileByPath(folder) instanceof TFolder)
    )
      return false;
    if (this.changing) return false;
    if (folder === this.folder) return true;
    this.changing = true;
    try {
      const previous = this.catalog;
      const { grant: saved, ...kept } = this.config;
      const next = { ...kept, folder };
      await this.saveData(next);
      const grant = this.link.take();
      await previous?.stop();
      if (this.unloaded) return false;
      this.config = next;
      this.folder = folder;
      this.catalog = this.openCatalog(folder, runtime);
      await this.link.release(grant, saved);
      return true;
    } finally {
      this.changing = false;
    }
  }

  async revoke(): Promise<boolean> {
    if (this.changing) return false;
    this.changing = true;
    try {
      const { grant: saved, ...next } = this.config;
      await this.saveData(next);
      const grant = this.link.take();
      this.config = next;
      await this.link.release(grant, saved);
      return true;
    } catch {
      return false;
    } finally {
      this.changing = false;
    }
  }

  async startConnection(): Promise<true | string> {
    if (!this.catalog) return "先に書籍フォルダを設定してください。";
    if (this.changing) return "設定を変更中です。少し待ってからもう一度押してください。";
    if (this.link.running) return true;
    this.changing = true;
    try {
      return await this.link.connect();
    } finally {
      this.changing = false;
    }
  }

  private vaultPath(): string {
    const { adapter } = this.app.vault;
    if (!(adapter instanceof FileSystemAdapter)) throw new Error("Vaultの場所を確定できません。");
    return adapter.getBasePath();
  }

  private listen(
    host: string,
    port: number,
    scope: string,
    grant: ConnectionGrant,
  ): Promise<Connection> {
    const catalog = this.catalog;
    if (!catalog) throw new Error("書籍フォルダを確認できません。");
    const requests: ExtensionHost = {
      app: this.app,
      folder: () => this.folder,
      current: (opened) => this.catalog === opened,
      openRegistration: (...form) => this.openRegistration(...form),
    };
    return Connection.start(host, port, scope, grant, (request, signal) =>
      answerExtension(requests, catalog, request, signal),
    );
  }

  override onunload(): void {
    this.unloaded = true;
    this.link.take();
    void this.catalog?.stop();
  }
}
