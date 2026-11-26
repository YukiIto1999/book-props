import type { Management } from "./book-management.ts";
import type {
  AppliedPurchase,
  BookRecord,
  BookUpdate,
  CustomField,
  EditionRecord,
  PendingMove,
} from "./book-note.ts";
import { readEditionBackup } from "./book-note-parse.ts";
import type { Operation, PurchaseKey, StoredBook } from "./catalog.ts";
import { optionalField } from "./optional-field.ts";
import type {
  Admission,
  Book,
  BooksRequest,
  BookStep,
  BookWrite,
  CatalogCore,
  CatalogRequest,
  ChangePlan,
  ChangeRequest,
  CopiesRequest,
  CustomField as WireField,
  Edition,
  ExpiryRequest,
  ImportPlan,
  ImportRequest,
  IsbnList,
  ManagementCommand,
  ManagementPlan,
  ManagementRequest,
  MoveCopy as SavedCopy,
  MoveMarker,
  MovePlan,
  MoveRequest,
  NewBook,
  Outcome,
  PortableNote,
  PresentNote,
  ReceiptExpiry,
  ReceiptWrite,
  ReconcileRequest,
  Reconciliation,
  SettledShelf,
  StepRequest,
} from "./wasm.ts";

/** 新しい本と版に付けるIDと、購入の記録に残す時刻。coreは乱数と時計を持たないので、ここで渡す。 */
export type Stamp = Readonly<{ now: number; newBookId: string; newEditionId: string }>;
/** 最初に読んだときに立てた計画の版。書き込む前に読み直した内容で、同じ版になるかを確かめる。 */
export type Commit = Stamp & Readonly<{ expected: string }>;

export function catalogEdition({
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

/** coreが書くと決めた版を、本ページに書く版の形に戻す。 */
export function recordEdition({ details, ...edition }: Edition): EditionRecord {
  return { ...edition, ...details };
}

/** 本の移動記録。控えがあれば、YAMLとして読んだ版を添える。 */
export function catalogMarker({
  editionId,
  destinationId,
  digest,
  backup,
}: PendingMove): MoveMarker {
  const recorded =
    backup === undefined
      ? undefined
      : { signature: backup, edition: catalogEdition(readEditionBackup(backup).edition) };
  return { editionId, destinationId, digest, ...optionalField("backup", recorded) };
}

export function catalogField(field: CustomField): WireField {
  return field.kind === "choice" ? { ...field, choices: [...field.choices] } : { ...field };
}

function catalogBook(book: BookRecord): Book {
  return {
    id: book.id,
    title: book.title,
    authors: [...book.authors],
    wanted: book.wanted,
    ...optionalField("archivedAt", book.archivedAt),
    editions: book.editions.map(catalogEdition),
    appliedPurchases: [...book.appliedPurchases],
    ...optionalField("pendingMove", book.pendingMove && catalogMarker(book.pendingMove)),
    customFields: (book.customFields ?? []).map(catalogField),
  };
}

function catalogBooks(entries: readonly StoredBook[]): Book[] {
  return entries.map(({ book }) => catalogBook(book));
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

function managementCommand(command: Management): ManagementCommand {
  switch (command.action) {
    case "editEdition":
      return {
        ...command,
        baseline: catalogEdition(command.baseline),
        value: catalogEdition(command.value),
      };
    case "addEdition":
      return { ...command, value: catalogEdition(command.value) };
    case "updateCustomField":
      return {
        action: command.action,
        bookId: command.bookId,
        ...optionalField("baseline", command.baseline && catalogField(command.baseline)),
        ...optionalField("value", command.value && catalogField(command.value)),
      };
    default:
      return command;
  }
}

function appliedPurchase({ appliedAtMs, ...receipt }: ReceiptWrite): AppliedPurchase {
  return { ...receipt, appliedAt: new Date(appliedAtMs).toISOString() };
}

/** coreが立てた書き込みを、本ページに書く値にする。時刻の書き方は本ページの形式が決める。 */
export function bookUpdate({ wanted, edition, receipt }: BookWrite): BookUpdate {
  return {
    wanted,
    ...optionalField("edition", edition),
    ...optionalField("receipt", receipt && appliedPurchase(receipt)),
  };
}

export function newBookRecord(book: NewBook): BookRecord {
  return { ...book, appliedPurchases: book.appliedPurchases.map(appliedPurchase) };
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

  calendarDate(value: string): string | undefined {
    return this.core.calendarDate(value);
  }

  /** 入出力の記録を、書籍の保存範囲のいまの本ページへ取り込めるか。作る本は記録の順に返す。 */
  planImport(desired: readonly PortableNote[], present: readonly PresentNote[]): ImportPlan {
    const request: ImportRequest = { desired: [...desired], present: [...present] };
    return this.core.planImport(JSON.stringify(request));
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

  /** 購入の記録ごとに、保持期間を過ぎたか。読めない時刻の記録は残す。 */
  expired(receipts: readonly AppliedPurchase[], now: number): ReceiptExpiry["expired"] {
    const appliedAtMs = receipts.map(({ appliedAt }) => {
      const at = Date.parse(appliedAt);
      return Number.isNaN(at) ? null : at;
    });
    const request: ExpiryRequest = { appliedAtMs, now };
    return this.core.expiredReceipts(JSON.stringify(request)).expired;
  }

  /** 管理の操作が、読んだ本でどうなるか。アーカイブの時刻はここで時計から渡す。 */
  manage(command: Management, entries: readonly StoredBook[], copy?: SavedCopy): ManagementPlan {
    const request: ManagementRequest = {
      command: managementCommand(command),
      books: catalogBooks(entries),
      stamp: new Date().toISOString(),
      ...optionalField("copy", copy),
    };
    return this.core.planManagement(JSON.stringify(request));
  }

  /** 本ページの最新の内容に、この変更を書いてよいか。 */
  allows(latest: BookRecord, step: BookStep): boolean {
    const request: StepRequest = { latest: catalogBook(latest), step };
    return this.core.allowsStep(JSON.stringify(request));
  }

  /** 移動元に記録された版の移動を、どこから続けるか。 */
  resume(entries: readonly StoredBook[], source: BookRecord, latest: BookRecord): MovePlan {
    const request: MoveRequest = {
      books: catalogBooks(entries),
      source: catalogBook(source),
      latest: catalogBook(latest),
    };
    return this.core.planMove(JSON.stringify(request));
  }

  /** 移動が終わるまで、本棚でどの本の版の見せ方を変えるか。 */
  settle(entries: readonly StoredBook[]): SettledShelf {
    const request: BooksRequest = { books: catalogBooks(entries) };
    return this.core.settleShelf(JSON.stringify(request));
  }

  /** Vaultの外に控えた版ごとに、どの本にも見当たらないか。 */
  missing(entries: readonly StoredBook[], editionIds: readonly string[]): boolean[] {
    const request: CopiesRequest = { books: catalogBooks(entries), editionIds: [...editionIds] };
    return this.core.missingMoveCopies(JSON.stringify(request)).missing;
  }
}
