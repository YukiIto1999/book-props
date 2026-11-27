import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { chooseRecord } from "../src/adapters/bibliography-sources.ts";
import { readNdlItems } from "../src/adapters/ndl-records.ts";
import { library, scope } from "./catalog-fixture.mjs";
import { core, notes as noteFormat } from "./core.mjs";

const fixture = (isbn) =>
  readFileSync(new URL(`./fixtures/ndl/isbn-${isbn}.xml`, import.meta.url), "utf8");
const readable = "9784873115658";
const readableRecord = chooseRecord(readNdlItems(fixture(readable)), readable, core);
const ndlTitle = "リーダブルコード : より良いコードを書くためのシンプルで実践的なテクニック";

void test("NDLの書誌が示すいちばん新しい版の番号をとり、NDC8や版のないNDCの番号もとる", () => {
  const stating = (types) => {
    const subjects = types
      .map(([type, number]) => `<dc:subject xsi:type="dcndl:${type}">${number}</dc:subject>`)
      .join("");
    const xml = fixture("9784062880046").replace(
      /<dc:subject xsi:type="dcndl:NDC9">134\.97<\/dc:subject>/,
      subjects,
    );
    const [{ record }] = readNdlItems(xml);
    return [record.ndc, core.describeRecord(JSON.stringify(record)).classification];
  };
  // 1979年の「文化人類学入門」の書誌は、NDC8の番号だけを示す。
  assert.deepEqual(stating([["NDC8", "389"]]), [[{ edition: 8, number: "389" }], "389"]);
  assert.deepEqual(
    stating([
      ["NDC", "389.1"],
      ["NDC6", "389"],
    ]),
    [[{ number: "389.1" }, { edition: 6, number: "389" }], "389"],
  );
  assert.deepEqual(
    stating([
      ["NDC8", "913.5"],
      ["NDC10", "913.6"],
      ["NDLC", "KG1"],
    ])[1],
    "913.6",
  );
  assert.deepEqual(stating([]), [[], undefined]);
});

const enrichedBook = (classification) =>
  noteFormat.create({
    id: "ab6e4d5e-8a43-4c1b-9d0e-1f2a3b4c5d6e",
    title: ndlTitle,
    authors: ["Dustin Boswell", "Trevor Foucher", "角 征典"],
    authorRoles: [{ name: "角 征典", role: "訳" }],
    wanted: false,
    editions: [
      {
        id: "bb6e4d5e-8a43-4c1b-9d0e-1f2a3b4c5d6e",
        owned: true,
        isbns: [readable],
        publisher: "オライリー・ジャパン",
        series: [{ isbn: readable, name: "THEORY/IN/PRACTICE" }],
      },
    ],
    appliedPurchases: [],
    ...(classification === undefined ? {} : { classification }),
  }) + "\n本文\n";

/** 登録やNDLの書誌で足した、分類の番号と要目の名前の行。`book-props`の前に入る。 */
const addedClassification =
  /^book-ndc: "007\.64"\nbook-ndc-section: "007 情報科学"\n(?=book-props:)/m;
void test("表記をそろえる案は、NDLで確かめると分類の番号のない本にだけ番号と要目の名前を入れる", async () => {
  const lookup = library(new Map([[readable, readableRecord]]));
  const { notes, catalog } = scope(undefined, undefined, lookup);
  notes.set("Books/enriched.md", enrichedBook());
  notes.set("Books/classified.md", enrichedBook("007.6"));
  const signal = new AbortController().signal;
  assert.deepEqual((await catalog.bibliography.propose(false, signal, () => {})).proposals, []);
  const { proposals } = await catalog.bibliography.propose(true, signal, () => {});
  assert.deepEqual(
    proposals.map(({ path, revision }) => [path, revision]),
    [["Books/enriched.md", { classification: "007.64", editions: [] }]],
  );
  assert.deepEqual(await catalog.bibliography.apply(proposals), {
    applied: 1,
    changed: 0,
    failed: 0,
  });
  const raw = notes.get("Books/enriched.md");
  assert.match(raw, addedClassification);
  assert.equal(raw.replace(addedClassification, ""), enrichedBook());
  assert.equal(noteFormat.read(raw).book.classification, "007.64");
});

void test("手で書き換えた分類の番号に要目の名前を合わせ、合っている本ページは書き換えない", async () => {
  const { notes, catalog } = scope();
  const path = "Books/enriched.md";
  const original = enrichedBook("007.64");
  assert.match(original, /^book-ndc: "007\.64"\nbook-ndc-section: 007 情報科学\n/m);
  notes.set(path, original);
  await catalog.bibliography.followClassification(path);
  assert.equal(notes.get(path), original);

  notes.set(path, original.replace('book-ndc: "007.64"', "book-ndc: 913.6"));
  await catalog.bibliography.followClassification(path);
  assert.match(
    notes.get(path),
    /^book-ndc: 913\.6\nbook-ndc-section: "913 日本文学--小説．物語"\n/m,
  );

  // Obsidianが数値として書いた番号も、3桁の番号として読む。
  notes.set(path, notes.get(path).replace("book-ndc: 913.6", "book-ndc: 7.64"));
  await catalog.maintain();
  assert.match(notes.get(path), /^book-ndc: 7\.64\nbook-ndc-section: "007 情報科学"\n/m);

  notes.set(path, original.replace('book-ndc: "007.64"\n', ""));
  await catalog.maintain();
  assert.equal(notes.get(path), original.replace(/book-ndc: .*\nbook-ndc-section: .*\n/, ""));
  assert.equal(noteFormat.read(notes.get(path)).book.classification, undefined);

  notes.set(path, original.replace('book-ndc: "007.64"', "book-ndc: 分類なし"));
  await catalog.maintain();
  const unreadable = noteFormat.read(notes.get(path)).book;
  assert.equal(unreadable.classification, "分類なし");
  assert.doesNotMatch(notes.get(path), /book-ndc-section/);
});

void test("登録で番号のない本にだけ分類の番号を書き、手で書いた番号は変えない", () => {
  const raw = enrichedBook();
  const update = { wanted: false, classification: "007.64" };
  const written = noteFormat.writeUpdate(raw, update);
  assert.match(written, addedClassification);
  assert.equal(written.replace(addedClassification, ""), raw);
  const handWritten = enrichedBook("007.6");
  assert.equal(noteFormat.writeUpdate(handWritten, update), handWritten);
});
