import assert from "node:assert/strict";
import test from "node:test";
import { statusChange } from "../src/catalog/reading-records.ts";
import { localDate, ReadingDraft, readingNotice } from "../src/views/reading-draft.ts";
import { core, notes as noteFormat } from "./core.mjs";
import { key, original, product, row, scope } from "./catalog-fixture.mjs";

const readBook = (raw) => noteFormat.read(raw).book;
const calendarDate = (text) => core.calendarDate(text);
const bookId = "0e0f6f4e-56a3-4d2b-9a43-0d8f0a4c1a11";
const note = `---
book-title: 設計入門
book-reading-status: reading # 手で付けた注記
book-wanted: true
tags: [設計]
book-props:
  schema: 1
  book-id: ${bookId}
  editions: []
  applied-purchases: []
---
## 読書メモ
第3章を読み返す。
`;
const other = {
  id: "7d1d3c1e-9b0f-4f57-8a4a-5c3a1e2f9b60",
  title: "読みやすいコード",
  authors: [],
  wanted: false,
  editions: [],
  appliedPurchases: [],
};

void test("a reading change rewrites only the parts it changes and keeps comments, other fields and the body", () => {
  const finished = noteFormat.setReading(
    note,
    { status: "reading" },
    { status: "finished", finishedOn: "2026-11-28" },
  );
  assert.equal(
    finished,
    note
      .replace("reading # ", '"finished" # ')
      .replace("book-props:", 'book-finished-on: "2026-11-28"\nbook-props:'),
  );
  const rereading = noteFormat.setReading(
    finished,
    { status: "finished", finishedOn: "2026-11-28" },
    { status: "rereading", finishedOn: "2026-11-28" },
  );
  assert.equal(rereading, finished.replace('"finished" # ', '"rereading" # '));
  const unset = noteFormat.setReading(
    rereading,
    { status: "rereading", finishedOn: "2026-11-28" },
    { finishedOn: "2026-11-28" },
  );
  assert.equal(unset, rereading.replace('book-reading-status: "rereading" # 手で付けた注記\n', ""));
  const { readingStatus, finishedOn, wanted, tags } = readBook(unset);
  assert.deepEqual(
    { readingStatus, finishedOn, wanted, tags },
    {
      readingStatus: undefined,
      finishedOn: "2026-11-28",
      wanted: true,
      tags: ["設計"],
    },
  );
  const added = noteFormat.setReading(unset, { finishedOn: "2026-11-28" }, { status: "unread" });
  assert.equal(
    added,
    unset.replace(
      'book-finished-on: "2026-11-28"\nbook-props:',
      'book-reading-status: "unread"\nbook-props:',
    ),
  );
});

void test("a key the note does not know as a reading status leaves the note unreadable", () => {
  assert.throws(() => readBook(note.replace("reading # ", "tsundoku # ")));
});

void test("the shelf sets many books at once, leaves the finish day, and skips a book changed since it was shown", async () => {
  const { catalog, notes } = scope(original);
  notes.set("Books/other.md", noteFormat.create(other));
  notes.set("Books/note.md", note);
  const shown = await catalog.entries();
  const byId = (id) => shown.find(({ book }) => book.id === id).book;
  const hand = noteFormat.setReading(note, { status: "reading" }, { status: "reference" });
  notes.set("Books/note.md", hand);
  const before = notes.get(row);
  const saves = await catalog.reading.set(
    [byId(readBook(original).id), byId(other.id), byId(bookId)].map((book) =>
      statusChange(book, "finished"),
    ),
  );
  assert.deepEqual(saves, ["saved", "saved", "conflict"]);
  assert.equal(notes.get("Books/note.md"), hand);
  const updated = readBook(notes.get(row));
  assert.equal(updated.readingStatus, "finished");
  assert.equal(updated.finishedOn, undefined);
  assert.deepEqual(
    { ...updated, readingStatus: undefined },
    {
      ...readBook(before),
      readingStatus: undefined,
    },
  );
  assert.ok(notes.get(row).endsWith("## 手書きメモ\n"));
  assert.equal(readBook(notes.get("Books/other.md")).readingStatus, "finished");
});

void test("a finish day the user wrote after the book was shown is never overwritten", async () => {
  const { catalog, notes } = scope(original);
  const [{ book }] = await catalog.entries();
  const dated = noteFormat.setReading(original, {}, { finishedOn: "2024-04-30" });
  notes.set(row, dated);
  const proposed = { status: "finished", finishedOn: "2026-11-28" };
  assert.deepEqual(await catalog.reading.set([{ book, value: proposed }]), ["conflict"]);
  assert.equal(notes.get(row), dated);
  assert.deepEqual(await catalog.reading.set([statusChange(book, "finished")]), ["saved"]);
  const saved = readBook(notes.get(row));
  assert.deepEqual([saved.readingStatus, saved.finishedOn], ["finished", "2024-04-30"]);
});

void test("an unsaved editor, an archived book or a malformed day keeps the note as it is", async () => {
  const { catalog, files, notes } = scope(original);
  const [{ book }] = await catalog.entries();
  files.canUpdate = () => false;
  assert.deepEqual(await catalog.reading.set([statusChange(book, "reading")]), ["unavailable"]);
  files.canUpdate = () => true;
  const invalid = { status: "finished", finishedOn: "2026/11/28" };
  assert.deepEqual(await catalog.reading.set([{ book, value: invalid }]), ["conflict"]);
  assert.equal(notes.get(row), original);
  assert.equal(await catalog.manage({ action: "archive", bookId: book.id }), "saved");
  const archived = notes.get(row);
  assert.deepEqual(await catalog.reading.set([statusChange(book, "reading")]), ["conflict"]);
  assert.equal(notes.get(row), archived);
});

void test("a purchase keeps the reading status and the finish day", async () => {
  const { catalog, notes } = scope(original);
  const [{ book }] = await catalog.entries();
  const value = { status: "finished", finishedOn: "2026-11-28" };
  assert.deepEqual(await catalog.reading.set([{ book, value }]), ["saved"]);
  const purchase = { action: "purchase", product, purchase: key() };
  assert.equal((await catalog.execute(purchase)).kind, "saved");
  const bought = readBook(notes.get(row));
  assert.equal(bought.editions.length, 2);
  assert.equal(bought.wanted, false);
  assert.deepEqual([bought.readingStatus, bought.finishedOn], ["finished", "2026-11-28"]);
});

void test("switching to finished proposes today only for an empty day, and withdraws it when switching away", () => {
  const today = "2026-11-28";
  const blank = new ReadingDraft(readBook(original), today);
  assert.equal(blank.choose("finished"), today);
  assert.deepEqual(blank.value(calendarDate), {
    kind: "value",
    value: { status: "finished", finishedOn: today },
  });
  assert.equal(blank.choose("rereading"), "");
  assert.deepEqual(blank.value(calendarDate), { kind: "value", value: { status: "rereading" } });
  assert.equal(blank.choose(undefined), undefined);
  assert.deepEqual(blank.value(calendarDate), { kind: "value", value: {} });

  const handWritten = { ...readBook(original), readingStatus: "rereading", finishedOn: "2024/5/1" };
  const dated = new ReadingDraft(handWritten, today);
  assert.equal(dated.choose("finished"), undefined);
  assert.deepEqual(dated.value(calendarDate), {
    kind: "value",
    value: { status: "finished", finishedOn: "2024/5/1" },
  });
  dated.type("2024/5/2");
  assert.deepEqual(dated.value(calendarDate).value.finishedOn, "2024-05-02");
  dated.type("2024-02-30");
  assert.deepEqual(dated.value(calendarDate), { kind: "invalidDate", text: "2024-02-30" });
  dated.type(" ");
  assert.deepEqual(dated.value(calendarDate), { kind: "value", value: { status: "finished" } });
  assert.equal(dated.choose("reading"), undefined);
  assert.equal(dated.fillToday(), today);
  assert.equal(dated.choose("unread"), undefined);
  assert.deepEqual(dated.value(calendarDate).value, { status: "unread", finishedOn: today });
});

void test("the notice counts the books changed and the books left alone", () => {
  assert.equal(
    readingNotice(["saved", "conflict", "saved", "unavailable"], "finished"),
    "2冊の読書状態を「読了」にしました。1冊は、表示した後に変わっていたため変えていません。1冊は、編集中か最新の記録を確認できないため変えていません。",
  );
  assert.equal(readingNotice(["saved"], undefined), "1冊の読書状態を「未設定」にしました。");
  assert.equal(localDate(new Date(2026, 10, 8, 23, 59)), "2026-11-08");
});
