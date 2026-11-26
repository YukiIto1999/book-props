import { readScopedNote, type BookRecord } from "./book-note.ts";
import type { CatalogRules } from "./catalog-core.ts";
import type { BookFiles, StoredBook } from "./catalog.ts";
import type { BookStep } from "./wasm.ts";

/** 書籍の保存範囲の本ページを読み書きする手段、判定するcore、操作を受け付けているか。 */
export type BookContext = Readonly<{
  files: BookFiles;
  rules: CatalogRules;
  active: () => boolean;
}>;
/** 一つの管理操作で読んだ本とその版。版の移動を書き始めた後の失敗は、保留として返す。 */
export type Scope = Readonly<{
  context: BookContext;
  source: StoredBook;
  entries: readonly StoredBook[];
  versions: ReadonlyMap<string, string>;
  progress: { moveStarted: boolean };
}>;

export class Stop extends Error {
  readonly reason: "conflict" | "unavailable";

  constructor(reason: Stop["reason"]) {
    super(reason);
    this.reason = reason;
  }
}

/**
 * 本ページの最新の内容が同じ本で、利用者が編集中でなく、coreがその内容に変更を認めるときだけ
 * 書き換える。
 */
export async function change(
  context: BookContext,
  entry: StoredBook,
  step: BookStep,
  update: (raw: string, book: BookRecord) => string,
): Promise<string> {
  return context.files.process(entry.path, (raw, currentPath) => {
    if (!context.active() || !context.files.canUpdate(currentPath, raw))
      throw new Stop("unavailable");
    const latest = readScopedNote(raw);
    if (latest?.id !== entry.book.id || !context.rules.allows(latest, step))
      throw new Stop("conflict");
    return update(raw, latest);
  });
}
