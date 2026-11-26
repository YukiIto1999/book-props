import { readFileSync } from "node:fs";
import * as core from "../dist/wasm/book_props_vault.js";

// 本ページの読み取りもcoreのISBNの規則を使うので、読む前にcoreを用意する。
core.initSync({
  module: readFileSync(new URL("../dist/wasm/book_props_vault_bg.wasm", import.meta.url)),
});

export { core };
