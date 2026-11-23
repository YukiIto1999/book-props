import { evaluate, initSync } from "../dist/wasm/book_props_vault.js";
import wasm from "../dist/wasm/book_props_vault_bg.wasm";

export function startCatalogCore(): (json: string) => string {
  initSync({ module: wasm });
  return evaluate;
}
