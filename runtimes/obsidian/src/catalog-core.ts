import type { AppliedPurchase, EditionRecord } from "./book-note.ts";
import type { Operation, PurchaseKey, StoredBook } from "./catalog.ts";
import { optionalField } from "./optional-field.ts";
import type {
  Admission,
  Book,
  CatalogCore,
  CatalogRequest,
  ChangePlan,
  ChangeRequest,
  Edition,
  ExpiryRequest,
  IsbnList,
  Outcome,
  ReceiptExpiry,
  ReconcileRequest,
  Reconciliation,
} from "./wasm.ts";

/** 新しい本と版に付けるIDと、購入の記録に残す時刻。coreは乱数と時計を持たないので、ここで渡す。 */
export type Stamp = Readonly<{ now: number; newBookId: string; newEditionId: string }>;
/** 最初に読んだときに立てた計画の版。書き込む前に読み直した内容で、同じ版になるかを確かめる。 */
export type Commit = Stamp & Readonly<{ expected: string }>;

function catalogEdition({
  id,
  owned,
  isbns,
  label,
  archivedAt,
  ...details
}: EditionRecord): Edition {
  return {
    id,
    owned,
    isbns: [...isbns],
    ...optionalField("label", label),
    ...optionalField("archivedAt", archivedAt),
    details,
  };
}

function catalogBooks(entries: readonly StoredBook[]): Book[] {
  return entries.map(({ book }) => ({
    id: book.id,
    title: book.title,
    authors: [...book.authors],
    wanted: book.wanted,
    ...optionalField("archivedAt", book.archivedAt),
    editions: book.editions.map(catalogEdition),
    appliedPurchases: [...book.appliedPurchases],
    pendingMove: book.pendingMove !== undefined,
  }));
}

/** 目録の判定に渡す要求を、操作と書籍の保存範囲にある本から作る。 */
function catalogRequest(
  { action, product, selection }: Operation,
  entries: readonly StoredBook[],
): CatalogRequest {
  const { title, authors, isbns, label, ...details } = product;
  return {
    action,
    product: {
      ...optionalField("title", title),
      ...optionalField("authors", authors),
      ...optionalField("isbns", isbns),
      ...optionalField("label", label),
      details,
    },
    books: catalogBooks(entries),
    ...optionalField("selection", selection),
  };
}

/**
 * 目録の規則を判定するcoreへの要求を作って渡す。
 * 要求はJSONの文字列で渡す。本ごとに項目を変換して境界を越えるより、一度の解析のほうが速い。
 */
export class CatalogRules {
  private readonly core: CatalogCore;

  constructor(core: CatalogCore) {
    this.core = core;
  }

  inspect(operation: Operation, entries: readonly StoredBook[]): Outcome {
    return this.core.inspect(JSON.stringify(catalogRequest(operation, entries)));
  }

  normalizeIsbns(isbns: readonly string[]): IsbnList {
    return this.core.normalizeIsbns([...isbns]);
  }

  /** 目録を読む前に、操作を始めてよいか。購入には再確認を受け付ける期間内の要求IDがいる。 */
  admits({ action, purchase }: Operation): boolean {
    const request: Admission = { action, ...optionalField("purchase", purchase), now: Date.now() };
    return this.core.admits(JSON.stringify(request));
  }

  /** 読んだ目録で、書き込むか、結果を返すかを決める。`expected`がなければ最初の読み取り。 */
  plan(
    operation: Operation,
    entries: readonly StoredBook[],
    hash: string | undefined,
    commit: Stamp & Readonly<{ expected?: string }>,
  ): ChangePlan {
    const request: ChangeRequest = {
      catalog: catalogRequest(operation, entries),
      ...optionalField("purchase", operation.purchase),
      ...optionalField("inputHash", hash),
      ...commit,
    };
    return this.core.planChange(JSON.stringify(request));
  }

  reconcile(purchase: PurchaseKey, hash: string, entries: readonly StoredBook[]): Reconciliation {
    const request: ReconcileRequest = { purchase, inputHash: hash, books: catalogBooks(entries) };
    return this.core.reconcile(JSON.stringify(request));
  }

  /** 購入の記録ごとに、保持期間を過ぎたか。 */
  expired(receipts: readonly AppliedPurchase[], now: number): ReceiptExpiry["expired"] {
    const request: ExpiryRequest = { receipts: [...receipts], now };
    return this.core.expiredReceipts(JSON.stringify(request)).expired;
  }
}
