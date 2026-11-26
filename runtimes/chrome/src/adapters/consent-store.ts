import type { ConsentRecord, ConsentStore } from "../extension/consent.ts";
import { messageField } from "./wire.ts";

type StorageArea = Pick<chrome.storage.StorageArea, "get" | "set" | "remove" | "onChanged">;

const key = "consent";

function decodeConsent(stored: unknown): ConsentRecord | undefined {
  const version = messageField(stored, "version");
  const at = messageField(stored, "at");
  return typeof version === "number" && typeof at === "number" ? { version, at } : undefined;
}

/** Keeps the consent record in local storage, which only trusted extension contexts can read. */
export function consentStore(area: StorageArea): ConsentStore {
  return {
    async read() {
      const { consent } = await area.get(key);
      return decodeConsent(consent);
    },
    async write(record) {
      await area.set({ [key]: record });
    },
    async clear() {
      await area.remove(key);
    },
    watch(changed) {
      area.onChanged.addListener((changes) => {
        if (Object.hasOwn(changes, key)) changed();
      });
    },
  };
}
