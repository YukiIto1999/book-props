import assert from "node:assert/strict";
import test from "node:test";
import { parse } from "yaml";
import { booksBase, booksBasePath, placeBooksBase } from "../src/views/books-base.ts";
import { notes } from "./core.mjs";

// 本ページの書式が書きうる項目をすべて埋めた本。一覧が参照してよいキーの見本にする。
const fullBook = {
  id: "4fa20a45-80a4-4c8c-b74c-c3e307076da5",
  title: "読みやすい設計入門",
  authors: ["山田 花子"],
  tags: ["設計"],
  wanted: true,
  readingStatus: "reading",
  finishedOn: "2026-11-20",
  archivedAt: "2026-11-21T10:00:00Z",
  editions: [
    {
      id: "44c09e2e-4f07-4bed-9a59-300146205362",
      label: "初版",
      isbns: ["9784000000017"],
      owned: true,
      publisher: "技術書房",
      publishedOn: "2026-01-10",
      cover: "https://example.com/cover.jpg",
      purchasedOn: "2026-02-01",
      purchasedFrom: "書店",
      archivedAt: "2026-11-21T10:00:00Z",
    },
  ],
  appliedPurchases: [],
};

const writtenKeys = () => {
  const raw = notes.create(fullBook);
  const root = parse(raw.slice("---\n".length, raw.lastIndexOf("---\n")));
  const managed = root["book-props"];
  return {
    note: new Set(Object.keys(root)),
    managed: new Set(Object.keys(managed)),
    edition: new Set(Object.keys(managed.editions[0])),
  };
};

const matches = (text, pattern) => [...text.matchAll(pattern)].map((match) => match[1] ?? match[2]);
const expressions = (base) => [
  ...base.filters.and,
  ...Object.values(base.formulas),
  ...base.views.flatMap((view) => view.filters?.and ?? []),
];
// 一覧の表示や並べ替えで名前だけ書いた項目。`formula.`と`file.`以外は本ページのプロパティ。
const propertyNames = (base) => [
  ...Object.keys(base.properties),
  ...base.views.flatMap((view) => [
    ...view.order,
    ...(view.sort ?? []).map(({ property }) => property),
    ...(view.groupBy ? [view.groupBy.property] : []),
    ...Object.keys(view.columnSize ?? {}),
    ...(view.image ? [view.image] : []),
  ]),
];

void test("一覧のファイルはYAMLとして読め、書籍フォルダの本ページだけを対象にする", () => {
  const base = parse(booksBase("Tom's 本"));
  assert.deepEqual(base.filters.and.slice(0, 3), [
    `file.inFolder("Tom's 本")`,
    'file.ext == "md"',
    'file.hasProperty("book-props")',
  ]);
  assert.deepEqual(
    base.views.map(({ type, name }) => `${type}:${name}`),
    [
      "cards:表紙",
      "table:すべての本",
      "table:出版社別",
      "table:著者別",
      "table:欲しい本",
      "table:読書状態別",
      "table:同じ著者の本",
    ],
  );
  assert.deepEqual(parse(booksBase('棚"A"')).filters.and[0], 'file.inFolder("棚\\"A\\"")');
});

void test("一覧が参照するキーは、本ページの書式が書くキーだけである", () => {
  const base = parse(booksBase("本"));
  const written = writtenKeys();
  const text = expressions(base).join("\n");
  const noteKeys = [
    ...matches(text, /(?:note|this)\["([^"]+)"\]/g),
    ...propertyNames(base)
      .filter((name) => !/^(?:formula|file)\./.test(name))
      .map((name) => name.replace(/^note\./, "")),
  ];
  const managedKeys = matches(text, /note\["book-props"\](?:\["([^"]+)"\]|\.([\w-]+))/g);
  const editionKeys = matches(text, /\bvalue(?:\["([^"]+)"\]|\.([\w-]+))/g);
  assert.ok(editionKeys.length > 0);
  for (const key of noteKeys) assert.ok(written.note.has(key), `本ページのキー ${key}`);
  for (const key of managedKeys) assert.ok(written.managed.has(key), `book-propsのキー ${key}`);
  for (const key of editionKeys) assert.ok(written.edition.has(key), `版のキー ${key}`);

  const formulas = new Set(Object.keys(base.formulas));
  const usedFormulas = [
    ...propertyNames(base),
    ...matches(text, /\bformula\.(\w+)/g).map((name) => `formula.${name}`),
  ]
    .filter((name) => name.startsWith("formula."))
    .map((name) => name.slice("formula.".length));
  for (const name of usedFormulas) assert.ok(formulas.has(name), `式 ${name}`);
});

void test("読書状態は本棚と同じ表示名に変え、未設定は「未設定」にする", () => {
  const { reading } = parse(booksBase("本")).formulas;
  for (const [value, label] of [
    ["unread", "未読"],
    ["reading", "読書中"],
    ["rereading", "再読中"],
    ["finished", "読了"],
    ["reference", "参照用"],
  ]) {
    assert.ok(reading.includes(`note["book-reading-status"] == "${value}", "${label}"`), value);
  }
  assert.ok(reading.endsWith('"未設定")))))'));
});

void test("値のない項目の否定は、Basesで真にならないので isTruthy() を通す", () => {
  const text = expressions(parse(booksBase("本"))).join("\n");
  const negations = /!(?:note|value)(?:\["[^"]+"\]|\.[\w-]+\b(?!\())+(?:\.\w+\(\))?/g;
  for (const [negation] of text.matchAll(negations)) {
    assert.match(negation, /\.isTruthy\(\)$/, negation);
  }
});

const fakeVault = (paths) => {
  const created = [];
  return {
    created,
    exists: (path) => paths.includes(path),
    create: async (path, text) => {
      created.push({ path, text });
    },
  };
};

void test("一覧のファイルがなければVaultの直下に作る", async () => {
  const vault = fakeVault([]);
  assert.equal(await placeBooksBase(vault, "本"), "created");
  assert.deepEqual(vault.created, [{ path: "本の一覧.base", text: booksBase("本") }]);
  assert.equal(booksBasePath, "本の一覧.base");
});

void test("同じ名前のファイルがあれば書き換えない", async () => {
  const vault = fakeVault(["本の一覧.base"]);
  assert.equal(await placeBooksBase(vault, "本"), "existing");
  assert.deepEqual(vault.created, []);
});
