import { decodeHost } from "./tls-identity.ts";

type GrantBinding = { id: string; scope: string };
export type Configuration = {
  folder?: string;
  extensionId?: string;
  port?: number;
  host?: string;
  grant?: GrantBinding;
};

function field(record: unknown, key: string): unknown {
  if (typeof record === "object" && record !== null) return Reflect.get(record, key);
  return undefined;
}

export function decodeConfiguration(saved: unknown): Configuration {
  const folder = field(saved, "folder");
  const extensionId = field(saved, "extensionId");
  const port = field(saved, "port");
  const host =
    decodeHost(field(saved, "host")) ?? decodeHost(field(field(saved, "identity"), "name"));
  const grant = field(saved, "grant");
  const id = field(grant, "id");
  const scope = field(grant, "scope");
  return {
    ...(typeof folder === "string" ? { folder } : {}),
    ...(typeof extensionId === "string" ? { extensionId } : {}),
    ...(typeof port === "number" ? { port } : {}),
    ...(host ? { host } : {}),
    ...(typeof id === "string" && typeof scope === "string" ? { grant: { id, scope } } : {}),
  };
}

export function connectionSetupError(error: unknown, stage: "folder" | "listen" | "save"): string {
  if (stage === "save") return "接続設定を Vault に保存できませんでした。";
  if (stage === "listen")
    return "Chrome からの受付を開始できませんでした。接続ポートを確認してください。";
  const detail =
    error instanceof Error && /^connection-folder:[\w:-]+$/.test(error.message)
      ? `（${error.message}）`
      : "";
  return `接続用フォルダを準備できませんでした。${detail}`;
}
