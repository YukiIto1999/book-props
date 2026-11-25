import { FileSystemAdapter, Notice, Plugin, TFolder, normalizePath } from "obsidian";
import type { TAbstractFile } from "obsidian";
import type { Request, Response } from "@book-props/vault-contract";
import { Catalog, type Result } from "./catalog.ts";
import { decodeConfiguration, type Configuration } from "./configuration.ts";
import { openVaultGrant, type ConnectionGrant } from "./connection-grant.ts";
import { Connection, extensionIdPattern, scopeOf } from "./connection.ts";
import { LibraryTools } from "./library-tools.ts";
import { addNoteTemplates } from "./note-templates.ts";
import { Registration } from "./registration.ts";
import { Settings } from "./settings.ts";
import { Shelf } from "./shelf.ts";
import { createHost } from "./tls-identity.ts";
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
  private connection?: Connection;
  private changing = false;
  private unloaded = false;

  get extensionId(): string {
    return this.config.extensionId ?? "";
  }
  get connectionDirectory(): string | undefined {
    return this.connection?.grant.directory;
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
        void this.restoreConnection().finally(() => {
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
      const next = { ...this.config, folder, grant: undefined };
      await this.saveData(next);
      const grant = this.takeConnection();
      await previous?.stop();
      if (this.unloaded) return false;
      this.config = next;
      this.folder = folder;
      this.catalog = new Catalog(new VaultFiles(this.app, folder, this.fileVersion), this.evaluate);
      await grant?.clear().catch(() => undefined);
      return true;
    } finally {
      this.changing = false;
    }
  }

  private takeConnection(): ConnectionGrant | undefined {
    const connection = this.connection;
    this.connection = undefined;
    connection?.stop();
    return connection?.grant;
  }

  async revoke(): Promise<boolean> {
    if (this.changing) return false;
    this.changing = true;
    try {
      const id = this.config.grant?.id;
      const next = { ...this.config, grant: undefined };
      await this.saveData(next);
      const grant = this.takeConnection();
      this.config = next;
      const directory =
        grant ??
        (id ? await openVaultGrant(this.vaultPath(), id).catch(() => undefined) : undefined);
      await directory?.clear().catch(() => undefined);
      return true;
    } catch {
      return false;
    } finally {
      this.changing = false;
    }
  }

  async configureConnection(extensionId: string): Promise<boolean> {
    extensionId = extensionId.trim();
    if (this.changing || !this.catalog || !extensionIdPattern.test(extensionId)) return false;
    if (this.connection && extensionId === this.extensionId) return true;
    this.changing = true;
    const host = this.config.host ?? createHost();
    let started: Connection | undefined;
    let grant: ConnectionGrant | undefined;
    let previous: ConnectionGrant | undefined;
    try {
      previous = this.takeConnection();
      const scope = scopeOf(this.vaultPath(), this.folder);
      grant = await openVaultGrant(this.vaultPath());
      started = await this.listen(host, extensionId, this.config.port ?? 0, scope, grant);
      if (this.unloaded) return false;
      const next = {
        ...this.config,
        extensionId,
        host,
        port: started.listeningPort,
        grant: { id: grant.id, scope },
      };
      await this.saveData(next);
      if (this.unloaded) return false;
      this.config = next;
      this.connection = started;
      await previous?.clear().catch(() => undefined);
      return true;
    } catch (error) {
      const reason =
        error instanceof Error && error.message.startsWith("connection-folder:")
          ? error.message
          : undefined;
      console.warn(
        "Book Props connection setup:",
        reason ?? (started ? "save-settings" : grant ? "start-listener" : "open-connection-folder"),
      );
      started?.stop();
      await grant?.clear().catch(() => undefined);
      await this.restoreConnection();
      return false;
    } finally {
      if (this.unloaded) started?.stop();
      this.changing = false;
    }
  }

  private async restoreConnection(): Promise<void> {
    const snapshot = this.config;
    const { host, extensionId, port, grant } = snapshot;
    if (
      !this.catalog ||
      !host ||
      !extensionId ||
      !port ||
      !grant ||
      this.connection ||
      this.unloaded
    )
      return;
    try {
      const scope = scopeOf(this.vaultPath(), this.folder);
      if (grant.scope !== scope) return;
      const directory = await openVaultGrant(this.vaultPath(), grant.id);
      const restored = await this.listen(host, extensionId, port, scope, directory);
      if (this.unloaded || this.config !== snapshot || this.connection) restored.stop();
      else this.connection = restored;
    } catch {
      new Notice("Book Props: Chrome からの受付を開始できませんでした。");
    }
  }

  private vaultPath(): string {
    const { adapter } = this.app.vault;
    if (!(adapter instanceof FileSystemAdapter)) throw new Error("Vaultの場所を確定できません。");
    return adapter.getBasePath();
  }

  private listen(
    host: string,
    extensionId: string,
    port: number,
    scope: string,
    grant: ConnectionGrant,
  ): Promise<Connection> {
    const catalog = this.catalog;
    if (!catalog) throw new Error("書籍フォルダを確認できません。");
    return Connection.start(host, extensionId, port, scope, grant, (request, signal) =>
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
    this.connection?.stop();
    void this.catalog?.stop();
  }
}
