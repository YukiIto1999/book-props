import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { chooseRecord } from "../src/adapters/bibliography-sources.ts";
import { readNdlItems } from "../src/adapters/ndl-records.ts";
import { resultMessage } from "../src/views/registration-messages.ts";
import { library, scope } from "./catalog-fixture.mjs";
import { core, notes as noteFormat } from "./core.mjs";

const isbn = "9784569857152";

function onlyBook(notes) {
  assert.equal(notes.size, 1);
  const [[, raw]] = notes;
  return noteFormat.read(raw).book;
}

const editionsOf = (book) =>
  book.editions.map(({ owned, isbns, publisher }) => ({ owned, isbns, publisher }));

void test("商品ページから付けた購入希望は、NDLが書名と著者を書き換えた後も同じ商品ページで見つかり、二度目で本を増やさない", async () => {
  const xml = readFileSync(new URL(`./fixtures/ndl/isbn-${isbn}.xml`, import.meta.url), "utf8");
  const record = chooseRecord(readNdlItems(xml), isbn, core);
  const { notes, catalog } = scope(undefined, undefined, library(new Map([[isbn, record]])));
  // Amazonの商品ページは、書名に読みを添え、イラストの担当まで著者に並べる。
  const page = {
    title: "夜廻(よまわり)三",
    authors: ["日本一ソフトウェア", "黒 史郎", "溝上 侑（日本一ソフトウェア）"],
    isbns: [isbn],
    publisher: "PHP研究所",
  };
  const wish = { action: "setWish", product: page, lookup: true };
  assert.equal((await catalog.execute(wish)).kind, "saved");
  await catalog.bibliography.request();
  const book = onlyBook(notes);
  assert.equal(book.title, "夜廻三");
  assert.deepEqual(book.authors, ["日本一ソフトウェア", "黒 史郎"]);
  assert.equal(book.wanted, true);

  const inspected = await catalog.execute({ action: "inspect", product: page });
  assert.equal(inspected.kind, "observed");
  assert.equal(inspected.outcome.wanted, true);
  assert.equal(inspected.outcome.ownership, "unowned");
  const stored = new Map(notes);
  const again = await catalog.execute(wish);
  assert.equal(again.kind, "observed");
  assert.equal(resultMessage(again, "setWish"), "この本はすでに欲しい本に入っています。");
  assert.deepEqual(notes, stored);
  assert.deepEqual(editionsOf(onlyBook(notes)), [
    { owned: false, isbns: [isbn], publisher: "PHP研究所" },
  ]);
});

void test("購入希望をすでに持つ本への追加と、持たない本からの解除は、何も書かずにその状態を伝える", async () => {
  const { notes, catalog } = scope();
  const product = { title: "夜廻三", authors: ["黒 史郎"] };
  assert.equal((await catalog.execute({ action: "setWish", product })).kind, "saved");
  const wanted = new Map(notes);
  const added = await catalog.execute({ action: "setWish", product });
  assert.equal(resultMessage(added, "setWish"), "この本はすでに欲しい本に入っています。");
  assert.deepEqual(notes, wanted);

  assert.equal((await catalog.execute({ action: "clearWish", product })).kind, "saved");
  const unwanted = new Map(notes);
  const cleared = await catalog.execute({ action: "clearWish", product });
  assert.equal(resultMessage(cleared, "clearWish"), "この本は欲しい本に入っていません。");
  assert.deepEqual(notes, unwanted);
  const unknown = await catalog.execute({
    action: "clearWish",
    product: { title: "別の本", authors: ["誰か"] },
  });
  assert.equal(resultMessage(unknown, "clearWish"), "変更対象がありません。");
});

void test("版のない購入希望の本にISBNを添えて購入希望を付けると、そのISBNを未所有の版として残す", async () => {
  const { notes, catalog } = scope();
  notes.set(
    "Books/夜廻三.md",
    noteFormat.create({
      id: "5b6e4d5e-8a43-4c1b-9d0e-1f2a3b4c5d6e",
      title: "夜廻三",
      authors: ["日本一ソフトウェア", "黒 史郎"],
      wanted: true,
      editions: [],
      appliedPurchases: [],
    }),
  );
  const product = { title: "夜廻三", authors: ["日本一ソフトウェア", "黒史郎"], isbns: [isbn] };
  assert.equal((await catalog.execute({ action: "setWish", product })).kind, "saved");
  const book = onlyBook(notes);
  assert.equal(book.wanted, true);
  assert.deepEqual(editionsOf(book), [{ owned: false, isbns: [isbn], publisher: undefined }]);
});
