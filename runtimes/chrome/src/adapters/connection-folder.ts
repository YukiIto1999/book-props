import type { ConnectionFolder, FolderChoice } from "../extension/options.ts";
import {
  access,
  isDirectoryHandle,
  readCard,
  readwrite,
  stored,
  type Enrollment,
} from "./folder-records.ts";

declare global {
  interface Window {
    showDirectoryPicker?(options: { mode: "readwrite" }): Promise<FileSystemDirectoryHandle>;
  }
}

async function selectConnectionDirectory(): Promise<string | undefined> {
  const directory = await window.showDirectoryPicker?.(readwrite);
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

/** The connection folder through the File System Access API, for the extension pages. */
export const connectionFolder: ConnectionFolder = {
  async permission() {
    const entry = await stored("paired");
    return entry?.directory.queryPermission(readwrite);
  },
  async select(): Promise<FolderChoice> {
    try {
      const grantId = await selectConnectionDirectory();
      return grantId ? { kind: "selected", grantId } : { kind: "notConnectionFolder" };
    } catch (error) {
      const name = error instanceof DOMException ? error.name : undefined;
      if (name === "AbortError") return { kind: "cancelled" };
      if (name === "NotAllowedError" || name === "SecurityError") return { kind: "denied" };
      return { kind: "failed" };
    }
  },
  async restore() {
    const entry = await stored("paired");
    return entry ? entry.directory.requestPermission(readwrite) : "denied";
  },
};
