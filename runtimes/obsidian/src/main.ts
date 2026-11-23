import { FileSystemAdapter, Notice, Plugin, TFolder, normalizePath } from "obsidian";
import type { TAbstractFile } from "obsidian";
import type { Request, Response } from "@book-props/vault-contract";
import { readScopedNote } from "./book-note.ts";
import { Catalog, type Result } from "./catalog.ts";
import { Connection, extensionIdPattern, scopeOf, type Credentials } from "./connection.ts";
import { LibraryTools } from "./library-tools.ts";
import { Registration } from "./registration.ts";
import { Settings } from "./settings.ts";
import { Shelf } from "./shelf.ts";
import { decodeIdentity, dropIdentity, provisionIdentity, type Identity } from "./tls-identity.ts";
import { VaultFiles } from "./vault-files.ts";
import { startCatalogCore } from "./wasm.ts";

type Configuration = { folder?: string; extensionId?: string; port?: number; identity?: Identity };
type OpenRequest = Extract<Request, { action: "open" }>;

function savedField(saved: object, key: string): unknown {
  const value: unknown = Reflect.get(saved, key);
  return value;
}

/** Keeps only the plugin settings whose stored shape is still readable; anything else starts unset. */
function decodeConfiguration(saved: unknown): Configuration {
  if (typeof saved !== "object" || saved === null) return {};
  const folder = savedField(saved, "folder");
  const extensionId = savedField(saved, "extensionId");
  const port = savedField(saved, "port");
  const identity = decodeIdentity(savedField(saved, "identity"));
  return {
    ...(typeof folder === "string" ? { folder } : {}),
    ...(typeof extensionId === "string" ? { extensionId } : {}),
    ...(typeof port === "number" ? { port } : {}),
    ...(identity ? { identity } : {}),
  };
}

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
  get hasIdentity(): boolean {
    return Boolean(this.config.identity);
  }
  get address(): { url: string; fingerprint: string; certificate: string } | undefined {
    if (!this.connection || !this.config.identity) return undefined;
    return {
      url: this.connection.address,
      fingerprint: this.connection.fingerprint,
      certificate: this.config.identity.certificate,
    };
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
    this.addSettingTab(new Settings(this.app, this));
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
    this.addTemplateCommands();
    this.app.workspace.onLayoutReady(() => {
      if (this.unloaded) return;
      void this.restoreConnection();
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

  private addTemplateCommands(): void {
    const templates = {
      impression: { name: "感想のひな型を挿入", body: "## 印象に残った場面\n\n## 感想\n" },
      reference: {
        name: "実用書メモのひな型を挿入",
        body: "## 要点\n\n## 試してみること\n\n## 関連するメモ\n",
      },
    } as const;
    for (const [id, template] of Object.entries(templates)) {
      this.addCommand({
        id: `insert-${id}-template`,
        name: template.name,
        editorCallback: (editor, view) => {
          try {
            if (
              !this.folder ||
              !view.file?.path.startsWith(`${this.folder}/`) ||
              !readScopedNote(editor.getValue())
            ) {
              new Notice("書籍フォルダにある本ページを編集しているときに使えます。");
              return;
            }
            const line = editor.lastLine();
            editor.replaceRange(`\n\n${template.body}`, { line, ch: editor.getLine(line).length });
          } catch {
            new Notice("本ページを確認できません。");
          }
        },
      });
    }
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
    this.changing = true;
    try {
      this.connection?.stop();
      this.connection = undefined;
      await this.catalog?.stop();
      const next = { ...this.config, folder };
      await this.saveData(next);
      this.config = next;
      this.folder = folder;
      this.catalog = new Catalog(new VaultFiles(this.app, folder, this.fileVersion), this.evaluate);
      await this.restoreConnection();
      return true;
    } finally {
      this.changing = false;
    }
  }

  issueCode(): Credentials | undefined {
    return this.connection?.issueCode();
  }
  revoke(): void {
    this.connection?.revoke();
  }

  async configureConnection(extensionId: string, renew: boolean): Promise<boolean> {
    extensionId = extensionId.trim();
    if (this.changing || !this.catalog || !extensionIdPattern.test(extensionId)) return false;
    this.changing = true;
    const old = this.config.identity;
    let identity: Identity | undefined;
    let started: Connection | undefined;
    try {
      identity = renew || !old ? await provisionIdentity(old) : old;
      this.connection?.stop();
      this.connection = undefined;
      started = await this.listen(identity, extensionId, this.config.port ?? 0);
      if (this.unloaded) return false;
      const next = { ...this.config, extensionId, identity, port: started.listeningPort };
      await this.saveData(next);
      this.config = next;
      this.connection = started;
      if (old && old !== identity)
        await dropIdentity(old).catch(() => new Notice("旧鍵をOSの保管から削除できませんでした。"));
      return true;
    } catch {
      started?.stop();
      if (identity && identity !== old) await dropIdentity(identity).catch(() => undefined);
      await this.restoreConnection();
      return false;
    } finally {
      if (this.unloaded) started?.stop();
      this.changing = false;
    }
  }

  private async restoreConnection(): Promise<void> {
    const snapshot = this.config;
    const { identity, extensionId, port } = snapshot;
    if (!this.catalog || !identity || !extensionId || !port || this.connection || this.unloaded)
      return;
    try {
      const restored = await this.listen(identity, extensionId, port);
      if (this.unloaded || this.config !== snapshot || this.connection) restored.stop();
      else this.connection = restored;
    } catch {
      new Notice(
        "Book Props: 鍵保管または証明書を確認できず、Chromeからの受付を開始しませんでした。",
      );
    }
  }

  /** Starts accepting the extension for the current book folder, named by its scope. */
  private async listen(identity: Identity, extensionId: string, port: number): Promise<Connection> {
    const { adapter } = this.app.vault;
    if (!(adapter instanceof FileSystemAdapter)) throw new Error("Vaultの場所を確定できません。");
    const scope = scopeOf(adapter.getBasePath(), this.folder);
    return Connection.start(identity, extensionId, port, scope, this.dispatch);
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

  private readonly dispatch = async (
    request: Exclude<Request, { action: "pair" | "status" }>,
    signal: AbortSignal,
  ): Promise<Response> => {
    const catalog = this.catalog;
    if (!catalog || signal.aborted) return { kind: "unavailable" };
    if (request.action === "open") return this.openFromExtension(request, catalog, signal);
    const execution =
      request.action === "reconcile"
        ? await catalog.reconcile({ ...request, action: "purchase" })
        : await catalog.execute(request, signal);
    if (execution.kind === "observed")
      return {
        kind: "observed",
        ownership: execution.outcome.ownership,
        wanted: execution.outcome.wanted,
      };
    return { kind: execution.kind };
  };

  onunload(): void {
    this.unloaded = true;
    this.connection?.stop();
    void this.catalog?.stop();
  }
}
