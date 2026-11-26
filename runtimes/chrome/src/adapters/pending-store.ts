import { request, vaultScope } from "@book-props/vault-contract";
import type { Pending, PendingStore } from "../extension/pending-purchase.ts";
import { messageField } from "./wire.ts";

type StorageArea = Pick<chrome.storage.StorageArea, "get" | "set" | "remove" | "setAccessLevel">;

function decodePending(stored: unknown): Pending | undefined {
  const origin = messageField(stored, "origin");
  const storedScope = messageField(stored, "scope");
  const scope = vaultScope.safeParse(storedScope);
  const parsed = request.safeParse(messageField(stored, "operation"));
  const operation = parsed.success ? parsed.data : undefined;
  if (typeof origin !== "string" || operation?.action !== "purchase") return undefined;
  if (storedScope === undefined) return { origin, operation };
  return scope.success ? { origin, scope: scope.data, operation } : undefined;
}

/** Keeps the pending purchase and the purchase client ID in local storage, out of reach of content scripts. */
export function pendingStore(area: StorageArea): PendingStore {
  const access = area.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  return {
    async read() {
      await access;
      const { pending, clientId } = await area.get(["pending", "clientId"]);
      return {
        pending: pending ? (decodePending(pending) ?? "unreadable") : undefined,
        clientId: typeof clientId === "string" ? clientId : undefined,
      };
    },
    async save(clientId, pending) {
      await access;
      await area.set({ clientId, pending });
    },
    async clear() {
      await access;
      await area.remove("pending");
    },
  };
}
