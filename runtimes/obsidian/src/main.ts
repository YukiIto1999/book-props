import { FileSystemAdapter, Notice, Plugin, TFolder, normalizePath } from "obsidian";
import type { TAbstractFile } from "obsidian";
import type { Request, Response } from "@book-props/vault-contract";
import { Catalog, type Result } from "./catalog.ts";
import { decodeConfiguration, type Configuration } from "./configuration.ts";
import type { ConnectionGrant } from "./connection-grant.ts";
import { Connection } from "./connection.ts";
import { LibraryTools } from "./library-tools.ts";
import { addNoteTemplates } from "./note-templates.ts";
import { Registration } from "./registration.ts";
import { Settings } from "./settings.ts";
import { Shelf } from "./shelf.ts";
import { VaultConnection } from "./vault-connection.ts";
import { VaultFiles } from "./vault-files.ts";
import { startCatalogCore } from "./wasm.ts";

type OpenRequest = Extract<Request, { action: "open" }>;

export default class BookProps extends Plugin {
  folder = "";
  private catalog?: Catalog;
  private readonly clientId = crypto.randomUUID();
  private readonly fileVersions = new WeakMap<TAbstractFile, number>();
  private fileSequence = 0;
  private evaluate?: (json: string) => string;
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

  async onload(): Promise<void> {
    this.evaluate = startCatalogCore();
    const saved: unknown = await this.loadData();
    this.config = decodeConfiguration(saved);
    this.registerEvent(this.app.vault.on("modify", (file) => this.fileVersions.delete(file)));
    const { folder } = this.config;
    if (folder && normalizePath(folder) === folder) {
      this.folder = folder;
      this.catalog = new Catalog(new VaultFiles(this.app, folder, this.fileVersion), this.evaluate);
    }
    const settings = new Settings(this.app, this);
    this.addSettingTab(settings);
    this.addCommand({
      id: "register-book",
      name: "書籍を登録・編集",
      callback: () => {
        if (!this.catalog) new Notice("Book Propsの設定で書籍フォルダを指定してください。");
        else new Registration(this.app, this.catalog, this.clientId).open();
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
    addNoteTemplates(this, () => this.folder);
    this.app.workspace.onLayoutReady(() => {
      if (this.unloaded) return;
      if (!this.changing) {
        this.changing = true;
        void this.link.restore().finally(() => {
          this.changing = false;
          settings.refreshPairing();
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
    if (
      !this.evaluate ||
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
      const saved = this.config.grant;
      const next = { ...this.config, folder, grant: undefined };
      await this.saveData(next);
      const grant = this.link.take();
      await previous?.stop();
      if (this.unloaded) return false;
      this.config = next;
      this.folder = folder;
      this.catalog = new Catalog(new VaultFiles(this.app, folder, this.fileVersion), this.evaluate);
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
      const saved = this.config.grant;
      const next = { ...this.config, grant: undefined };
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
    return Connection.start(host, port, scope, grant, (request, signal) =>
      this.dispatch(catalog, request, signal),
    );
  }

  /** Brings Obsidian forward on the book page the extension asked for, or on registration when no book matches. */
  private async openFromExtension(
    request: OpenRequest,
    catalog: Catalog,
    signal: AbortSignal,
  ): Promise<Response> {
    if (request.intent) {
      window.focus();
      new Registration(this.app, catalog, this.clientId, request.product, request.intent).open();
      return { kind: "opened" };
    }
    const inspection = await catalog.execute(
      { action: "inspect", product: request.product },
      signal,
    );
    if (signal.aborted || this.catalog !== catalog) return { kind: "unavailable" };
    if (inspection.kind !== "unreadable" && inspection.kind !== "observed")
      return { kind: inspection.kind === "conflict" ? "conflict" : "unavailable" };
    return this.showInspection(inspection, catalog, request.product);
  }

  private async showInspection(
    inspection: Extract<Result, { kind: "unreadable" | "observed" }>,
    catalog: Catalog,
    product: OpenRequest["product"],
  ): Promise<Response> {
    const { path } = inspection;
    window.focus();
    if (!path) {
      new Registration(this.app, catalog, this.clientId, product).open();
      return { kind: "opened" };
    }
    const file = this.app.vault.getFileByPath(path);
    if (!file || !file.path.startsWith(`${this.folder}/`)) return { kind: "unavailable" };
    if (inspection.kind === "unreadable") {
      await this.app.workspace.getLeaf(false).openFile(file, {
        state: { mode: "source", source: true },
      });
      new Notice(
        `「${file.path}」を読み取れません。${inspection.reason} 記録を修正してから、Chromeで照合し直してください。`,
        12_000,
      );
    } else await this.app.workspace.getLeaf(false).openFile(file);
    return { kind: "opened" };
  }

  private async dispatch(
    catalog: Catalog,
    request: Exclude<Request, { action: "pair" | "status" }>,
    signal: AbortSignal,
  ): Promise<Response> {
    if (this.catalog !== catalog || signal.aborted) return { kind: "unavailable" };
    if (request.action === "open") return this.openFromExtension(request, catalog, signal);
    const execution =
      request.action === "reconcile"
        ? await catalog.reconcile({ ...request, action: "purchase" }, signal)
        : await catalog.execute(request, signal);
    if (execution.kind === "observed")
      return {
        kind: "observed",
        ownership: execution.outcome.ownership,
        wanted: execution.outcome.wanted,
      };
    return { kind: execution.kind };
  }

  onunload(): void {
    this.unloaded = true;
    this.link.take();
    void this.catalog?.stop();
  }
}
