import { Notice } from "obsidian";
import type { Configuration, GrantRecord } from "../configuration.ts";
import { removeLegacyGrant, vaultGrant, type ConnectionGrant } from "./connection-grant.ts";
import { connectionSetupError, establish } from "./connection-setup.ts";
import { scopeOf, type Connection } from "./connection.ts";
import { optionalField } from "../../shared/optional-field.ts";
import { createHost } from "./tls-identity.ts";

type Owner = Readonly<{
  /** Vault の絶対パス */
  vaultPath(): string;
  /** 書籍フォルダ、未設定なら空文字列 */
  folder(): string;
  /** 保存済みの接続設定 */
  config(): Configuration;
  /** 接続設定の保存 */
  save(next: Configuration): Promise<void>;
  /** 拡張の要求を書籍フォルダへ渡す受付の開始 */
  listen(host: string, port: number, scope: string, grant: ConnectionGrant): Promise<Connection>;
  /** プラグインの無効化の有無 */
  unloaded(): boolean;
}>;

/** 一つの Vault で拡張からの要求を受け付ける接続 */
export class VaultConnection {
  private connection: Connection | undefined;

  constructor(private readonly owner: Owner) {}

  /** 受付中の接続用フォルダ、受付を止めていればなし */
  get directory(): string | undefined {
    return this.connection?.grant.directory;
  }

  /** 受付の有無 */
  get running(): boolean {
    return this.connection !== undefined;
  }

  /**
   * 受付の停止
   * @returns 停止させた受付の接続用フォルダ
   */
  take(): ConnectionGrant | undefined {
    const connection = this.connection;
    this.connection = undefined;
    connection?.stop();
    return connection?.grant;
  }

  /**
   * 使わなくなった接続用フォルダの削除
   * @param running - 停止させた受付の接続用フォルダ
   * @param saved - 外した接続の記録
   */
  async release(
    running: ConnectionGrant | undefined,
    saved: GrantRecord | undefined,
  ): Promise<void> {
    if (running) return running.clear().catch(() => undefined);
    if (!saved) return;
    if (!saved.name) return removeLegacyGrant(saved.id).catch(() => undefined);
    // 同じ名前を別の接続が使っていれば開けず残るフォルダ
    const grant = await vaultGrant(this.owner.vaultPath(), {
      id: saved.id,
      name: saved.name,
      scope: saved.scope,
    }).catch(() => undefined);
    await grant?.clear().catch(() => undefined);
  }

  /**
   * 拡張からの受付の開始と接続設定の保存
   * @returns 保存まで済めば `true`、失敗すれば利用者に伝える文
   */
  async connect(): Promise<true | string> {
    const { owner } = this;
    const previous = owner.config();
    const host = previous.host ?? createHost();
    try {
      const vault = owner.vaultPath();
      const scope = scopeOf(vault, owner.folder());
      const started = await establish({
        vault,
        scope,
        ...optionalField("saved", previous.grant),
        ...optionalField("running", this.take()),
        start: (grant) => owner.listen(host, previous.port ?? 0, scope, grant),
        save: async (grant, connection) => {
          if (owner.unloaded()) throw new Error("Book Props が無効になりました。");
          await owner.save({
            ...previous,
            host,
            port: connection.listeningPort,
            grant,
          });
        },
        reopen: (grant) => this.resume(grant),
      });
      if (owner.unloaded()) {
        started.stop();
        return "Book Props が無効になりました。";
      }
      this.connection = started;
      return true;
    } catch (error) {
      return owner.unloaded() ? "Book Props が無効になりました。" : connectionSetupError(error);
    }
  }

  /** 起動時の受付の再開と、v0.3.0 までの接続用フォルダからの移行 */
  async restore(): Promise<void> {
    const { grant } = this.owner.config();
    if (!this.owner.folder() || !grant || grant.name || this.connection) return this.resume();
    const migrated = await this.connect();
    new Notice(
      migrated === true
        ? "Book Props: 接続用フォルダを移しました。ブラウザ拡張の接続設定で新しい接続用フォルダを選び直してください。"
        : `Book Props: ${migrated}`,
      12_000,
    );
  }

  /**
   * 保存済みの接続設定での受付の再開
   * @param reopened - 保存の失敗後に旧識別子の接続情報を公開し直すフォルダ、起動時ならなし
   */
  private async resume(reopened?: ConnectionGrant): Promise<void> {
    const { owner } = this;
    const snapshot = owner.config();
    const { host, port, grant } = snapshot;
    const folder = owner.folder();
    if (!folder || !host || !port || !grant?.name || this.connection) return;
    if (owner.unloaded()) return;
    let directory = reopened;
    if (!directory) {
      try {
        const vault = owner.vaultPath();
        if (grant.scope !== scopeOf(vault, folder)) return;
        directory = await vaultGrant(vault, { id: grant.id, name: grant.name, scope: grant.scope });
      } catch {
        new Notice(
          "Book Props: 接続用フォルダを使えません。Book Props の設定で Chrome との接続を始め直してください。",
        );
        return;
      }
    }
    try {
      const restored = await owner.listen(host, port, grant.scope, directory);
      if (owner.unloaded() || owner.config() !== snapshot || this.connection) restored.stop();
      else this.connection = restored;
    } catch {
      new Notice("Book Props: Chrome からの受付を開始できませんでした。");
    }
  }
}
