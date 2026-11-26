import {
  admits,
  allowsStep,
  calendarDate,
  checkPortableNotes,
  decodePortableLibrary,
  encodePortableLibrary,
  expiredReceipts,
  initSync,
  inspect,
  missingMoveCopies,
  normalizeIsbns,
  openShelf,
  planChange,
  planImport,
  planManagement,
  planMove,
  reconcile,
  settleShelf,
} from "../dist/wasm/book_props_vault.js";

/**
 * 本ページに保存するISBNが、重複のない正規のISBN-13か。本ページの読み取りが使う、coreの識別の規則。
 * `startCatalogCore`の後でだけ呼べる。
 */
export { isCanonicalIsbnList } from "../dist/wasm/book_props_vault.js";

export type {
  Action,
  Admission,
  Book,
  BooksRequest,
  BookStep,
  BookWrite,
  CatalogRequest,
  ChangePlan,
  ChangeRequest,
  CopiesRequest,
  CustomField,
  Edition,
  ExpiryRequest,
  FieldKey,
  ImportPlan,
  ImportRequest,
  IsbnList,
  ManagementCommand,
  ManagementPlan,
  ManagementRequest,
  MoveCopy,
  MoveMarker,
  MovePlan,
  MoveRequest,
  MoveStage,
  NewBook,
  NoteFacts,
  OpenShelf,
  Outcome,
  PortableExport,
  PortableNote,
  PortableNotes,
  PortableProblem,
  PresentNote,
  RangeKind,
  ReceiptExpiry,
  ReceiptWrite,
  ReconcileRequest,
  Reconciliation,
  SettledShelf,
  ShelfBound,
  ShelfField,
  ShelfQuery,
  ShelfRecord,
  ShelfRequest,
  ShelfTag,
  ShelfView,
  StepRequest,
} from "../dist/wasm/book_props_vault.js";

/** 目録の規則を判定するcore。Vaultの読み書き、乱数、時計は持たない。 */
export type CatalogCore = Readonly<{
  inspect: typeof inspect;
  normalizeIsbns: typeof normalizeIsbns;
  admits: typeof admits;
  planChange: typeof planChange;
  reconcile: typeof reconcile;
  expiredReceipts: typeof expiredReceipts;
  planManagement: typeof planManagement;
  allowsStep: typeof allowsStep;
  planMove: typeof planMove;
  settleShelf: typeof settleShelf;
  missingMoveCopies: typeof missingMoveCopies;
  calendarDate: typeof calendarDate;
  openShelf: typeof openShelf;
  decodePortableLibrary: typeof decodePortableLibrary;
  checkPortableNotes: typeof checkPortableNotes;
  encodePortableLibrary: typeof encodePortableLibrary;
  planImport: typeof planImport;
}>;

/**
 * coreを使える状態にする。本ページの読み取りもcoreのISBNの規則を使うので、本ページを読む前に
 * 一度呼ぶ。coreの本体は、このときに読み込む。
 */
export async function startCatalogCore(): Promise<CatalogCore> {
  // coreの本体はバンドラーだけがバイト列として読み込める。Nodeのテストが本ページの読み取りのために
  // このモジュールを読み込んでも、ここまでは読み込まないよう、静的な読み込みにしない。
  const { default: wasm } = await import("../dist/wasm/book_props_vault_bg.wasm");
  initSync({ module: wasm });
  return {
    inspect,
    normalizeIsbns,
    admits,
    planChange,
    reconcile,
    expiredReceipts,
    planManagement,
    allowsStep,
    planMove,
    settleShelf,
    missingMoveCopies,
    calendarDate,
    openShelf,
    decodePortableLibrary,
    checkPortableNotes,
    encodePortableLibrary,
    planImport,
  };
}
