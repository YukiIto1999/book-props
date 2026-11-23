import assert from "node:assert/strict";
import test from "node:test";

import { readBookNote } from "../src/book-note.ts";
import {
  decodePortableLibrary,
  encodePortableLibrary,
  PortableLibraryError,
} from "../src/portable-library.ts";

const bookId = "4fa20a45-80a4-4c8c-b74c-c3e307076da5";
const otherBookId = "0b6f4c1e-3a2d-4e5f-8a9b-1c2d3e4f5a6b";
const initialEdition = "44c09e2e-4f07-4bed-9a59-300146205362";
const revisedEdition = "13b6227d-1526-4116-b1f4-7657a44660de";
const otherEdition = "874c79b8-f25d-4c6b-8c84-3582922a7120";
const purchase =
  "[{request-id: 037516ec-8d03-4db4-a13b-1062fbaad566, client-id: 38605c33-2b34-44ae-8e19-83b319e93a61, " +
  'input-hash: 70f4fc2bf7dcb3ebdaab9093c735fae0e2a7250b910a7eea5754f77bfba64574, applied-at: "2026-11-21T10:00:00Z", ' +
  `result: {book-id: ${bookId}, edition-id: ${revisedEdition}}}]`;
const body = "\n## 読書メモ\n初版の第3章を読み返す。\n\n- [ ] 付箋を整理する\n[[設計メモ]]\n";
const crlf = (text) => text.replaceAll("\n", "\r\n");

const purchased = crlf(`---
book-title: 読みやすい設計入門
book-authors: [山田 花子, 佐藤 次郎]
book-wanted: true # user comment
book-reading-status: reading
tags: [設計, あとで読む]
my-rating: 4 # personal property
my-shelf:
  room: 書斎
  slots: [{row: 2, note: "左端"}]
book-props:
  schema: 1
  book-id: ${bookId}
  editions:
    - id: ${initialEdition}
      label: 初版
      isbns: ["9784000000017", "9784000000031"]
      owned: true
      purchased-from: 近所の書店
    - id: ${revisedEdition}
      label: 改訂版
      isbns: ["9784000000024"]
      publisher: 手入力の出版社 # do not replace
      owned: false
  applied-purchases: ${purchase}
---
${body}`);

const other = `\uFEFF---
book-title: 二冊目
book-wanted: false
book-props:
  schema: 1
  book-id: ${otherBookId}
  archived-at: "2026-11-01T00:00:00Z"
  editions:
    - id: ${otherEdition}
      isbns: []
      owned: false
  applied-purchases: []
---
本文だけ
`;

function rejects(run, code) {
  assert.throws(run, (error) => error instanceof PortableLibraryError && error.code === code);
}

function library(notes, overrides = {}) {
  return JSON.stringify({ format: "book-props-vault", version: 1, notes, ...overrides });
}

void test("a JSON round trip restores every note byte for byte except the purchase re-check records", () => {
  const json = encodePortableLibrary([purchased, other]);
  const document = JSON.parse(json);
  assert.deepEqual(Object.keys(document), ["format", "version", "notes"]);
  assert.equal(document.format, "book-props-vault");
  assert.equal(document.version, 1);
  assert.ok(document.notes.every((note) => Object.keys(note).join() === "bookId,markdown"));
  assert.ok(!json.includes("request-id") && !json.includes("38605c33") && !json.includes('.md"'));

  const notes = decodePortableLibrary(json);
  assert.deepEqual(
    notes.map((note) => note.bookId),
    [otherBookId, bookId],
  );
  const restored = notes.find((note) => note.bookId === bookId).markdown;
  assert.equal(
    restored,
    purchased.replace(`applied-purchases: ${purchase}`, "applied-purchases: []"),
  );
  assert.ok(restored.endsWith(crlf(body)));
  assert.ok(!restored.replaceAll("\r\n", "").includes("\n"));
  assert.deepEqual(readBookNote(restored).book, {
    ...readBookNote(purchased).book,
    appliedPurchases: [],
  });
  assert.equal(notes.find((note) => note.bookId === otherBookId).markdown, other);
});

void test("exporting the imported notes again gives the same JSON", () => {
  const json = encodePortableLibrary([purchased, other]);
  assert.equal(
    encodePortableLibrary(decodePortableLibrary(json).map((note) => note.markdown)),
    json,
  );
  assert.deepEqual(decodePortableLibrary(encodePortableLibrary([])), []);
});

void test("export accepts only readable managed notes", () => {
  rejects(() => encodePortableLibrary(["# 普通のメモ\n"]), "invalid-note");
  rejects(() => encodePortableLibrary(["---\ntags: [設計]\n---\n本文\n"]), "invalid-note");
  rejects(
    () => encodePortableLibrary([other.replace("book-wanted: false", "book-wanted: maybe")]),
    "invalid-note",
  );
  rejects(() => encodePortableLibrary([other.replace("schema: 1", "schema: 2")]), "invalid-note");
});

void test("export refuses duplicate book IDs and edition IDs instead of choosing one note", () => {
  rejects(() => encodePortableLibrary([other, other]), "duplicate-id");
  const copiedEdition = other
    .replace(otherBookId, "9d3c1b2a-7e6f-4a5b-9c8d-0e1f2a3b4c5d")
    .replace(otherEdition, initialEdition);
  rejects(() => encodePortableLibrary([purchased, copiedEdition]), "duplicate-id");
});

void test("import rejects anything that is not the versioned schema", () => {
  const note = { bookId: otherBookId, markdown: other };
  rejects(() => decodePortableLibrary("{"), "invalid-format");
  rejects(() => decodePortableLibrary("[]"), "invalid-format");
  rejects(() => decodePortableLibrary(library([note], { format: "other" })), "invalid-format");
  rejects(
    () => decodePortableLibrary(JSON.stringify({ format: "book-props-vault", notes: [note] })),
    "invalid-format",
  );
  rejects(() => decodePortableLibrary(library([note], { version: "1" })), "invalid-format");
  rejects(() => decodePortableLibrary(library([note], { version: 2 })), "unsupported-version");
  rejects(() => decodePortableLibrary(library([note], { secret: "token" })), "invalid-format");
  rejects(() => decodePortableLibrary(library({ 0: note })), "invalid-format");
  rejects(
    () => decodePortableLibrary(library([{ ...note, path: "../outside.md" }])),
    "invalid-format",
  );
  rejects(() => decodePortableLibrary(library([{ bookId: otherBookId }])), "invalid-format");
  rejects(() => decodePortableLibrary(library([{ ...note, markdown: 1 }])), "invalid-format");
  rejects(
    () =>
      decodePortableLibrary('{"format":"book-props-vault","version":1,"notes":[],"__proto__":{}}'),
    "invalid-format",
  );
});

void test("import only returns IDs that match the note, so the ID cannot steer the file path", () => {
  rejects(
    () => decodePortableLibrary(library([{ bookId: bookId, markdown: other }])),
    "inconsistent-id",
  );
  rejects(
    () => decodePortableLibrary(library([{ bookId: `../${otherBookId}`, markdown: other }])),
    "inconsistent-id",
  );
  rejects(
    () => decodePortableLibrary(library([{ bookId: otherBookId.toUpperCase(), markdown: other }])),
    "inconsistent-id",
  );
});

void test("import rejects duplicate book IDs and edition IDs across notes", () => {
  const note = { bookId: otherBookId, markdown: other };
  rejects(() => decodePortableLibrary(library([note, note])), "duplicate-id");
  const copiedId = "9d3c1b2a-7e6f-4a5b-9c8d-0e1f2a3b4c5d";
  const copiedEdition = other.replace(otherBookId, copiedId);
  rejects(
    () => decodePortableLibrary(library([note, { bookId: copiedId, markdown: copiedEdition }])),
    "duplicate-id",
  );
});

void test("import rejects unmanaged notes and notes that still carry purchase re-check records", () => {
  rejects(
    () => decodePortableLibrary(library([{ bookId, markdown: "# 普通のメモ\n" }])),
    "invalid-note",
  );
  rejects(() => decodePortableLibrary(library([{ bookId, markdown: purchased }])), "invalid-note");
});
