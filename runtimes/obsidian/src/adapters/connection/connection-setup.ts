import type { GrantRecord } from "../configuration.ts";
import type { Connection } from "./connection.ts";
import { removeLegacyGrant, vaultGrant, type ConnectionGrant } from "./connection-grant.ts";

type Stage = "folder" | "listen" | "save";

/** 接続設定の適用で失敗した段階 */
export class SetupFailure extends Error {
  constructor(
    readonly stage: Stage,
    cause: unknown,
  ) {
    super(`connection setup failed at ${stage}`, { cause });
  }
}

type Setup = Readonly<{
  /** Vault の絶対パス */
  vault: string;
  /** 現在の書籍範囲の識別子 */
  scope: string;
  /** 保存済みの接続の記録 */
  saved?: GrantRecord;
  /** 停止させた旧受付の接続用フォルダ */
  running?: ConnectionGrant;
  /** 接続用フォルダの親の `Book Props` を置くホーム */
  profile?: string;
  /** 接続情報を公開する受付の開始 */
  start(grant: ConnectionGrant): Promise<Connection>;
  /** 受付を始めた接続の記録の保存 */
  save(record: Required<GrantRecord>, connection: Connection): Promise<void>;
  /** 保存の失敗後、旧識別子の接続情報を公開し直す旧受付の再開 */
  reopen(grant: ConnectionGrant): Promise<void>;
}>;

/**
 * 識別子を新しくした接続用フォルダでの受付の開始と記録
 * @param setup - Vault と書籍範囲、旧接続、受付と保存の手段
 * @returns 記録まで済んだ受付
 * @throws {@link SetupFailure} 失敗の段階を持ち、旧フォルダには旧識別子の接続情報を残す
 */
export async function establish(setup: Setup): Promise<Connection> {
  const { vault, scope, saved, running, profile } = setup;
  const previous =
    running ??
    (saved?.name && saved.scope === scope
      ? await vaultGrant(vault, { id: saved.id, name: saved.name, scope }, profile).catch(
          () => undefined,
        )
      : undefined);
  let grant: ConnectionGrant;
  try {
    grant = previous ? previous.renew() : await vaultGrant(vault, undefined, profile);
  } catch (error) {
    throw new SetupFailure("folder", error);
  }
  let stage: Stage = "listen";
  let connection: Connection | undefined;
  try {
    connection = await setup.start(grant);
    stage = "save";
    await setup.save({ id: grant.id, name: grant.name, scope }, connection);
  } catch (error) {
    connection?.stop();
    // 共有する Vault 名のフォルダは削除せず旧識別子の接続情報へ戻す
    if (previous) await setup.reopen(previous).catch(() => undefined);
    else await grant.clear().catch(() => undefined);
    throw new SetupFailure(stage, error);
  }
  if (saved && !saved.name) await removeLegacyGrant(saved.id, profile).catch(() => undefined);
  return connection;
}

/**
 * 接続設定の適用の失敗を利用者に伝える文
 * @param error - {@link establish} が投げた失敗
 * @returns 失敗した段階に応じた文
 */
export function connectionSetupError(error: unknown): string {
  const stage = error instanceof SetupFailure ? error.stage : "folder";
  const cause = error instanceof SetupFailure ? error.cause : error;
  if (stage === "save") return "接続設定を Vault に保存できませんでした。";
  if (stage === "listen")
    return "Chrome からの受付を開始できませんでした。接続ポートを確認してください。";
  const detail =
    cause instanceof Error && /^connection-folder:[\w:-]+$/.test(cause.message)
      ? `（${cause.message}）`
      : "";
  return `接続用フォルダを準備できませんでした。${detail}`;
}
