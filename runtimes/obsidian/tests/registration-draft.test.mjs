import assert from "node:assert/strict";
import test from "node:test";
import { readBookNote } from "../src/book-note.ts";
import { draftProduct, inputValues } from "../src/registration-draft.ts";
import { first, key, original, product, row, scope } from "./catalog-fixture.mjs";

// 書誌検索や商品ページから選んだ書誌。表紙と出版日は登録画面の入力欄に出ない。
const fetched = {
  title: product.title,
  authors: product.authors,
  isbns: first.isbns,
  publisher: "技術評論社",
  publishedOn: "2024-12-25",
  cover: "https://example.com/cover.jpg",
};

async function purchase(initial, values) {
  const space = scope(initial);
  const draft = draftProduct(fetched, { ...inputValues(fetched), ...values }, space.catalog);
  const saved = await space.catalog.execute({
    action: "purchase",
    product: draft,
    purchase: key(),
  });
  assert.equal(saved.kind, "saved");
  return space.notes;
}

void test("書誌を選んだ後に入力を別の本へ書き換えると、元の書誌の表紙と出版日を保存しない", async () => {
  const notes = await purchase(undefined, {
    title: "The C Programming Language",
    authors: "Brian W. Kernighan、Dennis M. Ritchie",
    isbns: "9780131103627",
    label: "",
    publisher: "Prentice Hall",
  });
  const [raw] = notes.values();
  const [edition] = readBookNote(raw).book.editions;
  assert.deepEqual(edition.isbns, ["9780131103627"]);
  assert.equal(edition.publisher, "Prentice Hall");
  assert.equal(edition.publishedOn, undefined);
  assert.equal(edition.cover, undefined);
});

void test("同じISBNのまま出版社を直すと、元の書誌の出版日と表紙も既存の版の空欄を補う", async () => {
  const notes = await purchase(original, { publisher: "新潮社" });
  const [edition] = readBookNote(notes.get(row)).book.editions;
  assert.equal(edition.publisher, "新潮社");
  assert.equal(edition.publishedOn, fetched.publishedOn);
  assert.equal(edition.cover, fetched.cover);
});

void test("書誌の由来は、ISBNなら同じ本のISBN-10でも保ち、ISBNのない書誌は書名と著者が元のままの間だけ保つ", () => {
  const { catalog } = scope();
  const values = inputValues(fetched);
  assert.equal(
    draftProduct(fetched, { ...values, isbns: "0-306-40615-2" }, catalog).cover,
    fetched.cover,
  );
  assert.equal(draftProduct(fetched, { ...values, isbns: "" }, catalog).cover, undefined);
  const unnumbered = { ...fetched, isbns: [] };
  const named = inputValues(unnumbered);
  assert.equal(
    draftProduct(unnumbered, { ...named, publisher: "新潮社" }, catalog).publishedOn,
    fetched.publishedOn,
  );
  assert.equal(
    draftProduct(unnumbered, { ...named, title: "別の本" }, catalog).publishedOn,
    undefined,
  );
  assert.equal(
    draftProduct(unnumbered, { ...named, authors: "別の 著者" }, catalog).cover,
    undefined,
  );
  assert.equal(
    draftProduct(unnumbered, { ...named, label: "第3版" }, catalog).publishedOn,
    undefined,
  );
});
