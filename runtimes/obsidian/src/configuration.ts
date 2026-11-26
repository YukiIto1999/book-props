import { decodeHost } from "./tls-identity.ts";

/** 保存済みの接続の記録。v0.3.0 までの記録は接続用フォルダ名を持たない */
export type GrantRecord = Readonly<{ id: string; scope: string; name?: string }>;
export type Configuration = {
  folder?: string;
  port?: number;
  host?: string;
  grant?: GrantRecord;
};

function field(record: unknown, key: string): unknown {
  if (typeof record === "object" && record !== null) return Reflect.get(record, key);
  return undefined;
}

export function decodeConfiguration(saved: unknown): Configuration {
  const folder = field(saved, "folder");
  const port = field(saved, "port");
  const host =
    decodeHost(field(saved, "host")) ?? decodeHost(field(field(saved, "identity"), "name"));
  const grant = field(saved, "grant");
  const id = field(grant, "id");
  const scope = field(grant, "scope");
  const name = field(grant, "name");
  return {
    ...(typeof folder === "string" ? { folder } : {}),
    ...(typeof port === "number" ? { port } : {}),
    ...(host ? { host } : {}),
    ...(typeof id === "string" && typeof scope === "string"
      ? { grant: { id, scope, ...(typeof name === "string" ? { name } : {}) } }
      : {}),
  };
}
