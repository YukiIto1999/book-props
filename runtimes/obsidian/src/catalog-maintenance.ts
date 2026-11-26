import type { BookContext } from "./book-change.ts";
import { readScopedNote, removePurchases, type AppliedPurchase } from "./book-note.ts";
import { assertUnchanged, CatalogChanged, Refuse } from "./catalog-purchase.ts";
import { readEntry, readStable } from "./catalog-read.ts";
import type { StoredBook } from "./catalog.ts";
import type { PortableNote } from "./portable-library.ts";

export type ImportResult = {
  status: "saved" | "pending" | "conflict" | "unavailable";
  count: number;
};

function importSnapshot(context: BookContext, wanted: ReadonlyMap<string, string>) {
  return readStable(context.files, async (versions) => {
    const present = new Set<string>();
    for (const path of versions.keys()) {
      const markdown = await context.files.read(path);
      const book = readEntry(path, markdown);
      if (!book) continue;
      if (book.pendingMove || present.has(book.id) || wanted.get(book.id) !== markdown)
        throw new Refuse("conflict");
      present.add(book.id);
    }
    return present;
  });
}

function onlyCreated(
  previous: ReadonlyMap<string, string>,
  next: ReadonlyMap<string, string>,
  created: string,
): boolean {
  if (previous.has(created) || !next.has(created) || next.size !== previous.size + 1) return false;
  for (const [path, version] of previous) if (next.get(path) !== version) return false;
  return true;
}

async function unchangedOrRescan(
  snapshot: Awaited<ReturnType<typeof importSnapshot>>,
  context: BookContext,
  wanted: ReadonlyMap<string, string>,
) {
  try {
    assertUnchanged(snapshot.versions, context.files.versions());
    return snapshot;
  } catch (error: unknown) {
    if (!(error instanceof CatalogChanged)) throw error;
    return importSnapshot(context, wanted);
  }
}

async function includeCreated(
  context: BookContext,
  snapshot: Awaited<ReturnType<typeof importSnapshot>>,
  id: string,
  path: string,
  markdown: string,
) {
  const versions = context.files.versions();
  if ((await context.files.read(path)) !== markdown) throw new Refuse("unavailable");
  if (!onlyCreated(snapshot.versions, versions, path)) return snapshot;
  snapshot.value.add(id);
  return { value: snapshot.value, versions };
}

/**
 * 入出力の記録にある本ページを、まだない本だけ作る。
 * すでにある本は内容が同じときだけ受け入れ、異なる本や移動中の本があれば何も作らない。
 */
export async function importNotes(
  context: BookContext,
  desired: readonly PortableNote[],
): Promise<ImportResult> {
  if (!context.active()) return { status: "unavailable", count: 0 };
  const wanted = new Map(desired.map((note) => [note.bookId, note.markdown]));
  let count = 0;
  let started = false;
  try {
    let snapshot = await importSnapshot(context, wanted);
    for (const [id, markdown] of wanted) {
      snapshot = await unchangedOrRescan(snapshot, context, wanted);
      if (!context.active()) return { status: started ? "pending" : "unavailable", count };
      assertUnchanged(snapshot.versions, context.files.versions());
      if (snapshot.value.has(id)) continue;
      started = true;
      const path = await context.files.create(id, markdown);
      count++;
      snapshot = await includeCreated(context, snapshot, id, path, markdown);
    }
    snapshot = await unchangedOrRescan(snapshot, context, wanted);
    assertUnchanged(snapshot.versions, context.files.versions());
    return { status: snapshot.value.size === wanted.size ? "saved" : "pending", count };
  } catch (error: unknown) {
    return { status: !started && error instanceof Refuse ? "conflict" : "pending", count };
  }
}

/**
 * 保存期間を過ぎた適用済み購入の記録だけを取り除く。書き換えられない本は次の機会に回す。
 * @param expired - 購入の記録ごとに、保存期間を過ぎたかを返す判定
 */
export async function pruneReceipts(
  context: BookContext,
  entries: readonly StoredBook[],
  expired: (receipts: readonly AppliedPurchase[]) => readonly boolean[],
): Promise<void> {
  for (const { path, book } of entries) {
    if (!context.active()) break;
    if (!expired(book.appliedPurchases).includes(true)) continue;
    await context.files
      .process(path, (raw, currentPath) => {
        const current = readScopedNote(raw);
        const writable = context.active() && context.files.canUpdate(currentPath, raw);
        if (!writable || current?.id !== book.id || current.pendingMove)
          throw new Refuse("unavailable");
        return removePurchases(raw, expired);
      })
      .catch(() => undefined);
  }
}
