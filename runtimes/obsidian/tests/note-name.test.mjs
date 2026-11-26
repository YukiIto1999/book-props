import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { PortableLibrary } from "../src/catalog/portable-library.ts";
import { bookCodes, noteFileName, titleStem } from "../src/catalog/note-name.ts";
import { key, original, product, row, scope } from "./catalog-fixture.mjs";
import { core, notes as noteFormat } from "./core.mjs";

const bookId = "7b91b5a8-1f2c-4d3e-9a4b-5c6d7e8f9a0b";
const otherId = "3f2a9c10-6b7d-4e8f-a1b2-c3d4e5f60718";
const codes = await bookCodes(bookId);

const book = (id, title) =>
  noteFormat.create({
    id,
    title,
    authors: [],
    wanted: true,
    editions: [],
    appliedPurchases: [],
  });

void test("every character that a file system or an Obsidian link rejects becomes its full-width form", () => {
  assert.equal(
    titleStem('a\\b/c:d*e?f"g<h>i|j#k^l[m]n'),
    "a＼b／c：d＊e？f＂g＜h＞i｜j＃k＾l［m］n",
  );
  assert.equal(titleStem("C#入門 [第2版]"), "C＃入門 ［第2版］");
});

void test("control characters disappear, whitespace collapses, and the ends lose dots and spaces", () => {
  assert.equal(titleStem("設計\u0000入門\u007f"), "設計入門");
  assert.equal(titleStem("  設計\n\t入門\u3000の本  "), "設計 入門 の本");
  assert.equal(titleStem("...隠れない本"), "隠れない本");
  assert.equal(titleStem("Vol. 1 ..."), "Vol. 1");
  assert.equal(titleStem("e\u0301tude"), "\u00e9tude");
});

void test("a title with nothing usable left still gives a usable name", () => {
  for (const title of ["", "   ", "...", "\u0000\u0001"])
    assert.equal(titleStem(title), "無題の本");
});

void test("a Windows device name before the first dot gets an underscore in front", () => {
  assert.equal(noteFileName("CON.txt", codes, []), "_CON.txt (7b91b5a8).md");
  assert.equal(noteFileName("nul", codes, []), "_nul (7b91b5a8).md");
  assert.equal(noteFileName("LPT².foo", codes, []), "_LPT².foo (7b91b5a8).md");
  assert.equal(titleStem("com0 .tar.gz"), "_com0 .tar.gz");
  for (const title of ["CONSOLE", "Console.txt", "AUXILIARY", "LPT10", "NUL9"])
    assert.equal(titleStem(title), title);
});

void test("a long title is cut at 80 characters and 213 bytes without splitting a grapheme", () => {
  assert.equal(titleStem("a".repeat(100)), "a".repeat(80));
  assert.equal(titleStem(`${"a".repeat(79)} b`), "a".repeat(79));
  assert.equal(titleStem("本".repeat(100)), "本".repeat(71));
  const family = "👨‍👩‍👧";
  assert.equal(titleStem(family.repeat(20)), family.repeat(11));
  const emoji = titleStem("😀".repeat(60));
  assert.equal(emoji, "😀".repeat(53));
  for (const stem of [emoji, titleStem("本".repeat(100))])
    assert.ok(new TextEncoder().encode(`${stem} (${bookId}).md`).length <= 255);
});

void test("the code is the start of a random UUID, and a hash of any other ID", async () => {
  assert.deepEqual(codes, ["7b91b5a8", "7b91b5a81f2c", bookId]);
  const timeOrdered = "01890a5d-ac96-774b-bcce-b302099a8057";
  const hash = createHash("sha256").update(timeOrdered).digest("hex");
  assert.deepEqual(await bookCodes(timeOrdered), [
    hash.slice(0, 8),
    hash.slice(0, 12),
    timeOrdered,
  ]);
});

void test("the file name is the title with the code in parentheses, for any script", async () => {
  assert.equal(noteFileName("リーダブルコード", codes, []), "リーダブルコード (7b91b5a8).md");
  assert.equal(
    noteFileName("Effective Java", await bookCodes(otherId), []),
    "Effective Java (3f2a9c10).md",
  );
  assert.notEqual(
    noteFileName("同じ書名", codes, []),
    noteFileName("同じ書名", await bookCodes(otherId), []),
  );
});

void test("a name already in the folder, in any letter case, takes a longer code", () => {
  const taken = ["EFFECTIVE JAVA (7B91B5A8).md"];
  assert.equal(noteFileName("Effective Java", codes, taken), "Effective Java (7b91b5a81f2c).md");
  taken.push("Effective Java (7b91b5a81f2c).MD");
  assert.equal(noteFileName("Effective Java", codes, taken), `Effective Java (${bookId}).md`);
  taken.push(`effective java (${bookId}).md`);
  assert.throws(() => noteFileName("Effective Java", codes, taken));
});

void test("registration names the new note after its title and book ID", async () => {
  const { catalog, notes } = scope();
  const saved = await catalog.execute({ action: "purchase", product, purchase: key() });
  assert.equal(saved.kind, "saved");
  assert.deepEqual([...notes.keys()], [`Books/設計入門 (${saved.bookId.slice(0, 8)}).md`]);
});

void test("a second book with the same title gets its own note", async () => {
  const { catalog, notes } = scope(original);
  const saved = await catalog.execute({
    action: "setWish",
    product: { ...product, isbns: ["9784873115658"] },
    selection: { bookId: "new" },
  });
  assert.equal(saved.kind, "saved");
  assert.deepEqual(
    [...notes.keys()].sort(),
    [row, `Books/設計入門 (${saved.bookId.slice(0, 8)}).md`].sort(),
  );
});

void test("import names each created note after its title and book ID", async () => {
  const { catalog, notes } = scope();
  const json = new PortableLibrary(core, noteFormat).encode([book(bookId, "C#: 入門?")]);
  assert.deepEqual(await catalog.importLibrary(json), { status: "saved", count: 1 });
  assert.deepEqual([...notes.keys()], ["Books/C＃： 入門？ (7b91b5a8).md"]);
});

void test("the rename command renames only notes still named after their own book ID", async () => {
  const { catalog, notes } = scope(original);
  const unmanaged = `Books/${otherId}.md`;
  const elsewhere = "Books/Archive/a.md";
  const mismatched = `Books/${bookId}.md`;
  notes.set(`Books/Archive/${otherId}.md`, book(otherId, "Effective Java"));
  notes.set(unmanaged, "# 本ではないメモ\n");
  notes.set(mismatched, book("1cf19174-6b31-4060-b2b5-df47987ed56b", "別の本"));
  notes.set(elsewhere, "# メモ\n");
  assert.deepEqual(await catalog.renameIdNamedNotes(), { renamed: 1, failed: 0 });
  assert.deepEqual(
    [...notes.keys()].sort(),
    [row, unmanaged, mismatched, elsewhere, "Books/Archive/Effective Java (3f2a9c10).md"].sort(),
  );
  assert.deepEqual(await catalog.renameIdNamedNotes(), { renamed: 0, failed: 0 });
});

void test("a rename that fails is counted and the other notes still move", async () => {
  const { catalog, files, notes } = scope();
  notes.set(`Books/${bookId}.md`, book(bookId, "壊れる"));
  notes.set(`Books/${otherId}.md`, book(otherId, "残る"));
  const rename = files.rename;
  files.rename = async (path, fileName) => {
    if (path.includes(bookId)) throw new Error("locked");
    return rename(path, fileName);
  };
  assert.deepEqual(await catalog.renameIdNamedNotes(), { renamed: 1, failed: 1 });
  assert.deepEqual([...notes.keys()].sort(), [`Books/${bookId}.md`, "Books/残る (3f2a9c10).md"]);
});
