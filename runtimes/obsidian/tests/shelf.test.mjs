import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

// shelf.ts の画面部は Obsidian の Modal を継承する。純粋な絞り込みだけを読み込むため、型定義しかない obsidian を空のクラスで解決する。
const obsidian = `data:text/javascript,${encodeURIComponent("export class Modal {} export class Setting {}")}`;
registerHooks({
  resolve: (specifier, context, next) =>
    specifier === "obsidian" ? { url: obsidian, shortCircuit: true } : next(specifier, context),
});
const { emptyFilter, selectBooks, shelfTags, shopSearches } = await import("../src/shelf.ts");
const { calendarDate } = await import("../src/shelf-fields.ts");

let serial = 0;
const edition = (fields = {}) => ({ id: `edition-${++serial}`, owned: true, isbns: [], ...fields });
const entry = (title, fields = {}) => ({
  path: `Books/${title}.md`,
  book: {
    id: `book-${++serial}`,
    title,
    authors: [],
    wanted: false,
    editions: [],
    appliedPurchases: [],
    ...fields,
  },
});
const titles = (entries, filter) =>
  selectBooks(entries, { ...emptyFilter, ...filter }).map(({ book }) => book.title);

void test("購入希望と読書状態で絞ると、両方を満たす本だけが並び、所有は現役の版だけで判定する", () => {
  const entries = [
    entry("A 欲しい未読", { wanted: true, readingStatus: "unread" }),
    entry("B 欲しい読書中", { wanted: true, readingStatus: "reading" }),
    entry("C 希望なし未読", { readingStatus: "unread" }),
    entry("D 欲しい未設定", { wanted: true }),
    entry("E 所有して欲しい未読", { wanted: true, readingStatus: "unread", editions: [edition()] }),
    entry("F 版をアーカイブ", {
      wanted: true,
      readingStatus: "unread",
      editions: [edition({ archivedAt: "2026-11-01T00:00:00Z" })],
    }),
  ];
  assert.deepEqual(titles(entries, { wish: "wanted", reading: "unread" }), [
    "A 欲しい未読",
    "E 所有して欲しい未読",
    "F 版をアーカイブ",
  ]);
  assert.deepEqual(titles(entries, { wish: "wanted", reading: "unread", ownership: "owned" }), [
    "E 所有して欲しい未読",
  ]);
  assert.deepEqual(titles(entries, { wish: "wanted", reading: "unread", ownership: "unowned" }), [
    "A 欲しい未読",
    "F 版をアーカイブ",
  ]);
  assert.deepEqual(titles(entries, { wish: "unwanted" }), ["C 希望なし未読"]);
  assert.deepEqual(titles(entries, { reading: "unset" }), ["D 欲しい未設定"]);
});

void test("複数のタグは、すべてが付いた本だけに絞り、#と大文字小文字と全角を区別しない", () => {
  const entries = [
    entry("技術だけ", { tags: ["技術"] }),
    entry("技術とRust", { tags: ["技術", "Rust"] }),
    entry("Rustだけ", { tags: ["#rust"] }),
    entry("タグなし"),
  ];
  assert.deepEqual(titles(entries, { tags: ["技術", "Rust"] }), ["技術とRust"]);
  assert.deepEqual(titles(entries, { tags: ["#技術", "ＲＵＳＴ"] }), ["技術とRust"]);
  assert.deepEqual(titles(entries, { tags: ["技術"] }), ["技術だけ", "技術とRust"]);
  assert.deepEqual(shelfTags(entries), ["Rust", "技術"]);
});

void test("著者から、表記の空白が違っても同じ著者の本だけを表示する", () => {
  const entries = [
    entry("坊っちゃん", { authors: ["夏目 漱石"] }),
    entry("こころ", { authors: ["夏目漱石"] }),
    entry("羅生門", { authors: ["芥川 龍之介"] }),
  ];
  assert.deepEqual(titles(entries, { author: "夏目　漱石" }), ["こころ", "坊っちゃん"]);
});

void test("出版社から、その出版社の版を含む本を表示し、アーカイブした版の出版社では表示しない", () => {
  const entries = [
    entry("ふたつの出版社", {
      editions: [edition({ publisher: "技術評論社" }), edition({ publisher: "新潮社" })],
    }),
    entry("ひとつの出版社", { editions: [edition({ publisher: "新潮社", owned: false })] }),
    entry("アーカイブ済みの版", {
      editions: [edition({ publisher: "新潮社", archivedAt: "2026-11-01T00:00:00Z" })],
    }),
    entry("出版社不明", { editions: [edition()] }),
  ];
  assert.deepEqual(titles(entries, { publisher: "新潮社" }), ["ひとつの出版社", "ふたつの出版社"]);
});

void test("購入日で並べ替えると日付の順に並び、日付のない本は向きにかかわらず最後になる", () => {
  const entries = [
    entry("2024年", { editions: [edition({ purchasedOn: "2024/3/5" })] }),
    entry("購入日なし", { editions: [edition()] }),
    entry("2023年と2025年", {
      editions: [edition({ purchasedOn: "2023-01-01" }), edition({ purchasedOn: "2025-01-01" })],
    }),
    entry("2022年", { editions: [edition({ purchasedOn: "2022-12-31" })] }),
  ];
  assert.deepEqual(titles(entries, { sort: "purchasedOn" }), [
    "2022年",
    "2023年と2025年",
    "2024年",
    "購入日なし",
  ]);
  assert.deepEqual(titles(entries, { sort: "purchasedOn", descending: true }), [
    "2023年と2025年",
    "2024年",
    "2022年",
    "購入日なし",
  ]);
});

void test("同じ年の標準日付は区切り文字と桁数が異なっても日付順になる", () => {
  const entries = [
    entry("年末", {
      finishedOn: "2024-12-31",
      editions: [edition({ purchasedOn: "2024-12-31", publishedOn: "2024-12-31" })],
    }),
    entry("年始", {
      finishedOn: "2024/1/2",
      editions: [edition({ purchasedOn: "2024/1/2", publishedOn: "2024/1/2" })],
    }),
  ];
  for (const sort of ["purchasedOn", "publishedOn", "finishedOn"]) {
    assert.deepEqual(titles(entries, { sort }), ["年始", "年末"]);
  }
});

void test("購入日の範囲で絞ると、範囲内に購入日のある版を含む本だけが残る", () => {
  const entries = [
    entry("まえ", { editions: [edition({ purchasedOn: "2024-04-30" })] }),
    entry("なか", {
      editions: [edition({ purchasedOn: "2024-04-30" }), edition({ purchasedOn: "2024-05-15" })],
    }),
    entry("おわり", { editions: [edition({ purchasedOn: "2024-05-31" })] }),
    entry("なし"),
  ];
  assert.deepEqual(
    titles(entries, { range: { key: "purchasedOn", from: "2024-05-01", through: "2024-05-31" } }),
    ["おわり", "なか"],
  );
  assert.deepEqual(
    titles(entries, { range: { key: "purchasedOn", from: "", through: "2024-04-30" } }),
    ["なか", "まえ"],
  );
});

void test("検索語は、書名・著者・出版社・タグ・ISBN・購入日のいずれかに一致する語をすべて含む本に絞る", () => {
  const entries = [
    entry("吾輩は猫である", {
      authors: ["夏目 漱石"],
      tags: ["小説"],
      editions: [
        edition({ publisher: "新潮社", isbns: ["9784101010014"], purchasedOn: "2024-05-01" }),
      ],
    }),
    entry("プログラミングRust", {
      authors: ["Jim Blandy"],
      tags: ["技術", "Rust"],
      editions: [edition({ publisher: "オライリー・ジャパン", isbns: ["9784873119786"] })],
    }),
  ];
  assert.deepEqual(titles(entries, { text: "漱石 新潮" }), ["吾輩は猫である"]);
  assert.deepEqual(titles(entries, { text: "漱石 オライリー" }), []);
  assert.deepEqual(titles(entries, { text: "#ＲＵＳＴ" }), ["プログラミングRust"]);
  assert.deepEqual(titles(entries, { text: "978-4-10-101001-4" }), ["吾輩は猫である"]);
  assert.deepEqual(titles(entries, { text: "4101010013" }), ["吾輩は猫である"]);
  assert.deepEqual(titles(entries, { text: "978-4-87" }), ["プログラミングRust"]);
  assert.deepEqual(titles(entries, { text: "2024-05" }), ["吾輩は猫である"]);
  assert.deepEqual(titles(entries, { text: "jim blandy" }), ["プログラミングRust"]);
});

void test("`#`付きの語はタグそのものだけに一致し、書名や似たタグには一致しない。複数ならすべてのタグを持つ本に絞る", () => {
  const entries = [
    entry("A 両方のタグ", { tags: ["技術", "Rust"] }),
    entry("B Rustの本", { tags: ["技術"] }),
    entry("C 似たタグ", { tags: ["技術", "Rust入門"] }),
  ];
  assert.deepEqual(titles(entries, { text: "#技術 #Rust" }), ["A 両方のタグ"]);
  assert.deepEqual(titles(entries, { text: "＃ｒｕｓｔ" }), ["A 両方のタグ"]);
  assert.deepEqual(titles(entries, { text: "#技術 Rust" }), [
    "A 両方のタグ",
    "B Rustの本",
    "C 似たタグ",
  ]);
});

void test("区切りが`-`・`/`・`.`の実在する日付はYYYY-MM-DDとして読み、存在しない日や日の欠けた値は日付として扱わない", () => {
  assert.equal(calendarDate("2024/3/5"), "2024-03-05");
  assert.equal(calendarDate(" 2024.03.05 "), "2024-03-05");
  assert.equal(calendarDate("２０２４／３／５"), "2024-03-05");
  assert.equal(calendarDate("2024-02-29"), "2024-02-29");
  for (const value of ["2023-02-29", "2024/13/1", "2024/3", "2024年3月5日", "2024-03-05T09:00"]) {
    assert.equal(calendarDate(value), undefined);
  }
  const entries = [
    entry("実在する日", { editions: [edition({ purchasedOn: "2024.2.28" })] }),
    entry("存在しない日", { editions: [edition({ purchasedOn: "2024-02-30" })] }),
  ];
  assert.deepEqual(
    titles(entries, { range: { key: "purchasedOn", from: "2024-02-01", through: "2024-03-31" } }),
    ["実在する日"],
  );
});

void test("アーカイブした本は、本棚にもタグの一覧にも出さない", () => {
  const entries = [
    entry("残る本", { tags: ["残す"] }),
    entry("アーカイブした本", { tags: ["消す"], archivedAt: "2026-11-01T00:00:00Z" }),
  ];
  assert.deepEqual(titles(entries, {}), ["残る本"]);
  assert.deepEqual(shelfTags(entries), ["残す"]);
});

void test("書店の検索は、入力をそのまま各店の検索語として符号化し、空の入力では作らない", () => {
  const query = "a&b=c/d#e?f%g 設計";
  const searches = shopSearches(`  ${query}  `);
  assert.deepEqual(
    searches.map(({ name }) => name),
    ["Amazon", "楽天ブックス", "バリューブックス", "BOOKOFF"],
  );
  const parameters = {
    Amazon: ["www.amazon.co.jp", "/s", "k"],
    楽天ブックス: ["books.rakuten.co.jp", "/search", "sitem"],
    バリューブックス: ["www.valuebooks.jp", "/search", "keyword"],
  };
  for (const { name, url } of searches) {
    const parsed = new URL(url);
    assert.equal(parsed.protocol, "https:");
    assert.equal(parsed.hash, "");
    if (name === "BOOKOFF") {
      assert.equal(parsed.host, "shopping.bookoff.co.jp");
      assert.ok(parsed.pathname.startsWith("/search/keyword/"));
      assert.equal(parsed.search, "");
      assert.equal(decodeURIComponent(parsed.pathname.slice("/search/keyword/".length)), query);
    } else {
      const [host, pathname, parameter] = parameters[name];
      assert.deepEqual(
        [parsed.host, parsed.pathname, [...parsed.searchParams.keys()]],
        [host, pathname, [parameter]],
      );
      assert.equal(parsed.searchParams.get(parameter), query);
    }
  }
  assert.deepEqual(shopSearches("   "), []);
  assert.deepEqual(
    shopSearches("..").map(({ name }) => name),
    ["Amazon", "楽天ブックス", "バリューブックス"],
  );
});

void test("独自の数値は文字列順ではなく数値順に並び、最小値0を含む範囲で絞る", () => {
  const entries = ["負", "零", "小", "大"].map((title, index) => ({
    path: `${index}.md`,
    book: {
      title,
      authors: [],
      editions: [],
      customFields: [{ name: "評価", kind: "number", value: [-5, 0, 0.2, 0.11][index] }],
    },
  }));
  assert.deepEqual(
    titles(entries, {
      sort: "custom:評価",
      range: { key: "custom:評価", from: "0", through: "0.2" },
    }),
    ["零", "大", "小"],
  );
});
