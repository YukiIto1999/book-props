import {
  admits,
  expiredReceipts,
  initSync,
  inspect,
  normalizeIsbns,
  planChange,
  reconcile,
} from "../dist/wasm/book_props_vault.js";
import wasm from "../dist/wasm/book_props_vault_bg.wasm";

export type {
  Action,
  Admission,
  Book,
  BookWrite,
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
} from "../dist/wasm/book_props_vault.js";

/** 目録の規則を判定するcore。Vaultの読み書き、乱数、時計は持たない。 */
export type CatalogCore = Readonly<{
  inspect: typeof inspect;
  normalizeIsbns: typeof normalizeIsbns;
  admits: typeof admits;
  planChange: typeof planChange;
  reconcile: typeof reconcile;
  expiredReceipts: typeof expiredReceipts;
}>;

export function startCatalogCore(): CatalogCore {
  initSync({ module: wasm });
  return { inspect, normalizeIsbns, admits, planChange, reconcile, expiredReceipts };
}
