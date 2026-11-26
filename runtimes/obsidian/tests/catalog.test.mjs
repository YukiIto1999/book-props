import assert from "node:assert/strict";
import test from "node:test";
import { product, first, key, row, original, scope } from "./catalog-fixture.mjs";
import { notes as noteFormat } from "./core.mjs";

const createBookNote = (book) => noteFormat.create(book);
const readBookNote = (raw) => noteFormat.read(raw);

void test("concurrent requests for an unregistered edition converge to one page and one edition", async () => {
  const { notes, catalog } = scope();
  const [a, b] = await Promise.all(
    [key(), key()].map((purchase) => catalog.execute({ action: "purchase", product, purchase })),
  );
  assert.equal(a.kind, "saved");
  assert.deepEqual(b, a);
  const [raw] = notes.values();
  assert.equal(notes.size, 1);
  assert.equal(readBookNote(raw).book.editions.length, 1);
});

void test("an unreadable book blocks ownership and purchase until its note is repaired", async () => {
  const damaged = original.replace("schema: 1", "schema: 999");
  const { catalog, notes } = scope(damaged);
  const inspect = { action: "inspect", product: first };
  const rejected = await catalog.execute(inspect);
  assert.equal(rejected.kind, "unreadable");
  assert.equal(rejected.path, row);
  assert.equal(
    (await catalog.execute({ action: "purchase", product, purchase: key() })).kind,
    "unreadable",
  );
  assert.deepEqual([...notes], [[row, damaged]]);

  notes.set(row, original);
  const recovered = await catalog.execute(inspect);
  assert.equal(recovered.kind, "observed");
  assert.equal(recovered.outcome.ownership, "sameEdition");
  assert.equal(recovered.path, row);
});

void test("an unrelated body edit is kept, and a lost response is resolved without clearing a later wish", async () => {
  const { files, notes, catalog } = scope(original);
  const process = files.process;
  files.process = async (path, change) => {
    notes.set(path, notes.get(path) + "保存直前の追記\n");
    await process(path, change);
    throw new Error("completion not observed");
  };
  const operation = { action: "purchase", product, purchase: key() };
  assert.deepEqual(await catalog.execute(operation), { kind: "unknown" });
  assert.ok(notes.get(row).endsWith("保存直前の追記\n"));
  files.process = process;
  assert.equal((await catalog.execute({ action: "setWish", product })).kind, "saved");
  const before = notes.get(row);
  assert.equal((await catalog.reconcile(operation)).kind, "replayed");
  assert.equal((await catalog.execute(operation)).kind, "replayed");
  assert.equal(notes.get(row), before);
  assert.equal(readBookNote(before).book.wanted, true);
  assert.equal(readBookNote(before).book.editions.length, 2);
  assert.deepEqual(await catalog.reconcile({ ...operation, product: first }), { kind: "conflict" });
});

void test("a visible wish edit or an unsaved editor prevents the same purchase from writing", async () => {
  const { files, notes, catalog } = scope(original);
  const process = files.process;
  const changed = original.replace("book-wanted: true", "book-wanted: false");
  files.process = async (path, change) => {
    notes.set(path, changed);
    return process(path, change);
  };
  assert.deepEqual(await catalog.execute({ action: "purchase", product, purchase: key() }), {
    kind: "conflict",
  });
  assert.equal(notes.get(row), changed);
  files.process = process;
  files.canUpdate = () => false;
  assert.deepEqual(await catalog.execute({ action: "purchase", product, purchase: key() }), {
    kind: "unavailable",
  });
  assert.equal(notes.get(row), changed);
});

void test("a publisher filled after lookup takes priority over a proposed supplement", async () => {
  const { files, notes, catalog } = scope(original);
  const process = files.process;
  files.process = async (path, change) => {
    notes.set(
      path,
      notes
        .get(path)
        .replace("      label: 初版", "      label: 初版\n      publisher: 利用者が入力"),
    );
    return process(path, change);
  };
  assert.equal(
    (
      await catalog.execute({
        action: "purchase",
        product: { ...first, publisher: "外部書誌" },
        purchase: key(),
      })
    ).kind,
    "saved",
  );
  const { book } = readBookNote(notes.get(row));
  assert.equal(book.wanted, false);
  assert.equal(book.editions[0].publisher, "利用者が入力");
});

void test("renaming a note and changing its wish while recording previous ownership do not revert the wish", async () => {
  const { files, notes, catalog } = scope(
    original.replace("book-wanted: true", "book-wanted: false"),
  );
  const read = files.read;
  const newPath = "Books/renamed.md";
  files.read = async (path) => {
    const content = await read(path);
    if (path === row) {
      notes.set(newPath, content);
      notes.delete(row);
    }
    return content;
  };
  const process = files.process;
  files.process = async (path, change) => {
    notes.set(path, notes.get(path).replace("book-wanted: false", "book-wanted: true"));
    return process(path, change);
  };
  assert.equal((await catalog.execute({ action: "recordOwnership", product })).kind, "saved");
  assert.deepEqual([...notes.keys()], [newPath]);
  const { book } = readBookNote(notes.get(newPath));
  assert.equal(book.wanted, true);
  assert.equal(book.editions.find(({ label }) => label === "第2版").owned, true);
});

void test("a move interrupted after writing the destination resumes without losing the edition", async () => {
  const otherId = "a92b586d-d849-4a51-b05d-3477d69587ed";
  const source = original.replace(
    "book-wanted: true",
    "book-wanted: true\nbook-reading-status: reading\ntags: [研究]",
  );
  const { files, notes, catalog } = scope(source);
  const otherPath = "Books/other.md";
  notes.set(
    otherPath,
    createBookNote({
      id: otherId,
      title: "移動先の本",
      authors: ["山田 太郎"],
      wanted: false,
      editions: [],
      appliedPurchases: [],
    }),
  );
  const destinationBeforeMove = notes.get(otherPath);
  const process = files.process;
  files.process = async (path, change) => {
    const written = await process(path, change);
    if (path === otherPath) throw new Error("interrupted before returning the destination write");
    return written;
  };
  const { book } = readBookNote(source);
  const [edition] = book.editions;
  assert.equal(
    await catalog.manage({
      action: "move",
      bookId: book.id,
      editionId: edition.id,
      destinationId: otherId,
    }),
    "pending",
  );
  assert.ok(readBookNote(notes.get(row)).book.pendingMove);
  assert.equal(readBookNote(notes.get(otherPath)).book.editions[0].id, edition.id);
  assert.deepEqual(await catalog.execute({ action: "inspect", product: first }), {
    kind: "unavailable",
  });
  const movedFrom = notes.get(row);
  const copiedTo = notes.get(otherPath);
  notes.set(row, source);
  notes.set(otherPath, destinationBeforeMove);
  const read = files.read;
  files.read = async (path) => {
    const raw = await read(path);
    if (path === row) {
      notes.set(row, movedFrom);
      notes.set(otherPath, copiedTo);
    }
    return raw;
  };
  await assert.rejects(catalog.shelf());
  files.read = read;
  const pendingShelf = await catalog.shelf();
  assert.equal(pendingShelf.moving, true);
  assert.deepEqual(
    pendingShelf.entries
      .filter(({ book }) => book.editions.some(({ owned }) => owned))
      .map(({ path }) => path),
    [row],
  );
  assert.equal(pendingShelf.entries.find(({ path }) => path === row).book.wanted, true);
  files.process = process;
  assert.equal(await catalog.manage({ action: "recoverMove", bookId: book.id }), "saved");
  const after = readBookNote(notes.get(row)).book;
  assert.deepEqual(after.editions, []);
  assert.equal(after.pendingMove, undefined);
  assert.equal(after.wanted, true);
  assert.equal(after.readingStatus, "reading");
  assert.deepEqual(after.tags, ["研究"]);
  assert.ok(notes.get(row).endsWith("## 手書きメモ\n"));
  const destination = readBookNote(notes.get(otherPath)).book;
  assert.deepEqual(destination.editions, [edition]);
  assert.equal(destination.wanted, false);
  const settledShelf = await catalog.shelf();
  assert.equal(settledShelf.moving, false);
  assert.deepEqual(
    settledShelf.entries
      .filter(({ book }) => book.editions.some(({ owned }) => owned))
      .map(({ path }) => path),
    [otherPath],
  );
});

void test("archive and restore affect lookup without overwriting the record or losing its wish and body", async () => {
  const { notes, catalog } = scope(original);
  const { book } = readBookNote(original);
  const [edition] = book.editions;
  assert.equal(
    await catalog.manage({ action: "archive", bookId: book.id, editionId: edition.id }),
    "saved",
  );
  const archived = readBookNote(notes.get(row)).book;
  assert.ok(archived.editions[0].archivedAt);
  assert.equal(archived.archivedAt, undefined);
  assert.equal(archived.wanted, true);
  assert.ok(notes.get(row).endsWith("## 手書きメモ\n"));
  const inspect = () => catalog.execute({ action: "inspect", product: first });
  const hiddenEdition = await inspect();
  assert.equal(hiddenEdition.outcome.ownership, "unowned");
  assert.equal(hiddenEdition.outcome.wanted, true);
  const before = notes.get(row);
  assert.equal(
    (await catalog.execute({ action: "purchase", product: first, purchase: key() })).kind,
    "needsInput",
  );
  assert.deepEqual([...notes], [[row, before]]);
  assert.equal(
    await catalog.manage({ action: "restore", bookId: book.id, editionId: edition.id }),
    "saved",
  );
  assert.deepEqual(readBookNote(notes.get(row)).book, book);
  assert.equal((await inspect()).outcome.ownership, "sameEdition");
  assert.equal(await catalog.manage({ action: "archive", bookId: book.id }), "saved");
  const hiddenBook = await inspect();
  assert.equal(hiddenBook.outcome.ownership, "unowned");
  assert.equal(hiddenBook.outcome.wanted, false);
  assert.equal(await catalog.manage({ action: "restore", bookId: book.id }), "saved");
  assert.equal((await inspect()).outcome.wanted, true);
});
