import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { core } from "./core.mjs";

// shelf.ts の画面部は Obsidian の Modal を継承する。純粋な絞り込みだけを読み込むため、型定義しかない obsidian を空のクラスで解決する。
const obsidian = `data:text/javascript,${encodeURIComponent("export class Modal {} export class Setting {}")}`;
registerHooks({
  resolve: (specifier, context, next) =>
    specifier === "obsidian" ? { url: obsidian, shortCircuit: true } : next(specifier, context),
});
const { emptyFilter } = await import("../src/shelf.ts");
const { ShelfQuery } = await import("../src/shelf-query.ts");
const selectBooks = (entries, filter) => {
  const shelf = ShelfQuery.open(core, entries);
  try {
    return shelf.select(filter).rows.map(({ entry }) => entry);
  } finally {
    shelf.close();
  }
};

// 書名、版の出版社、独自項目「メモ」。undefined は値がないことを表す。
const rows = [
  ["さくら", "新潮社", undefined],
  ["サクラ", "しんちょう", "第10巻"],
  ["桜", undefined, "さくら"],
  ["Sakura", "Shincho", undefined],
  ["sakura", "shincho", "Sakura"],
  ["第2巻", "第2版出版", "第2巻"],
  ["第10巻", "第10版出版", undefined],
  ["第２巻", "", "sakura"],
  ["第１０巻", "アスキー", "ｻｸﾗ"],
  ["あいうえお", undefined, undefined],
  ["アイウエオ", "あすきー", "123"],
  ["abc", "10", "第２巻"],
  ["ABC", "9", undefined],
  ["", "１０", ""],
  ["123", "", "abc"],
  ["１２３", undefined, undefined],
  ["ｻｸﾗ", "ｱｽｷｰ", "桜"],
];
const entries = rows.map(([title, publisher, memo], index) => ({
  path: `Books/${String(index).padStart(2, "0")}.md`,
  book: {
    id: `book-${index}`,
    title,
    authors: [],
    wanted: false,
    appliedPurchases: [],
    editions:
      publisher === undefined
        ? []
        : [{ id: `edition-${index}`, owned: true, isbns: [], publisher }],
    customFields: memo === undefined ? [] : [{ name: "メモ", kind: "text", value: memo }],
  },
}));
const titles = (sort, descending) =>
  selectBooks(entries, { ...emptyFilter, sort, descending }).map(({ book }) => book.title);

void test("書名の並びは、かな・漢字・英字・全角と半角の数字を日本語の順で比べ、巻数は数値として比べる", () => {
  assert.deepEqual(titles("title", false), [
    "",
    "123",
    "１２３",
    "abc",
    "ABC",
    "Sakura",
    "sakura",
    "あいうえお",
    "アイウエオ",
    "さくら",
    "サクラ",
    "ｻｸﾗ",
    "桜",
    "第2巻",
    "第２巻",
    "第10巻",
    "第１０巻",
  ]);
  assert.deepEqual(titles("title", true), [
    "第10巻",
    "第１０巻",
    "第2巻",
    "第２巻",
    "桜",
    "さくら",
    "サクラ",
    "ｻｸﾗ",
    "あいうえお",
    "アイウエオ",
    "Sakura",
    "sakura",
    "abc",
    "ABC",
    "123",
    "１２３",
    "",
  ]);
});

void test("版の値で並べると、値のない本と空の値の本は向きにかかわらず最後に書名の順で並ぶ", () => {
  assert.deepEqual(titles("publisher", false), [
    "ABC",
    "",
    "abc",
    "Sakura",
    "sakura",
    "ｻｸﾗ",
    "アイウエオ",
    "第１０巻",
    "サクラ",
    "さくら",
    "第2巻",
    "第10巻",
    "123",
    "１２３",
    "あいうえお",
    "桜",
    "第２巻",
  ]);
  assert.deepEqual(titles("publisher", true), [
    "第10巻",
    "第2巻",
    "さくら",
    "サクラ",
    "アイウエオ",
    "第１０巻",
    "ｻｸﾗ",
    "Sakura",
    "sakura",
    "",
    "abc",
    "ABC",
    "123",
    "１２３",
    "あいうえお",
    "桜",
    "第２巻",
  ]);
});

void test("独自項目で並べると、空の文字列は値として先頭に並び、項目のない本は最後になる", () => {
  assert.deepEqual(titles("custom:メモ", false), [
    "",
    "アイウエオ",
    "123",
    "sakura",
    "第２巻",
    "桜",
    "第１０巻",
    "ｻｸﾗ",
    "abc",
    "第2巻",
    "サクラ",
    "１２３",
    "ABC",
    "Sakura",
    "あいうえお",
    "さくら",
    "第10巻",
  ]);
  assert.deepEqual(titles("custom:メモ", true), [
    "サクラ",
    "abc",
    "第2巻",
    "ｻｸﾗ",
    "桜",
    "第１０巻",
    "sakura",
    "第２巻",
    "123",
    "アイウエオ",
    "",
    "１２３",
    "ABC",
    "Sakura",
    "あいうえお",
    "さくら",
    "第10巻",
  ]);
});
