import assert from "node:assert/strict";
import test from "node:test";
import { createBookNote, readBookNote } from "../src/book-note.ts";
import { product, key, row, original, scope } from "./catalog-fixture.mjs";

void test("an edition that appears on another page before the write is rejected without changing either page", async () => {
  const { files, notes, catalog } = scope(original);
  const path = "Books/competing.md";
  const competing = createBookNote({
    id: "1cf19174-6b31-4060-b2b5-df47987ed56b",
    title: product.title,
    authors: product.authors,
    wanted: false,
    editions: [
      {
        id: "1138d5a4-65fe-4e5d-8df6-221d6292ead5",
        label: product.label,
        isbns: product.isbns,
        owned: true,
      },
    ],
    appliedPurchases: [],
  });
  const process = files.process;
  files.process = async (target, change) => {
    notes.set(path, competing);
    return process(target, change);
  };
  assert.deepEqual(await catalog.execute({ action: "purchase", product, purchase: key() }), {
    kind: "conflict",
  });
  assert.deepEqual(
    [...notes],
    [
      [row, original],
      [path, competing],
    ],
  );
});

void test("a body edit to another book before the write survives without rejecting the purchase", async () => {
  const { files, notes, catalog } = scope(original);
  const path = "Books/unrelated.md";
  const unrelated = createBookNote({
    id: "1cf19174-6b31-4060-b2b5-df47987ed56b",
    title: "別の本",
    authors: [],
    wanted: false,
    editions: [],
    appliedPurchases: [],
  });
  notes.set(path, unrelated);
  const process = files.process;
  const amended = unrelated + "\n## 追記\n";
  files.process = async (target, change) => {
    notes.set(path, amended);
    return process(target, change);
  };
  assert.equal(
    (await catalog.execute({ action: "purchase", product, purchase: key() })).kind,
    "saved",
  );
  assert.equal(notes.get(path), amended);
  assert.equal(readBookNote(notes.get(row)).book.wanted, false);
});

void test("an observed replacement of the purchase wish is not lost during a catalog refresh", async () => {
  const { files, notes, catalog } = scope(original);
  let changed = false;
  const process = files.process;
  files.process = async (target, change) => {
    if (changed) return process(target, change);
    changed = true;
    notes.set("Books/memo.md", "# Unrelated note");
    notes.set(row, original.replace("book-wanted: true", "book-wanted: false"));
    try {
      return await process(target, change);
    } finally {
      notes.set(row, original);
    }
  };
  assert.deepEqual(await catalog.execute({ action: "purchase", product, purchase: key() }), {
    kind: "conflict",
  });
  assert.equal(notes.get(row), original);
});

void test("a body edit to the target during a catalog refresh is preserved", async () => {
  const { files, notes, catalog } = scope(original);
  const process = files.process;
  files.process = async (target, change) => {
    notes.set("Books/z-memo.md", "# Unrelated note");
    return process(target, change);
  };
  const read = files.read;
  files.read = async (path) => {
    const raw = await read(path);
    if (path === "Books/z-memo.md") notes.set(row, original + "追記\n");
    return raw;
  };
  assert.equal(
    (await catalog.execute({ action: "purchase", product, purchase: key() })).kind,
    "saved",
  );
  assert.ok(notes.get(row).endsWith("追記\n"));
});
