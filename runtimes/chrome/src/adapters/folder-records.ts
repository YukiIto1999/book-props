import {
  connectionFile,
  connectionOrigin,
  decodeConnectionCard,
  maxReplyBytes,
  vaultScope,
  type ConnectionCard,
} from "@book-props/vault-contract";
import { messageField } from "./wire.ts";

// The connection folder handle and the card it held, kept in IndexedDB because only it can store handles.
export type Directory = FileSystemDirectoryHandle & {
  queryPermission(options: { mode: "readwrite" }): Promise<PermissionState>;
  requestPermission(options: { mode: "readwrite" }): Promise<PermissionState>;
};
type Binding = Pick<ConnectionCard, "origin" | "scope" | "grantId">;
export type Enrollment = { directory: Directory; binding: Binding };
/** "selected" holds the folder the user just picked; pairing moves it to "paired". */
type Slot = "selected" | "paired";

export const readwrite = { mode: "readwrite" } as const;
let database: Promise<IDBDatabase> | undefined;

export function access<T>(
  mode: IDBTransactionMode,
  work: (items: IDBObjectStore, complete: (value: T) => void) => void,
): Promise<T> {
  database ??= new Promise((resolve, reject) => {
    const open = indexedDB.open("connection-grant", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("pairing");
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error ?? new Error("IndexedDB を開けませんでした。"));
  });
  return database.then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction("pairing", mode);
        let completed: T;
        tx.oncomplete = () => resolve(completed);
        tx.onabort = () => reject(tx.error ?? new Error("IndexedDB の処理が中断されました。"));
        work(tx.objectStore("pairing"), (value) => (completed = value));
      }),
  );
}

export function isDirectoryHandle(value: unknown): value is Directory {
  return (
    value instanceof FileSystemDirectoryHandle &&
    "queryPermission" in value &&
    typeof value.queryPermission === "function" &&
    "requestPermission" in value &&
    typeof value.requestPermission === "function"
  );
}

export function enrollment(value: unknown): Enrollment | undefined {
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

export function stored(slot: Slot): Promise<Enrollment | undefined> {
  return access("readonly", (items, complete) => {
    const lookup = items.get(slot);
    lookup.onsuccess = () => complete(enrollment(lookup.result));
  });
}

export async function readCard(directory: Directory): Promise<ConnectionCard | undefined> {
  if ((await directory.queryPermission(readwrite)) !== "granted") return undefined;
  const handle = await directory.getFileHandle(connectionFile).catch((error: unknown) => {
    if (error instanceof DOMException && error.name === "NotFoundError") return undefined;
    throw error;
  });
  if (!handle) return undefined;
  const file = await handle.getFile();
  if (file.size <= maxReplyBytes) return decodeConnectionCard(await file.text());
  return undefined;
}
