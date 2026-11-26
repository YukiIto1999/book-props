import assert from "node:assert/strict";
import { Catalog } from "../src/catalog/catalog.ts";
import { core, notes as noteFormat } from "./core.mjs";

const createBookNote = (book) => noteFormat.create(book);

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

/** The names directly in `folder`, leaving out the path `except`. */
function siblings(notes, folder, except) {
  return [...notes.keys()]
    .filter((path) => path !== except && path.slice(0, path.lastIndexOf("/")) === folder)
    .map((path) => path.slice(folder.length + 1));
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
    create: async (fileName, raw) => {
      const path = `Books/${fileName(siblings(notes, "Books"))}`;
      assert.ok(!notes.has(path));
      notes.set(path, raw);
      return path;
    },
    rename: async (path, fileName) => {
      const folder = path.slice(0, path.lastIndexOf("/"));
      const renamed = `${folder}/${fileName(siblings(notes, folder, path))}`;
      const raw = await files.read(path);
      assert.ok(!notes.has(renamed));
      notes.delete(path);
      notes.set(renamed, raw);
      return renamed;
    },
    canUpdate: () => true,
  };
  return { files, notes, catalog: new Catalog(files, core, noteFormat) };
}

export { product, first, key, row, original, scope };
