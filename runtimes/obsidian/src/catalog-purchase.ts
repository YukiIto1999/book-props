import {
  createBookNote,
  readScopedNote,
  type AppliedPurchase,
  type BookRecord,
  type BookUpdate,
  type EditionRecord,
} from "./book-note.ts";
import type {
  Action,
  BookFiles,
  Operation,
  Outcome,
  Product,
  PurchaseKey,
  Result,
  StoredBook,
} from "./catalog.ts";
import { optionalField } from "./optional-field.ts";

const retryWindow = 24 * 60 * 60 * 1000;
/** 適用済み購入の記録を、再確認を受け付ける期間を過ぎても残す期間。 */
export const receiptRetention = 7 * retryWindow;
const keyPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

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
 * 書き込むと決めた判定と、書き込む本・版・購入の記録。
 * `signal`と`hash`は呼び出し元の中断と購入の指紋を各段階へ引き継ぐ値で、ない場合も項目を持つ。
 */
export type Write = Readonly<{
  kind: "write";
  operation: Operation;
  signal: AbortSignal | undefined;
  hash: string | undefined;
  expected: string;
  fresh: readonly StoredBook[];
  versions: ReadonlyMap<string, string>;
  outcome: Outcome;
  target?: StoredBook;
  bookId: string;
  newRecord?: EditionRecord;
  editionId?: string;
  receipt?: AppliedPurchase;
}>;
type Basis = Omit<Write, "kind" | "target" | "bookId" | "newRecord" | "editionId" | "receipt">;
/** 書き込みを始めたか。始めた後の失敗は、保存されたかを確かめられない結果として返す。 */
export type WriteProgress = { started: boolean; change?: BookUpdate };
type UpdatePlan = Extract<Outcome["decision"], { kind: "addEdition" | "update" }>;

export function validKey(key: PurchaseKey): boolean {
  const age = Date.now() - key.issuedAt;
  return (
    keyPattern.test(key.clientId) &&
    keyPattern.test(key.requestId) &&
    Number.isSafeInteger(key.issuedAt) &&
    age >= 0 &&
    age <= retryWindow
  );
}

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

/** 同じ要求がすでに適用されていれば、その結果を返す。要求の内容が異なれば衝突とする。 */
export function replayOf(
  entries: readonly StoredBook[],
  purchase: PurchaseKey | undefined,
  hash: string | undefined,
): Result | undefined {
  if (!purchase || !hash) return undefined;
  let found: AppliedPurchase | undefined;
  for (const entry of entries) {
    const receipt = entry.book.appliedPurchases.find(
      ({ clientId, requestId }) =>
        clientId === purchase.clientId && requestId === purchase.requestId,
    );
    if (!receipt) continue;
    if (found || receipt.inputHash !== hash) return { kind: "conflict" };
    found = receipt;
  }
  return found ? { kind: "replayed", bookId: found.bookId, editionId: found.editionId } : undefined;
}

export function hasPendingMove(entries: readonly StoredBook[]): boolean {
  return entries.some(({ book }) => book.pendingMove);
}

/** 書き込む直前の判定が、利用者に確かめた判定から変わっていないかを比べるための値。 */
export function revision(action: Action, outcome: Outcome): string {
  const { decision, bookId, editionId } = outcome;
  const targetEdition = action === "setWish" || action === "clearWish" ? null : editionId;
  const wish =
    action === "purchase" || action === "setWish" || action === "clearWish" ? outcome.wanted : null;
  const ownership = decision.kind === "update" ? decision.ownedBefore : null;
  return JSON.stringify([decision.kind, bookId, targetEdition, wish, ownership]);
}

function newEdition(product: Product, isbns: string[], editionId: string): EditionRecord {
  return {
    id: editionId,
    owned: true,
    isbns,
    ...optionalField("label", product.label || undefined),
    ...optionalField("publisher", product.publisher || undefined),
    ...optionalField("publishedOn", product.publishedOn || undefined),
    ...optionalField("cover", product.cover || undefined),
    ...optionalField("purchasedOn", product.purchasedOn || undefined),
    ...optionalField("purchasedFrom", product.purchasedFrom || undefined),
  };
}

export function planWrite(basis: Basis): Write {
  const { operation, hash, outcome, fresh } = basis;
  const { decision } = outcome;
  const target = fresh.find(({ book }) => book.id === outcome.bookId);
  const bookId = target?.book.id ?? crypto.randomUUID();
  const addsEdition =
    (decision.kind === "createBook" && decision.recordEdition) || decision.kind === "addEdition";
  const newRecord = addsEdition
    ? newEdition(operation.product, outcome.isbns, crypto.randomUUID())
    : undefined;
  const ownsEdition = decision.kind === "update" && decision.ownedAfter !== undefined;
  const editionId = newRecord?.id ?? (ownsEdition ? (outcome.editionId ?? undefined) : undefined);
  const { purchase } = operation;
  const receipt =
    purchase && hash && editionId
      ? {
          requestId: purchase.requestId,
          clientId: purchase.clientId,
          inputHash: hash,
          appliedAt: new Date().toISOString(),
          bookId,
          editionId,
        }
      : undefined;
  return {
    ...basis,
    kind: "write",
    bookId,
    ...optionalField("target", target),
    ...optionalField("newRecord", newRecord),
    ...optionalField("editionId", editionId),
    ...optionalField("receipt", receipt),
  };
}

/** 書き込む購入希望と、あれば版と購入の記録。 */
export function bookChange(
  wanted: boolean,
  edition: EditionRecord | undefined,
  receipt: AppliedPurchase | undefined,
): BookUpdate {
  return { wanted, ...optionalField("edition", edition), ...optionalField("receipt", receipt) };
}

export function newBookNote(
  { operation: { product }, bookId, newRecord, receipt }: Write,
  wanted: boolean,
): string {
  return createBookNote({
    id: bookId,
    title: product.title?.trim() ?? "",
    authors: product.authors ?? [],
    wanted,
    editions: newRecord ? [newRecord] : [],
    appliedPurchases: receipt ? [receipt] : [],
  });
}

/** 既存の版の所持を変える判定では、空欄だけを補った版を返す。版を足す判定では新しい版を返す。 */
export function updatedEdition(
  step: Write,
  plan: UpdatePlan,
  latest: BookRecord,
): EditionRecord | undefined {
  if (plan.kind !== "update" || plan.ownedAfter === undefined) return step.newRecord;
  const old = latest.editions.find(({ id }) => id === step.editionId);
  if (!old) throw new Refuse("conflict");
  const patch = plan.editionPatch;
  const isbns = patch?.isbns?.length ? [...old.isbns, ...patch.isbns] : old.isbns;
  return { ...patch, id: old.id, owned: plan.ownedAfter, isbns };
}

function savedAsPlanned(
  saved: BookRecord | undefined,
  step: Write,
  change: BookUpdate | undefined,
): boolean {
  if (saved?.id !== step.bookId || !change) return false;
  const { receipt } = step;
  if (receipt) {
    return saved.appliedPurchases.some(
      (stored) =>
        stored.requestId === receipt.requestId &&
        stored.clientId === receipt.clientId &&
        stored.inputHash === receipt.inputHash,
    );
  }
  const { edition, wanted } = change;
  return (
    saved.wanted === wanted &&
    (!edition ||
      saved.editions.some(({ id, owned }) => id === edition.id && owned === edition.owned))
  );
}

export async function confirmedWrite(
  files: BookFiles,
  path: string,
  step: Write,
  change: BookUpdate | undefined,
): Promise<Result> {
  const saved = readScopedNote(await files.read(path));
  if (!savedAsPlanned(saved, step, change)) return { kind: "unknown" };
  return { kind: "saved", bookId: step.bookId, ...optionalField("editionId", step.editionId) };
}
