import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { PortableLibrary } from "../src/catalog/portable-library.ts";
import { bookCodes, noteFileName, renameCandidates, titleStem } from "../src/catalog/note-name.ts";
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
  // The stored subtitle separator becomes one full-width colon, without the spaces around it.
  assert.equal(titleStem("リーダブルコード : より良いコード"), "リーダブルコード：より良いコード");
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
  assert.deepEqual([...notes.keys()], ["Books/C＃：入門？ (7b91b5a8).md"]);
});

const named = (path, title, noteCodes = codes, id = bookId) => ({
  path,
  bookId: id,
  title,
  codes: noteCodes,
});
const targets = (renames) => renames.map(({ from, to }) => [from, to]);

void test("a note named after an older title or after its book ID is renamed to the rule's name", async () => {
  const older =
    "リーダブルコード ―より良いコードを書くためのテクニック (Theory in practice) (7b91b5a8).md";
  const title = "リーダブルコード : より良いコードを書くためのテクニック";
  const renames = renameCandidates(
    [
      named(`Books/${older}`, title),
      named(`Books/${otherId}.md`, "Effective Java", await bookCodes(otherId), otherId),
    ],
    new Map([["Books", [older, `${otherId}.md`]]]),
  );
  assert.deepEqual(targets(renames), [
    [`${otherId}.md`, "Effective Java (3f2a9c10).md"],
    [older, "リーダブルコード：より良いコードを書くためのテクニック (7b91b5a8).md"],
  ]);
  assert.deepEqual(renames[1], {
    path: `Books/${older}`,
    bookId,
    title,
    from: older,
    to: "リーダブルコード：より良いコードを書くためのテクニック (7b91b5a8).md",
  });
});

void test("a note already named by the rule, with any of its codes, is left alone", () => {
  const folder = ["Effective Java (7b91b5a8).md", "Effective Java (7b91b5a81f2c).md"];
  const notes = folder.map((name) => named(`Books/${name}`, "Effective Java"));
  assert.deepEqual(renameCandidates(notes, new Map([["Books", folder]])), []);
});

void test("a name that differs only in letter case is renamed to the rule's exact name", () => {
  const from = "effective java (7B91B5A8).md";
  const renames = renameCandidates(
    [named(`Books/${from}`, "Effective Java")],
    new Map([["Books", [from]]]),
  );
  assert.deepEqual(targets(renames), [[from, "Effective Java (7b91b5a8).md"]]);
});

void test("new names do not clash with each other or with other files, in any letter case", () => {
  const first = ["aaaaaaaa", "aaaaaaaabbbb", "first"];
  const second = ["aaaaaaaa", "aaaaaaaacccc", "second"];
  const folder = ["a.md", "b.md", "c.md", "メモ (dddddddd).md", "Sub"];
  const renames = renameCandidates(
    [
      named("Books/b.md", "JAVA", second, "second"),
      named("Books/a.md", "Java", first, "first"),
      named("Books/c.md", "メモ", ["dddddddd", "ddddddddeeee", "third"], "third"),
    ],
    new Map([["Books", folder]]),
  );
  assert.deepEqual(targets(renames), [
    ["a.md", "Java (aaaaaaaa).md"],
    ["b.md", "JAVA (aaaaaaaacccc).md"],
    ["c.md", "メモ (ddddddddeeee).md"],
  ]);
});

void test("the command lists only book notes whose name is not the rule's name, and renames the chosen ones", async () => {
  const { catalog, notes } = scope(original);
  const memo = `Books/${otherId}.md`;
  const correct = "Books/Effective Java (7b91b5a8).md";
  notes.set(`Books/Archive/${otherId}.md`, book(otherId, "Effective Java"));
  notes.set(memo, "# 本ではないメモ\n");
  notes.set(correct, book(bookId, "Effective Java"));
  notes.set("Books/broken.md", original.replace("schema: 1", "schema: 999"));
  const renames = await catalog.noteNames.propose();
  assert.deepEqual(targets(renames), [
    [`${otherId}.md`, "Effective Java (3f2a9c10).md"],
    ["example.md", "設計入門 (4fa20a45).md"],
  ]);
  assert.deepEqual(await catalog.noteNames.rename(renames.slice(0, 1)), {
    renamed: 1,
    skipped: 0,
    failed: 0,
  });
  assert.deepEqual(
    [...notes.keys()].sort(),
    [row, memo, correct, "Books/broken.md", "Books/Archive/Effective Java (3f2a9c10).md"].sort(),
  );
  assert.deepEqual(targets(await catalog.noteNames.propose()), [
    ["example.md", "設計入門 (4fa20a45).md"],
  ]);
});

void test("a note changed, renamed or taken over after the list is skipped, and a failed rename is counted", async () => {
  const { catalog, files, notes } = scope();
  const ids = [
    bookId,
    otherId,
    "1cf19174-6b31-4060-b2b5-df47987ed56b",
    "8c43856e-f6a9-4bfe-bcbf-bdf427098541",
  ];
  for (const [index, id] of ids.entries()) notes.set(`Books/${id}.md`, book(id, `本${index}`));
  const renames = await catalog.noteNames.propose();
  assert.equal(renames.length, 4);
  notes.set(`Books/${ids[0]}.md`, book(ids[0], "書名を直した本"));
  notes.set("Books/moved.md", notes.get(`Books/${ids[1]}.md`));
  notes.delete(`Books/${ids[1]}.md`);
  notes.set(`Books/${renames.find(({ bookId: id }) => id === ids[2]).to}`, "# 同じ名前のメモ\n");
  const rename = files.rename;
  files.rename = async (path, fileName) => {
    if (path.includes(ids[3])) throw new Error("locked");
    return rename(path, fileName);
  };
  assert.deepEqual(await catalog.noteNames.rename(renames), {
    renamed: 0,
    skipped: 3,
    failed: 1,
  });
});
