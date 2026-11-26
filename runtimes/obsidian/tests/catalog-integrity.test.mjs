import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { LocalMoveCopies } from "../src/adapters/local-move-copies.ts";
import { PortableLibrary } from "../src/catalog/portable-library.ts";
import { first, key, original, product, row, scope } from "./catalog-fixture.mjs";
import { core, notes as noteFormat } from "./core.mjs";

const createBookNote = (book) => noteFormat.create(book);
const readBookNote = (raw) => noteFormat.read(raw);
const portable = new PortableLibrary(core, noteFormat);
const encodePortableLibrary = (raws) => portable.encode(raws);

const source = readBookNote(original).book;
const [edition] = source.editions;
const sourcePath = `Books/${source.title} (${source.id.slice(0, 8)}).md`;
const destinationId = "8c43856e-f6a9-4bfe-bcbf-bdf427098541";
const destinationPath = "Books/a-destination.md";
const destination = createBookNote({
  id: destinationId,
  title: "移動先の本",
  authors: ["別の著者"],
  wanted: false,
  editions: [],
  appliedPurchases: [],
});
const move = { action: "move", bookId: source.id, editionId: edition.id, destinationId };
const inspect = { action: "inspect", product: { isbns: first.isbns } };

void test("a destination changed before source removal cannot erase the only copy", async () => {
  const { files, notes, catalog } = scope(original);
  notes.set(destinationPath, destination);
  const process = files.process;
  let replaced = false;
  files.process = async (path, render) => {
    if (path === row && notes.get(destinationPath) !== destination && !replaced) {
      replaced = true;
      notes.set(destinationPath, destination);
    }
    return process(path, render);
  };
  assert.equal(await catalog.manage(move), "pending");
  assert.equal(readBookNote(notes.get(row)).book.editions[0].id, edition.id);
  assert.equal(await catalog.manage({ action: "recoverMove", bookId: source.id }), "saved");
  assert.equal(readBookNote(notes.get(destinationPath)).book.editions[0].id, edition.id);
});

function interruptAfterSourceRemoval() {
  const { files, notes, catalog } = scope(original);
  notes.set(destinationPath, destination);
  const process = files.process;
  files.process = async (path, render) => {
    const pathWritten = await process(path, render);
    if (path === row && readBookNote(notes.get(row)).book.editions.length === 0)
      notes.set(destinationPath, destination);
    return pathWritten;
  };
  return { notes, catalog };
}

void test("a destination lost after source removal can be recovered by reopening the library", async () => {
  const { notes, catalog } = interruptAfterSourceRemoval();
  assert.equal(await catalog.manage(move), "pending");
  const reopened = scope(notes.get(row));
  reopened.notes.set(destinationPath, notes.get(destinationPath));
  const shelf = await reopened.catalog.shelf();
  assert.equal(shelf.entries.find(({ path }) => path === row).book.editions[0].id, edition.id);
  assert.equal(
    await reopened.catalog.manage({ action: "recoverMove", bookId: source.id }),
    "saved",
  );
  assert.deepEqual(readBookNote(reopened.notes.get(row)).book.editions, []);
  assert.deepEqual(readBookNote(reopened.notes.get(destinationPath)).book.editions, [edition]);
});

void test("cancelling an interrupted move restores the source from its saved copy", async () => {
  const { notes, catalog } = interruptAfterSourceRemoval();
  assert.equal(await catalog.manage(move), "pending");
  assert.equal(await catalog.manage({ action: "cancelMove", bookId: source.id }), "saved");
  const restored = readBookNote(notes.get(row)).book;
  assert.deepEqual(restored.editions, [edition]);
  assert.equal(restored.pendingMove, undefined);
  assert.equal(notes.get(destinationPath), destination);
});

void test("the last copy survives destination rollback and an unwritable source after finalization", async (t) => {
  const storage = await mkdtemp(join(tmpdir(), "book-props-edition-copy-"));
  t.after(() => rm(storage, { recursive: true, force: true }));
  const { files, notes, catalog } = scope(original, new LocalMoveCopies(() => storage));
  notes.set(destinationPath, destination);
  const process = files.process;
  let rolledBack = false;
  files.process = async (path, change) => {
    const written = await process(path, change);
    if (path === row) {
      const { book } = readBookNote(notes.get(row));
      if (!book.pendingMove && book.editions.length === 0) {
        notes.set(destinationPath, destination);
        rolledBack = true;
      }
    }
    return written;
  };
  files.canUpdate = (path) => path !== row || !rolledBack;
  assert.equal(await catalog.manage(move), "pending");
  assert.equal(rolledBack, true);
  assert.deepEqual(readBookNote(notes.get(row)).book.editions, []);
  assert.equal(readBookNote(notes.get(row)).book.pendingMove, undefined);
  assert.equal(notes.get(destinationPath), destination);

  const reopened = scope(notes.get(row), new LocalMoveCopies(() => storage));
  reopened.notes.set(destinationPath, destination);
  const missing = await reopened.catalog.moveCopiesMissingFrom(await reopened.catalog.entries());
  assert.deepEqual(
    missing.map(({ editionId }) => editionId),
    [edition.id],
  );
  const restore = { action: "restoreMoveCopy", bookId: source.id, editionId: edition.id };
  const restored = await reopened.catalog.manage(restore);
  assert.equal(restored, "saved");
  assert.deepEqual(readBookNote(reopened.notes.get(row)).book.editions, [edition]);
  assert.equal(reopened.notes.get(destinationPath), destination);
  assert.deepEqual(
    await reopened.catalog.moveCopiesMissingFrom(await reopened.catalog.entries()),
    [],
  );
  assert.equal(await reopened.catalog.manage(restore), "conflict");
});

void test("a failed recovery copy leaves both book pages unchanged", async () => {
  const { files, notes, catalog } = scope(original);
  notes.set(destinationPath, destination);
  files.moveCopies.keep = async () => {
    throw new Error("the device cannot save the recovery copy");
  };
  assert.equal(await catalog.manage(move), "unavailable");
  assert.deepEqual([...notes.values()], [original, destination]);
});

void test("inspection does not report unowned when a move completes in the middle of a scan", async () => {
  const { files, notes, catalog } = scope(original);
  notes.set(destinationPath, destination);
  const read = files.read;
  let moved = false;
  files.read = async (path) => {
    const raw = await read(path);
    if (path === destinationPath && !moved) {
      moved = true;
      assert.equal(await catalog.manage(move), "saved");
    }
    return raw;
  };
  const observed = await catalog.execute(inspect);
  assert.equal(observed.kind, "observed");
  assert.equal(observed.outcome.ownership, "sameEdition");
  assert.equal(observed.outcome.bookId, destinationId);
});

void test("purchase follows an in-scope rename before the second scan can read the old path", async () => {
  const { files, notes, catalog } = scope(original);
  const read = files.read;
  const renamed = "Books/renamed.md";
  let reads = 0;
  files.read = async (path) => {
    if (path === row && ++reads === 2) {
      notes.set(renamed, notes.get(row));
      notes.delete(row);
    }
    return read(path);
  };
  assert.equal(
    (await catalog.execute({ action: "purchase", product, purchase: key() })).kind,
    "saved",
  );
  assert.deepEqual([...notes.keys()], [renamed]);
  const saved = readBookNote(notes.get(renamed)).book;
  assert.ok(saved.editions.some(({ isbns, owned }) => owned && isbns.includes(product.isbns[0])));
  assert.equal(saved.wanted, false);
});

void test("import recognizes an identical renamed record arriving between writes", async () => {
  const { catalog, files, notes } = scope();
  const renamed = "Books/synced-renamed.md";
  const create = files.create;
  files.create = async (fileName, raw) => {
    const path = await create(fileName, raw);
    if (path === sourcePath) notes.set(renamed, destination);
    return path;
  };
  assert.deepEqual(await catalog.importLibrary(encodePortableLibrary([original, destination])), {
    status: "saved",
    count: 1,
  });
  assert.deepEqual([...notes.keys()], [sourcePath, renamed]);
  assert.equal((await catalog.execute(inspect)).outcome.ownership, "sameEdition");
});

void test("import stops after an arriving record with the same ID but different Markdown", async () => {
  const { catalog, files, notes } = scope();
  const synced = `${destination}\n# 別の本文\n`;
  const renamed = "Books/synced-renamed.md";
  const create = files.create;
  files.create = async (fileName, raw) => {
    const path = await create(fileName, raw);
    if (path === sourcePath) notes.set(renamed, synced);
    return path;
  };
  assert.deepEqual(await catalog.importLibrary(encodePortableLibrary([original, destination])), {
    status: "pending",
    count: 1,
  });
  assert.deepEqual(
    [...notes],
    [
      [sourcePath, original],
      [renamed, synced],
    ],
  );
});

void test("a missing opening YAML delimiter does not silently permit duplicate registration", async () => {
  const damaged = original.replace(/^---\n/, "");
  const { catalog, notes } = scope(damaged);
  assert.equal((await catalog.execute(inspect)).kind, "unreadable");
  assert.equal(
    (await catalog.execute({ action: "purchase", product: first, purchase: key() })).kind,
    "unreadable",
  );
  assert.deepEqual([...notes], [[row, damaged]]);
});
