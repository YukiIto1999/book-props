import type { BookRecord } from "../adapters/note-format/book-record.ts";
import type { BookWrite, ChangePlan } from "../core/catalog-core.ts";
import { optionalField } from "../shared/optional-field.ts";
import type { BookContext } from "./book-change.ts";
import type { Operation, Result, StoredBook } from "./catalog.ts";
import type { Commit } from "./rules.ts";

export class Refuse extends Error {
  readonly kind: "unavailable" | "conflict" | "notSaved";

  constructor(kind: Refuse["kind"]) {
    super(kind);
    this.kind = kind;
  }
}

export class CatalogChanged extends Error {}

export function assertUnchanged(
  before: ReadonlyMap<string, string>,
  now: ReadonlyMap<string, string>,
  targetBefore?: string,
  targetNow?: string,
): void {
  if (before.size !== now.size) throw new CatalogChanged();
  if (targetNow !== undefined && !now.has(targetNow)) throw new CatalogChanged();
  for (const [path, version] of before) {
    if (path === targetBefore) continue;
    if (path === targetNow || now.get(path) !== version) throw new CatalogChanged();
  }
}

/**
 * coreが書き込むと決めた計画と、それを立てたときに読んだ本ページの一覧。
 * `signal`と`hash`は呼び出し元の中断と購入の指紋を各段階へ引き継ぐ値で、ない場合も項目を持つ。
 */
export type Write = Readonly<{
  kind: "write";
  operation: Operation;
  signal: AbortSignal | undefined;
  hash: string | undefined;
  commit: Commit;
  fresh: readonly StoredBook[];
  versions: ReadonlyMap<string, string>;
  target?: StoredBook;
  plan: Extract<ChangePlan, { kind: "write" }>;
}>;
/** 書き込みを始めたか。始めた後の失敗は、保存されたかを確かめられない結果として返す。 */
export type WriteProgress = { started: boolean; change?: BookWrite };

/**
 * 購入の要求の指紋。保存済みの購入の記録はこの値を持つので、配列の項目と
 * `JSON.stringify`の書き方を変えると、更新の前後をまたいだ再確認を衝突と誤る。
 */
export async function inputHash(input: Operation): Promise<string> {
  const {
    title,
    authors,
    isbns,
    label,
    publisher,
    publishedOn,
    cover,
    purchasedOn,
    purchasedFrom,
  } = input.product;
  const stable = [
    input.action,
    input.purchase?.issuedAt,
    title,
    authors,
    isbns,
    label,
    publisher,
    publishedOn,
    cover,
    purchasedOn,
    purchasedFrom,
  ];
  if (input.selection) stable.push(input.selection.bookId, input.selection.editionId);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(stable)),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function hasPendingMove(entries: readonly StoredBook[]): boolean {
  return entries.some(({ book }) => book.pendingMove);
}

function savedAsPlanned(
  saved: BookRecord | undefined,
  step: Write,
  change: BookWrite | undefined,
): boolean {
  if (saved?.id !== step.plan.bookId || !change) return false;
  const { receipt, edition, wanted } = change;
  if (receipt) {
    return saved.appliedPurchases.some(
      (stored) =>
        stored.requestId === receipt.requestId &&
        stored.clientId === receipt.clientId &&
        stored.inputHash === receipt.inputHash,
    );
  }
  return (
    saved.wanted === wanted &&
    (!edition ||
      saved.editions.some(({ id, owned }) => id === edition.id && owned === edition.owned))
  );
}

export async function confirmedWrite(
  { files, notes }: Pick<BookContext, "files" | "notes">,
  path: string,
  step: Write,
  change: BookWrite | undefined,
): Promise<Result> {
  const saved = notes.readScoped(await files.read(path));
  if (!savedAsPlanned(saved, step, change)) return { kind: "unknown" };
  const { bookId, editionId } = step.plan;
  return { kind: "saved", bookId, ...optionalField("editionId", editionId) };
}
