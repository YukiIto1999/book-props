import { connectionOrigin, vaultScope } from "@book-props/vault-contract";
import type { Connection, SessionStore } from "../extension/vault-session.ts";
import { messageField } from "./wire.ts";

type StorageArea = Pick<chrome.storage.StorageArea, "get" | "set" | "remove" | "setAccessLevel">;

function decodeConnection(stored: unknown): Connection | undefined {
  const origin = messageField(stored, "origin");
  const anchor = messageField(stored, "anchor");
  const token = messageField(stored, "token");
  const expiresAt = messageField(stored, "expiresAt");
  const scope = vaultScope.safeParse(messageField(stored, "scope"));
  if (
    typeof origin !== "string" ||
    typeof anchor !== "string" ||
    typeof token !== "string" ||
    typeof expiresAt !== "number"
  )
    return undefined;
  return connectionOrigin(origin) && scope.success
    ? { origin, anchor, token, expiresAt, scope: scope.data }
    : undefined;
}

/** Keeps the session credential in session storage, readable only by trusted extension contexts. */
export function sessionStore(area: StorageArea): SessionStore {
  const access = area.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  return {
    async read() {
      await access;
      const { connection } = await area.get("connection");
      return decodeConnection(connection);
    },
    async write(connection) {
      await access;
      await area.set({ connection });
    },
    async forget(token) {
      await access;
      const { connection } = await area.get("connection");
      if (messageField(connection, "token") !== token) return false;
      await area.remove("connection");
      return true;
    },
    async clear() {
      await access;
      await area.remove("connection");
    },
  };
}
