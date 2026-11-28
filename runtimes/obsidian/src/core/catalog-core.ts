import wasm from "../../dist/wasm/book_props_vault_bg.wasm";
import {
  admits,
  allowsStep,
  bookOptions,
  calendarDate,
  checkPortableNotes,
  decodePortableLibrary,
  describeRecord,
  encodePortableLibrary,
  expiredReceipts,
  initSync,
  inspect,
  isCanonicalIsbnList,
  missingMoveCopies,
  ndcClasses,
  ndcSection,
  ndcSubsection,
  normalizeIsbns,
  openShelf,
  planChange,
  planEnrichment,
  planImport,
  planManagement,
  planMove,
  planReview,
  reconcile,
  restoreTargets,
  settleShelf,
} from "../../dist/wasm/book_props_vault.js";

export type {
  Action,
  Admission,
  BibliographyRequest,
  BibliographyRevision,
  Book,
  BookOptions,
  BooksRequest,
  BookStep,
  BookWrite,
  CatalogRequest,
  CatalogueRecord,
  ChangePlan,
  ChangeRequest,
  CopiesRequest,
  CustomField,
  DescribedRecord,
  Edition,
  EditionOptions,
  EnrichmentPlan,
  ExpiryRequest,
  FieldKey,
  ImportPlan,
  ImportRequest,
  IsbnList,
  LookupAnswer,
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
  OptionsRequest,
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
  RestoreRequest,
  SettledShelf,
  ShelfBound,
  ShelfField,
  ShelfQuery,
  ShelfRecord,
  ShelfRequest,
  ShelfTag,
  ShelfView,
  StepRequest,
} from "../../dist/wasm/book_props_vault.js";

/**
 * 目録の規則を判定するcore。Vaultの読み書き、乱数、時計は持たない。
 * 使う側はこの値を受け取って呼び、coreの本体を自分では読み込まない。
 */
export type CatalogCore = Readonly<{
  inspect: typeof inspect;
  normalizeIsbns: typeof normalizeIsbns;
  isCanonicalIsbnList: typeof isCanonicalIsbnList;
  admits: typeof admits;
  planChange: typeof planChange;
  reconcile: typeof reconcile;
  expiredReceipts: typeof expiredReceipts;
  planManagement: typeof planManagement;
  allowsStep: typeof allowsStep;
  bookOptions: typeof bookOptions;
  planMove: typeof planMove;
  settleShelf: typeof settleShelf;
  missingMoveCopies: typeof missingMoveCopies;
  restoreTargets: typeof restoreTargets;
  calendarDate: typeof calendarDate;
  openShelf: typeof openShelf;
  decodePortableLibrary: typeof decodePortableLibrary;
  checkPortableNotes: typeof checkPortableNotes;
  encodePortableLibrary: typeof encodePortableLibrary;
  planImport: typeof planImport;
  describeRecord: typeof describeRecord;
  planEnrichment: typeof planEnrichment;
  planReview: typeof planReview;
  ndcSection: typeof ndcSection;
  ndcSubsection: typeof ndcSubsection;
  ndcClasses: typeof ndcClasses;
}>;

/** バンドルに埋め込んだcoreの本体を読み込み、使える状態にして返す。プラグインの起動で一度だけ呼ぶ。 */
export function startCatalogCore(): CatalogCore {
  initSync({ module: wasm });
  return {
    inspect,
    normalizeIsbns,
    isCanonicalIsbnList,
    admits,
    planChange,
    reconcile,
    expiredReceipts,
    planManagement,
    allowsStep,
    bookOptions,
    planMove,
    settleShelf,
    missingMoveCopies,
    restoreTargets,
    calendarDate,
    openShelf,
    decodePortableLibrary,
    checkPortableNotes,
    encodePortableLibrary,
    planImport,
    describeRecord,
    planEnrichment,
    planReview,
    ndcSection,
    ndcSubsection,
    ndcClasses,
  };
}
