import { initSync, inspect, normalizeIsbns } from "../dist/wasm/book_props_vault.js";
import wasm from "../dist/wasm/book_props_vault_bg.wasm";

export type {
  Action,
  CatalogRequest,
  Edition,
  IsbnList,
  Outcome,
} from "../dist/wasm/book_props_vault.js";

/** 目録の規則を判定するcore。Vaultの読み書きはしない。 */
export type CatalogCore = Readonly<{
  inspect: typeof inspect;
  normalizeIsbns: typeof normalizeIsbns;
}>;

export function startCatalogCore(): CatalogCore {
  initSync({ module: wasm });
  return { inspect, normalizeIsbns };
}
