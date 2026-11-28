import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { chooseRecord } from "../src/adapters/bibliography-sources.ts";
import { readNdlItems } from "../src/adapters/ndl-records.ts";
import { inputHash } from "../src/catalog/purchase.ts";
import { key, library, scope } from "./catalog-fixture.mjs";
import { core, notes as noteFormat } from "./core.mjs";

const fixture = (name) =>
  readFileSync(new URL(`./fixtures/ndl/${name}.xml`, import.meta.url), "utf8");
const readable = "9784873115658";
const readableRecord = chooseRecord(readNdlItems(fixture(`isbn-${readable}`)), readable, core);
const storeProduct = {
  title:
    "リーダブルコード ―より良いコードを書くためのシンプルで実践的なテクニック (Theory in practice)",
  authors: ["ダスティン・ボズウェル", "トレバ-・フォシェ", "角 征典（翻訳）"],
  isbns: ["4873115655"],
  publisher: "オライリージャパン",
};
const ndlTitle = "リーダブルコード : より良いコードを書くためのシンプルで実践的なテクニック";

function onlyBook(notes) {
  assert.equal(notes.size, 1);
  const [[path, raw]] = notes;
  return { path, raw, book: noteFormat.read(raw).book };
}

void test("NDLの応答から書誌を読み、同じISBNの書誌が複数あれば国立国会図書館の蔵書の書誌を選ぶ", () => {
  const isbn = "9784048930642";
  const items = readNdlItems(fixture(`isbn-${isbn}`));
  assert.equal(items.length, 2);
  assert.deepEqual(
    items.map(({ ndl, record }) => [ndl, record.title]),
    [
      [true, "Clean Coder : プロフェッショナルプログラマへの道"],
      [false, "Clean coder (クリーンコーダー) : プロフェッショナルプログラマへの道"],
    ],
  );
  const chosen = chooseRecord([...items].reverse(), isbn, core);
  assert.deepEqual(chosen, {
    title: "Clean Coder : プロフェッショナルプログラマへの道",
    creators: ["Martin, Robert C", "角, 征典"],
    statement: "Robert C.Martin 著,角征典 訳",
    publishers: ["ドワンゴ", "KADOKAWA (発売)"],
    series: [],
    ndc: [{ edition: 10, number: "007.35" }],
  });
  assert.deepEqual(core.describeRecord(JSON.stringify(chosen)), {
    title: "Clean Coder : プロフェッショナルプログラマへの道",
    authors: ["Robert C Martin", "角 征典 (訳)"],
    publisher: "ドワンゴ",
    classification: "007.35",
  });
  assert.equal(chooseRecord(items, "9784873115658", core), undefined);
});

void test("NDLの書誌から、版の表記とシリーズと発行年月を読み、混み合った応答は誤りとする", () => {
  const [item] = readNdlItems(fixture("isbn-9784062880046"));
  assert.deepEqual(item.record.series, ["講談社現代新書 ; 2004"]);
  assert.deepEqual(item.record.ndc, [{ edition: 9, number: "134.97" }]);
  assert.equal(item.record.statement, "橋爪大三郎 著");
  assert.equal(item.issued, "2009.7");
  assert.deepEqual(item.isbns, ["978-4-06-288004-6"]);
  assert.deepEqual(core.describeRecord(JSON.stringify(item.record)), {
    title: "はじめての言語ゲーム",
    authors: ["橋爪 大三郎"],
    publisher: "講談社",
    series: "講談社現代新書 ; 2004",
    classification: "134.97",
  });
  assert.throws(() => readNdlItems(fixture("too-many-requests")));
});

void test("拡張からの購入は表記をそろえて先に保存し、後からNDLの書誌で書き換えても購入の記録の指紋は変わらない", async () => {
  const lookup = library(new Map([[readable, readableRecord]]));
  const { notes, catalog } = scope(undefined, undefined, lookup);
  const operation = { action: "purchase", product: storeProduct, purchase: key(), lookup: true };
  assert.equal((await catalog.execute(operation)).kind, "saved");
  await catalog.bibliography.request();
  const { book } = onlyBook(notes);
  assert.deepEqual(lookup.calls, [readable]);
  assert.equal(book.title, ndlTitle);
  assert.deepEqual(book.authors, ["Dustin Boswell", "Trevor Foucher", "角 征典"]);
  assert.deepEqual(book.authorRoles, [{ name: "角 征典", role: "訳" }]);
  const [edition] = book.editions;
  assert.equal(edition.publisher, "オライリー・ジャパン");
  assert.deepEqual(edition.series, [{ isbn: readable, name: "THEORY/IN/PRACTICE" }]);
  assert.equal(book.pendingLookup, undefined);
  assert.equal(book.classification, "007.64");
  assert.match(
    onlyBook(notes).raw,
    /^book-ndc: "007\.64"\nbook-ndc-section: "007 情報科学"\nbook-ndc-subsection: "007\.6 情報科学--データ処理．情報処理"\nbook-props:/m,
  );
  assert.equal(book.appliedPurchases[0].inputHash, await inputHash(operation));
  assert.equal((await catalog.execute(operation)).kind, "replayed");
  assert.equal((await catalog.reconcile(operation)).kind, "replayed");
});

void test("NDLに問い合わせられない間はそろえた表記のまま待ち、利用者が直した項目は書き換えない", async () => {
  const lookup = library(new Map([[readable, new Error("timeout")]]));
  const { notes, catalog } = scope(undefined, undefined, lookup);
  const operation = { action: "setWish", product: storeProduct, lookup: true };
  assert.equal((await catalog.execute(operation)).kind, "saved");
  await catalog.bibliography.request();
  const waiting = onlyBook(notes);
  assert.equal(
    waiting.book.title,
    "リーダブルコード : より良いコードを書くためのシンプルで実践的なテクニック (Theory in practice)",
  );
  assert.deepEqual(waiting.book.authors, [
    "ダスティン・ボズウェル",
    "トレバー・フォシェ",
    "角 征典",
  ]);
  assert.ok(waiting.book.pendingLookup);

  notes.set(waiting.path, waiting.raw.replace(/^book-title: .*$/m, "book-title: 自分で付けた書名"));
  lookup.answers.set(readable, readableRecord);
  await catalog.maintain();
  const { book } = onlyBook(notes);
  assert.equal(book.title, "自分で付けた書名");
  assert.deepEqual(book.authors, ["Dustin Boswell", "Trevor Foucher", "角 征典"]);
  assert.equal(book.pendingLookup, undefined);
  assert.deepEqual(lookup.calls, [readable, readable]);
  assert.equal(book.classification, "007.64");
});

void test("NDLに書誌がなければ、そろえた表記を残して照会を終える", async () => {
  const { notes, catalog, lookup } = scope();
  const operation = { action: "purchase", product: storeProduct, purchase: key(), lookup: true };
  assert.equal((await catalog.execute(operation)).kind, "saved");
  await catalog.bibliography.request();
  const { book } = onlyBook(notes);
  assert.deepEqual(lookup.calls, [readable]);
  assert.equal(book.editions[0].publisher, "オライリージャパン");
  assert.equal(book.pendingLookup, undefined);
  assert.equal(book.classification, undefined);
  assert.doesNotMatch(onlyBook(notes).raw, /book-ndc/);
});

void test("照合と照会を求めない登録は、NDLに問い合わせない", async () => {
  const lookup = library(new Map([[readable, new Error("must not be asked")]]));
  const { notes, catalog } = scope(undefined, undefined, lookup);
  const saved = await catalog.execute({ action: "setWish", product: storeProduct, lookup: true });
  assert.equal(saved.kind, "saved");
  await catalog.bibliography.request();
  lookup.calls.length = 0;
  const inspected = await catalog.execute({
    action: "inspect",
    product: storeProduct,
    lookup: true,
  });
  assert.equal(inspected.kind, "observed");
  assert.equal(
    (await catalog.preview({ action: "inspect", product: storeProduct })).kind,
    "observed",
  );
  assert.deepEqual(lookup.calls, []);

  const plain = scope(undefined, undefined, library());
  await plain.catalog.execute({ action: "setWish", product: storeProduct });
  await plain.catalog.maintain();
  assert.deepEqual(plain.lookup.calls, []);
  assert.equal(onlyBook(plain.notes).book.pendingLookup, undefined);
  assert.ok(notes.size === 1);
});

const unaligned = (id, title, authors) =>
  noteFormat.create({
    id,
    title,
    authors,
    wanted: false,
    editions: [],
    appliedPurchases: [],
  });

void test("表記をそろえる案は選んだ本にだけ書き、案を作った後に変わった本ページは書かない", async () => {
  const { notes, catalog } = scope();
  const pages = {
    "Books/a.md": unaligned("0b6e4d5e-8a43-4c1b-9d0e-1f2a3b4c5d6e", "入門：基礎", ["角征典"]),
    "Books/b.md": unaligned("1b6e4d5e-8a43-4c1b-9d0e-1f2a3b4c5d6e", "Ｃ言語", [
      "島田 浩二（翻訳）",
    ]),
    "Books/c.md": unaligned("2b6e4d5e-8a43-4c1b-9d0e-1f2a3b4c5d6e", "読書", [
      "菊池 たけし/F.E.A.R.",
    ]),
    "Books/d.md": unaligned("3b6e4d5e-8a43-4c1b-9d0e-1f2a3b4c5d6e", "そろった本", ["山田 太郎"]),
  };
  for (const [path, raw] of Object.entries(pages)) notes.set(path, raw);
  const progress = [];
  const { proposals, failedLookups } = await catalog.bibliography.propose(
    false,
    new AbortController().signal,
    (done, total) => progress.push([done, total]),
  );
  assert.equal(failedLookups, 0);
  assert.deepEqual(progress.at(-1), [4, 4]);
  assert.deepEqual(
    proposals.map(({ path, revision }) => [path, revision.title, revision.authors]),
    [
      ["Books/a.md", "入門 : 基礎", undefined],
      ["Books/b.md", "C言語", ["島田 浩二"]],
      ["Books/c.md", undefined, ["菊池 たけし", "F.E.A.R."]],
    ],
  );
  const [a, b] = proposals;
  notes.set("Books/b.md", `${pages["Books/b.md"]}\n後から書いた本文\n`);
  assert.deepEqual(await catalog.bibliography.apply([a, b]), { applied: 1, changed: 1, failed: 0 });
  assert.equal(noteFormat.read(notes.get("Books/a.md")).book.title, "入門 : 基礎");
  assert.equal(noteFormat.read(notes.get("Books/b.md")).book.title, "Ｃ言語");
  assert.equal(notes.get("Books/c.md"), pages["Books/c.md"]);
  assert.equal(notes.get("Books/d.md"), pages["Books/d.md"]);
});

void test("NDLで確かめる案は、ISBNごとに一度だけ問い合わせ、失敗した数を返し、中止できる", async () => {
  const lookup = library(new Map([[readable, readableRecord]]));
  const { notes, catalog } = scope(undefined, undefined, lookup);
  const edition = (id, isbn) => ({ id, owned: true, isbns: [isbn] });
  notes.set(
    "Books/readable.md",
    noteFormat.create({
      id: "4b6e4d5e-8a43-4c1b-9d0e-1f2a3b4c5d6e",
      title: "リーダブルコード (Theory in practice)",
      authors: ["ダスティン・ボズウェル"],
      wanted: false,
      editions: [edition("5b6e4d5e-8a43-4c1b-9d0e-1f2a3b4c5d6e", readable)],
      appliedPurchases: [],
    }),
  );
  notes.set(
    "Books/other.md",
    noteFormat.create({
      id: "6b6e4d5e-8a43-4c1b-9d0e-1f2a3b4c5d6e",
      title: "別の本",
      authors: [],
      wanted: false,
      editions: [edition("7b6e4d5e-8a43-4c1b-9d0e-1f2a3b4c5d6e", "9784062880046")],
      appliedPurchases: [],
    }),
  );
  lookup.answers.set("9784062880046", new Error("unreachable"));
  const signal = new AbortController().signal;
  const { proposals, failedLookups } = await catalog.bibliography.propose(true, signal, () => {});
  assert.deepEqual(lookup.calls, ["9784062880046", readable]);
  assert.equal(failedLookups, 1);
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].revision.title, ndlTitle);
  assert.equal(proposals[0].revision.editions[0].publisher, "オライリー・ジャパン");
  assert.equal(proposals[0].revision.classification, "007.64");

  const stopped = new AbortController();
  stopped.abort();
  await assert.rejects(catalog.bibliography.propose(true, stopped.signal, () => {}));
});

void test("著者の役割と版のシリーズと照会待ちの記録は本ページに書き、そのまま読める", () => {
  const raw = noteFormat.create({
    id: "8b6e4d5e-8a43-4c1b-9d0e-1f2a3b4c5d6e",
    title: ndlTitle,
    authors: ["Dustin Boswell", "角 征典"],
    authorRoles: [{ name: "角 征典", role: "訳" }],
    wanted: false,
    editions: [
      {
        id: "9b6e4d5e-8a43-4c1b-9d0e-1f2a3b4c5d6e",
        owned: true,
        isbns: [readable],
        series: [{ isbn: readable, name: "THEORY/IN/PRACTICE" }],
      },
    ],
    appliedPurchases: [],
    pendingLookup: '[{"isbn":"9784873115658","written":[]}]',
  });
  assert.match(raw, /author-roles:\n {4}角 征典: 訳\n/);
  const { book } = noteFormat.read(raw);
  assert.deepEqual(book.authorRoles, [{ name: "角 征典", role: "訳" }]);
  assert.deepEqual(book.editions[0].series, [{ isbn: readable, name: "THEORY/IN/PRACTICE" }]);
  assert.equal(book.pendingLookup, '[{"isbn":"9784873115658","written":[]}]');
  const cleared = noteFormat.reviseBibliography(raw, {
    authors: ["Dustin Boswell", "角 征典"],
    authorRoles: [],
    editions: [{ id: "9b6e4d5e-8a43-4c1b-9d0e-1f2a3b4c5d6e", series: [] }],
    endsLookups: true,
  });
  const revised = noteFormat.read(cleared).book;
  assert.deepEqual(revised.authorRoles, []);
  assert.equal(revised.editions[0].series, undefined);
  assert.equal(revised.pendingLookup, undefined);
  assert.doesNotMatch(cleared, /author-roles|pending-lookup|series/);
});
