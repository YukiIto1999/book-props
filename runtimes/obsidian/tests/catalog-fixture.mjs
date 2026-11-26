import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as core from "../dist/wasm/book_props_vault.js";
import { Catalog } from "../src/catalog.ts";
import { createBookNote } from "../src/book-note.ts";

core.initSync({
  module: readFileSync(new URL("../dist/wasm/book_props_vault_bg.wasm", import.meta.url)),
});
const product = {
  title: "設計入門",
  authors: ["山田 太郎"],
  label: "第2版",
  isbns: ["9780201633610"],
};
const first = {
  title: product.title,
  authors: product.authors,
  label: "初版",
  isbns: ["9780306406157"],
};
const key = () => ({
  clientId: crypto.randomUUID(),
  requestId: crypto.randomUUID(),
  issuedAt: Date.now(),
});
const row = "Books/example.md";
const original =
  createBookNote({
    id: "4fa20a45-80a4-4c8c-b74c-c3e307076da5",
    title: product.title,
    authors: product.authors,
    wanted: true,
    editions: [
      {
        id: "44c09e2e-4f07-4bed-9a59-300146205362",
        owned: true,
        label: first.label,
        isbns: first.isbns,
      },
    ],
    appliedPurchases: [],
  }) + "\n## 手書きメモ\n";

function memoryCopies() {
  const copies = new Map();
  return {
    keep: async (copy) => {
      copies.set(copy.editionId, copy);
    },
    list: async () => [...copies.values()],
  };
}

function scope(initial, moveCopies = memoryCopies()) {
  const notes = new Map(initial === undefined ? [] : [[row, initial]]);
  const files = {
    moveCopies,
    versions: () => new Map(notes),
    read: async (path) => {
      if (!notes.has(path)) throw new Error("gone");
      return notes.get(path);
    },
    process: async (path, change) => {
      notes.set(path, change(await files.read(path), path));
      return path;
    },
    create: async (id, raw) => {
      const path = `Books/${id}.md`;
      assert.ok(!notes.has(path));
      notes.set(path, raw);
      return path;
    },
    canUpdate: () => true,
  };
  return { files, notes, catalog: new Catalog(files, core) };
}

export { product, first, key, row, original, scope };
