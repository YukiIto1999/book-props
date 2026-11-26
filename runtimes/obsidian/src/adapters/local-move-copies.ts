import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative, sep } from "node:path";
import type { MoveCopies, MoveCopy } from "../catalog/ports.ts";
import { isJsonObject } from "../shared/json-object.ts";

const editionId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function moveCopyDirectory(vault: string, folder: string): string {
  const configured =
    process.platform === "win32" ? process.env.LOCALAPPDATA : process.env.XDG_DATA_HOME;
  const fallback =
    process.platform === "win32"
      ? join(homedir(), "AppData", "Local")
      : process.platform === "darwin"
        ? join(homedir(), "Library", "Application Support")
        : join(homedir(), ".local", "share");
  const root = configured && isAbsolute(configured) ? configured : fallback;
  if (!isAbsolute(root) || !isAbsolute(vault))
    throw new Error("版の控えの保存先を確定できません。");
  const scope = createHash("sha256")
    .update(JSON.stringify([vault, folder]))
    .digest("hex");
  const directory = join(root, "BookProps", "edition-moves", scope);
  const fromVault = relative(vault, directory);
  if (!isAbsolute(fromVault) && fromVault !== ".." && !fromVault.startsWith(`..${sep}`))
    throw new Error("版の控えをVaultの外に保存できません。");
  return directory;
}

function decode(raw: string, id: string): MoveCopy {
  const value: unknown = JSON.parse(raw);
  if (!isJsonObject(value)) throw new Error("版の控えを読み取れません。");
  const { sourceId, destinationId, snapshot } = value;
  if (
    value.editionId !== id ||
    typeof sourceId !== "string" ||
    !editionId.test(sourceId) ||
    typeof destinationId !== "string" ||
    !editionId.test(destinationId) ||
    sourceId === destinationId ||
    typeof snapshot !== "string"
  )
    throw new Error("版の控えの形式が正しくありません。");
  return { editionId: id, sourceId, destinationId, snapshot };
}

export class LocalMoveCopies implements MoveCopies {
  private readonly directory: () => string;

  constructor(directory: () => string) {
    this.directory = directory;
  }

  async keep(copy: MoveCopy): Promise<void> {
    if (!editionId.test(copy.editionId)) throw new Error("控えにする版のIDが正しくありません。");
    const folder = this.directory();
    await mkdir(folder, { recursive: true, mode: 0o700 });
    const temporaryPath = join(folder, `${randomUUID()}.tmp`);
    const file = await open(temporaryPath, "wx", 0o600);
    try {
      try {
        await file.writeFile(JSON.stringify(copy), "utf8");
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temporaryPath, join(folder, `${copy.editionId}.json`));
    } catch (error: unknown) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async list(): Promise<readonly MoveCopy[]> {
    const folder = this.directory();
    let filenames: string[];
    try {
      filenames = await readdir(folder);
    } catch (error: unknown) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
      throw error;
    }
    const copies: MoveCopy[] = [];
    for (const name of filenames.sort()) {
      if (!name.endsWith(".json")) continue;
      const id = name.slice(0, -5);
      if (!editionId.test(id)) continue;
      copies.push(decode(await readFile(join(folder, name), "utf8"), id));
    }
    return copies;
  }
}
