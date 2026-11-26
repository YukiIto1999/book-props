import assert from "node:assert/strict";
import test from "node:test";

import {
  createBookNote,
  editEdition,
  readBookNote,
  readScopedNote,
  removeEdition,
  removePurchases,
  updateCustomField,
  writeBookUpdate,
} from "../src/book-note.ts";

const bookId = "4fa20a45-80a4-4c8c-b74c-c3e307076da5";
const initialEdition = "44c09e2e-4f07-4bed-9a59-300146205362";
const revisedEdition = "13b6227d-1526-4116-b1f4-7657a44660de";
const receipt = {
  requestId: "037516ec-8d03-4db4-a13b-1062fbaad566",
  clientId: "38605c33-2b34-44ae-8e19-83b319e93a61",
  inputHash: "70f4fc2bf7dcb3ebdaab9093c735fae0e2a7250b910a7eea5754f77bfba64574",
  appliedAt: "2026-11-21T10:00:00Z",
  bookId,
  editionId: revisedEdition,
};
const body = "\n## 読書メモ\n初版の第3章を読み返す。\n\n[[設計メモ]]\n";
const note = `---
book-title: 読みやすい設計入門
book-authors: [山田 花子]
book-wanted: true # user comment
book-reading-status: reading
tags: [設計]
my-rating: 4 # personal property
book-props:
  schema: 1
  book-id: ${bookId}
  editions:
    - id: ${initialEdition}
      label: 初版
      isbns: ["9784000000017", "9784000000031"]
      owned: true
    - id: ${revisedEdition}
      label: 改訂版
      isbns: ["9784000000024"]
      publisher: 手入力の出版社 # do not replace
      owned: false
  applied-purchases: []
---
${body}`;

void test("saving a revised edition owns it, clears the wish, and preserves the other text byte for byte", () => {
  const [, revision] = readBookNote(note).book.editions;
  const saved = writeBookUpdate(note, {
    wanted: false,
    edition: { ...revision, owned: true },
    receipt,
  });
  const reread = readBookNote(saved);
  assert.equal(reread.book.wanted, false);
  assert.deepEqual(
    reread.book.editions.map(({ id, owned }) => ({ id, owned })),
    [
      { id: initialEdition, owned: true },
      { id: revisedEdition, owned: true },
    ],
  );
  assert.deepEqual(reread.book.appliedPurchases, [receipt]);
  const lines = saved.split("\n");
  const row = lines.findIndex((line) => line === "  applied-purchases:");
  const end = lines.indexOf("---", row + 1);
  assert.ok(row >= 0 && end > row);
  lines.splice(row, end - row, "  applied-purchases: []");
  assert.equal(
    lines.join("\n"),
    note
      .replace("true # user comment", "false # user comment")
      .replace("owned: false", "owned: true"),
  );
});

void test("new notes can add a purchased edition and append another receipt without touching body or earlier rows", () => {
  let raw =
    createBookNote({
      id: bookId,
      title: "書名: 例",
      authors: [],
      wanted: true,
      editions: [],
      appliedPurchases: [],
    }) + body;
  const edition = { id: revisedEdition, owned: true, isbns: ["9780201633610"] };
  raw = writeBookUpdate(raw, { wanted: false, edition, receipt });
  const next = { ...receipt, requestId: "13b6227d-1526-4116-b1f4-7657a44660de" };
  raw = writeBookUpdate(raw, { wanted: false, edition, receipt: next });
  const { book } = readBookNote(raw);
  assert.equal(book.title, "書名: 例");
  assert.deepEqual(book.appliedPurchases, [receipt, next]);
  assert.deepEqual(
    book.editions.map(({ id, owned }) => ({ id, owned })),
    [{ id: revisedEdition, owned: true }],
  );
  assert.ok(raw.endsWith(body));
});

void test("adding an ISBN alias and filling a blank date do not rewrite a manually edited publisher", () => {
  const revised = {
    ...readBookNote(note).book.editions[1],
    isbns: ["9784000000024", "9780201633610"],
    purchasedOn: "2026-10-09",
    publisher: "カタログからの値",
  };
  const source = note.replace(
    "      owned: false",
    "      purchased-on: # leave this comment\n      owned: false",
  );
  const updated = writeBookUpdate(source, { wanted: true, edition: revised });
  const row = readBookNote(updated).book.editions[1];
  assert.deepEqual(row.isbns, revised.isbns);
  assert.equal(row.purchasedOn, "2026-10-09");
  assert.equal(row.publisher, "手入力の出版社");
  assert.ok(updated.includes("# leave this comment"));
});

void test("expiry deletes only old receipt data, even when the last receipt is removed", () => {
  const [, edition] = readBookNote(note).book.editions;
  const fresh = {
    ...receipt,
    requestId: "874c79b8-f25d-4c6b-8c84-3582922a7120",
    appliedAt: "2026-12-03T10:00:00Z",
  };
  let raw = writeBookUpdate(note, { wanted: true, edition, receipt });
  raw = writeBookUpdate(raw, { wanted: true, edition, receipt: fresh });
  const pruned = removePurchases(raw, () => [true, false]);
  assert.deepEqual(readBookNote(pruned).book.appliedPurchases, [fresh]);
  const last = removePurchases(pruned, () => [true]);
  assert.deepEqual(readBookNote(last).book.appliedPurchases, []);
  assert.deepEqual(readBookNote(last).book.editions, readBookNote(note).book.editions);
  assert.ok(last.includes("my-rating: 4 # personal property"));
  assert.ok(last.endsWith(body));
});

void test("user fields retain their type and can be removed without dropping other book properties", () => {
  const amount = { name: "支出額", kind: "number", value: 0 };
  const choice = { name: "貸出の対象外", kind: "choice", value: "私用", choices: ["私用", "業務"] };
  const flag = { name: "査読済み", kind: "boolean", value: false };
  let raw = note;
  for (const field of [amount, choice, flag]) raw = updateCustomField(raw, undefined, field);
  assert.deepEqual(readBookNote(raw).book.customFields, [amount, choice, flag]);
  assert.throws(() => updateCustomField(raw, choice, { ...choice, value: "未定義" }));
  const removed = updateCustomField(raw, choice, undefined);
  assert.deepEqual(readBookNote(removed).book.customFields, [amount, flag]);
  assert.ok(removed.includes("my-rating: 4 # personal property"));
  assert.ok(removed.endsWith(body));
});

void test("a note that lost only its opening --- is unreadable, while ordinary notes mentioning book-props are not books", () => {
  const unreadable = { name: "BookNoteError", code: "unreadable" };
  assert.throws(() => readScopedNote(note.slice("---\n".length)), unreadable);
  assert.throws(
    () => readScopedNote(`\uFEFF${note.slice("---\n".length).replaceAll("\n", "\r\n")}`),
    unreadable,
  );
  const manual = "# book-props の使い方\n\nbook-props: はプラグインです\n---\n本文\n";
  assert.equal(readScopedNote(manual), undefined);
  const declaredInBody = `メモ\nbook-props:\n  schema: 1\n  book-id: ${bookId}\n---\n`;
  assert.equal(readScopedNote(declaredInBody), undefined);
});

void test("changing or emptying a block ISBN list keeps the next field, CRLF line breaks and the body", () => {
  const blockIsbns = '      isbns:\n        - "9784000000024" # paper\n';
  const block = note
    .replace('      isbns: ["9784000000024"]\n', blockIsbns)
    .replaceAll("\n", "\r\n");
  const edition = readBookNote(block).book.editions[1];
  const changed = editEdition(block, { ...edition, isbns: ["9780201633610", "9784000000024"] });
  assert.equal(
    changed,
    block.replace(
      '        - "9784000000024" # paper\r\n',
      '        - "9780201633610"\r\n        - "9784000000024"\r\n',
    ),
  );
  assert.equal(
    editEdition(changed, { ...edition, isbns: [] }),
    block.replace('      isbns:\r\n        - "9784000000024" # paper\r\n', "      isbns: []\r\n"),
  );
  const compact = note.replace(
    '      isbns: ["9784000000024"]\n',
    '      isbns:\n      - "9784000000024"\n',
  );
  assert.equal(
    editEdition(compact, { ...edition, isbns: [] }),
    note.replace('isbns: ["9784000000024"]', "isbns: []"),
  );
});

void test("editing, adding or deleting one inline user field keeps unknown keys and the other fields", () => {
  const inline = note.replace(
    "  editions:\n",
    "  custom-fields: [{name: 支出額, kind: number, value: 1200, unit: 円}, {name: 冊数, kind: number, value: 1}]\n  editions:\n",
  );
  const spend = { name: "支出額", kind: "number", value: 1200 };
  const count = { name: "冊数", kind: "number", value: 1 };
  assert.equal(
    updateCustomField(inline, count, { ...count, value: 2 }),
    inline.replace("value: 1}]", "value: 2}]"),
  );
  assert.equal(
    updateCustomField(inline, spend, { ...spend, value: 1500 }),
    inline.replace("value: 1200,", "value: 1500,"),
  );
  assert.equal(
    updateCustomField(inline, spend, undefined),
    inline.replace("{name: 支出額, kind: number, value: 1200, unit: 円}, ", ""),
  );
});

void test("editing, adding or deleting one block user field rewrites only that row", () => {
  const rows = [
    "  custom-fields:",
    "    - name: 支出額 # 税込",
    "      kind: choice",
    "      choices: [安, 高]",
    "      value: 安",
    "      unit: 円",
    "    # 冊数の説明",
    "    -",
    "      name: 冊数",
    "      kind: number",
    "      value: 1",
    "  editions:",
    "",
  ];
  const listed = note.replace("  editions:\n", rows.join("\n"));
  const price = { name: "支出額", kind: "choice", value: "安", choices: ["安", "高"] };
  const count = { name: "冊数", kind: "number", value: 1 };
  assert.equal(
    updateCustomField(listed, count, { ...count, value: 2 }),
    listed.replace("      value: 1\n", "      value: 2\n"),
  );
  assert.equal(
    updateCustomField(listed, price, { name: "支出額", kind: "text", value: "安" }),
    listed.replace("      kind: choice\n      choices: [安, 高]\n", '      kind: "text"\n'),
  );
  assert.equal(
    updateCustomField(listed, count, undefined),
    listed.replace("    -\n      name: 冊数\n      kind: number\n      value: 1\n", ""),
  );
  assert.equal(
    updateCustomField(listed, undefined, { name: "査読済み", kind: "boolean", value: true }),
    listed.replace(
      "      value: 1\n",
      "      value: 1\n    - name: 査読済み\n      kind: boolean\n      value: true\n",
    ),
  );
});

void test("an edition whose - stands on its own line is removed without touching its neighbours", () => {
  const initialRows = `    - id: ${initialEdition}\n      label: 初版\n      isbns: ["9784000000017", "9784000000031"]\n      owned: true\n`;
  const revisedRows = `    - id: ${revisedEdition}\n      label: 改訂版\n      isbns: ["9784000000024"]\n      publisher: 手入力の出版社 # do not replace\n      owned: false\n`;
  const hyphen = note.replace(
    `    - id: ${revisedEdition}\n`,
    `    -\n      id: ${revisedEdition}\n`,
  );
  assert.equal(removeEdition(hyphen, revisedEdition), note.replace(revisedRows, ""));
  const separated = hyphen.replace(
    `    - id: ${initialEdition}\n`,
    `    -\n      id: ${initialEdition}\n`,
  );
  const left = removeEdition(separated, initialEdition);
  assert.equal(left, hyphen.replace(initialRows, ""));
  assert.equal(
    removeEdition(left, revisedEdition),
    note.replace(initialRows + revisedRows, "").replace("  editions:\n", "  editions: []\n"),
  );
});
