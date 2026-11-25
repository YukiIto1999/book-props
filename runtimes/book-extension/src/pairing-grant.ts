import {
  connectionFile,
  connectionOrigin,
  decodeConnectionCard,
  maxReplyBytes,
  pairingChallenge,
  pairingProofFile,
  vaultScope,
  type ConnectionCard,
} from "@book-props/vault-contract";
import { messageField } from "./messages.ts";

type Directory = FileSystemDirectoryHandle & {
  queryPermission(options: { mode: "readwrite" }): Promise<PermissionState>;
  requestPermission(options: { mode: "readwrite" }): Promise<PermissionState>;
};
declare global {
  interface Window {
    showDirectoryPicker?(options: { mode: "readwrite" }): Promise<FileSystemDirectoryHandle>;
  }
}
type Binding = Pick<ConnectionCard, "origin" | "scope" | "grantId">;
type Enrollment = { directory: Directory; binding: Binding };
type Slot = "selected" | "paired";
export type Grant = {
  binding: Binding;
  read(): Promise<ConnectionCard | undefined>;
  prove(anchor: string): Promise<string>;
};
export type Grants = {
  read(): Promise<Grant | undefined>;
  selected(id: string): Promise<Grant | undefined>;
  commit(id: string): Promise<boolean>;
  forget(): Promise<void>;
};

const mode = { mode: "readwrite" } as const;
let database: Promise<IDBDatabase> | undefined;

function access<T>(
  mode: IDBTransactionMode,
  work: (items: IDBObjectStore, complete: (value: T) => void) => void,
): Promise<T> {
  database ??= new Promise((resolve, reject) => {
    const open = indexedDB.open("connection-grant", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("pairing");
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
  return database.then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction("pairing", mode);
        let completed: T;
        tx.oncomplete = () => resolve(completed);
        tx.onabort = () => reject(tx.error);
        work(tx.objectStore("pairing"), (value) => (completed = value));
      }),
  );
}

function isDirectoryHandle(value: unknown): value is Directory {
  return (
    value instanceof FileSystemDirectoryHandle &&
    "queryPermission" in value &&
    typeof value.queryPermission === "function" &&
    "requestPermission" in value &&
    typeof value.requestPermission === "function"
  );
}

function enrollment(value: unknown): Enrollment | undefined {
  const directory = messageField(value, "directory");
  const binding = messageField(value, "binding");
  const origin = messageField(binding, "origin");
  const grantId = messageField(binding, "grantId");
  const scope = vaultScope.safeParse(messageField(binding, "scope"));
  if (
    isDirectoryHandle(directory) &&
    typeof origin === "string" &&
    connectionOrigin(origin) &&
    typeof grantId === "string" &&
    scope.success
  )
    return { directory, binding: { origin, grantId, scope: scope.data } };
  return undefined;
}

function stored(slot: Slot): Promise<Enrollment | undefined> {
  return access("readonly", (items, complete) => {
    const lookup = items.get(slot);
    lookup.onsuccess = () => complete(enrollment(lookup.result));
  });
}

async function readCard(directory: Directory): Promise<ConnectionCard | undefined> {
  if ((await directory.queryPermission(mode)) !== "granted") return undefined;
  const handle = await directory.getFileHandle(connectionFile);
  const file = await handle.getFile();
  if (file.size <= maxReplyBytes) return decodeConnectionCard(await file.text());
  return undefined;
}

function grant(enrollment: Enrollment): Grant {
  const { binding, directory } = enrollment;
  return {
    binding,
    async read() {
      const card = await readCard(directory).catch(() => undefined);
      return card?.grantId === binding.grantId &&
        card.origin === binding.origin &&
        card.scope === binding.scope
        ? card
        : undefined;
    },
    async prove(anchor) {
      const code = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))))
        .replace(/=/g, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_");
      const bytes = new TextEncoder().encode(pairingChallenge(anchor, code));
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      bytes.fill(0);
      const handle = await directory.getFileHandle(pairingProofFile, { create: true });
      const stream = await handle.createWritable();
      try {
        const hex = Array.from(new Uint8Array(digest), (byte) =>
          byte.toString(16).padStart(2, "0"),
        );
        await stream.write(hex.join(""));
        await stream.close();
      } catch (error) {
        await stream.abort().catch(() => undefined);
        throw error;
      }
      return code;
    },
  };
}

export const chromeGrants: Grants = {
  async read() {
    const entry = await stored("paired");
    return entry && grant(entry);
  },
  async selected(id) {
    const entry = await stored("selected");
    return entry?.binding.grantId === id ? grant(entry) : undefined;
  },
  commit(id) {
    return access("readwrite", (items, complete) => {
      const lookup = items.get("selected");
      lookup.onsuccess = () => {
        const entry = enrollment(lookup.result);
        if (entry?.binding.grantId !== id) return complete(false);
        items.put(entry, "paired");
        items.delete("selected");
        complete(true);
      };
    });
  },
  forget() {
    return access("readwrite", (items, complete) => {
      items.clear();
      complete(undefined);
    });
  },
};

export async function selectConnectionDirectory(): Promise<string | undefined> {
  const directory = await window.showDirectoryPicker?.(mode);
  if (!isDirectoryHandle(directory)) return undefined;
  const card = await readCard(directory);
  if (!card) return undefined;
  const { grantId, origin, scope } = card;
  await access("readwrite", (items, complete) => {
    items.put({ directory, binding: { grantId, origin, scope } } satisfies Enrollment, "selected");
    complete(undefined);
  });
  return grantId;
}

export async function restoreDirectoryPermission(): Promise<PermissionState> {
  const entry = await stored("paired");
  return entry ? entry.directory.requestPermission(mode) : "denied";
}
