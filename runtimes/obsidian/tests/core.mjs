import { readFileSync } from "node:fs";
import { NoteFormat } from "../src/adapters/note-format/note-format.ts";
import * as core from "../dist/wasm/book_props_vault.js";

// 本ページの書式はcoreのISBNの規則で読むので、coreを用意してから書式に渡す。
core.initSync({
  module: readFileSync(new URL("../dist/wasm/book_props_vault_bg.wasm", import.meta.url)),
});
const notes = new NoteFormat(core);

export { core, notes };
