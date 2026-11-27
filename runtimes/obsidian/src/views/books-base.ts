import { readingLabels } from "./shelf-fields.ts";

/** 書籍フォルダの本ページを、Obsidian標準のBasesで一覧するファイル。Vaultの直下に置く。 */
export const booksBasePath = "本の一覧.base";

/** 一覧のファイルを置くVaultの操作。同名のファイルがあるかを確かめ、なければ作る。 */
export type BooksBaseVault = Readonly<{
  exists(path: string): boolean;
  create(path: string, text: string): Promise<unknown>;
}>;

/** 一覧のファイルを作ったか、すでにあったか。 */
export type BooksBasePlacement = "created" | "existing";

const editions = 'note["book-props"].editions';
// Basesの`!`は値のない項目に対して真を返さないので、`isTruthy()`で真偽にしてから否定する。
const current = '!value["archived-at"].isTruthy()';
const withCover = `${editions}.filter(value.cover && ${current})`;
const publishers = `${editions}.filter(value.publisher && ${current}).map(value.publisher).unique()`;
const readingStatus = 'note["book-reading-status"]';

/** 読書状態の値を本棚と同じ表示名に変える。未設定や知らない値は「未設定」にする。 */
const readingFormula = Object.entries(readingLabels).reduceRight(
  (otherwise, [value, label]) =>
    `if(${readingStatus} == ${JSON.stringify(value)}, ${JSON.stringify(label)}, ${otherwise})`,
  '"未設定"',
);

/** YAMLの単一引用符の文字列にする。式の先頭の`!`や`"`をYAMLの記号として読ませない。 */
const quoted = (expression: string): string => `'${expression.replaceAll("'", "''")}'`;

const tableColumns = `    order:
      - formula.title
      - book-authors
      - formula.publishers
      - formula.reading
      - book-finished-on
      - formula.owned
      - book-wanted
      - tags
    sort:
      - property: book-title
        direction: ASC
    columnSize:
      formula.title: 320
      note.book-authors: 240
      formula.publishers: 180`;

/** 一覧の表示。書籍フォルダに依らないので、本文の末尾にそのまま置く。 */
const views = `views:
  - type: cards
    name: 表紙
    order:
      - formula.title
      - book-authors
      - formula.publishers
    sort:
      - property: book-title
        direction: ASC
    cardSize: 160
    image: formula.cover
    imageFit: contain
    imageAspectRatio: 1.45
  - type: table
    name: すべての本
${tableColumns}
  - type: table
    name: 出版社別
    groupBy:
      property: formula.publishers
      direction: ASC
${tableColumns}
  - type: table
    name: 著者別
    groupBy:
      property: formula.first_author
      direction: ASC
${tableColumns}
  - type: table
    name: 欲しい本
    filters:
      and:
        - note["book-wanted"]
        - ${quoted("!formula.owned")}
${tableColumns}
  - type: table
    name: 読書状態別
    groupBy:
      property: formula.reading
      direction: ASC
${tableColumns}
  - type: table
    name: 同じ著者の本
    filters:
      and:
        - this["book-authors"].filter(note["book-authors"].contains(value)).length > 0
${tableColumns}
`;

/**
 * 書籍フォルダの本ページの一覧を定義する`.base`の本文。
 * 項目のキーは本ページの書式が書くものだけを使い、アーカイブした本と版は数えない。
 * Basesはリストの項目でまとめると組み合わせごとの組にするため、著者は筆頭著者で、出版社は版の出版社をつないだ名前でまとめる。
 * 「同じ著者の本」は、本ページに埋め込むか右サイドバーで開くと、そのページの本と著者が重なる本を並べる。
 */
export function booksBase(folder: string): string {
  return `filters:
  and:
    - ${quoted(`file.inFolder(${JSON.stringify(folder)})`)}
    - file.ext == "md"
    - file.hasProperty("book-props")
    - ${quoted('!note["book-props"]["archived-at"].isTruthy()')}
formulas:
  title: file.asLink(note["book-title"])
  cover: if(${withCover}.length > 0, ${withCover}[0].cover, "#c8c2b4")
  publishers: if(${publishers}.length > 0, ${publishers}.join("・"), "出版社なし")
  first_author: if(note["book-authors"], note["book-authors"][0], "著者なし")
  owned: ${editions}.filter(value.owned && ${current}).length > 0
  reading: ${readingFormula}
properties:
  formula.title:
    displayName: 書名
  note.book-authors:
    displayName: 著者
  formula.publishers:
    displayName: 出版社
  formula.first_author:
    displayName: 筆頭著者
  formula.reading:
    displayName: 読書状態
  note.book-finished-on:
    displayName: 読了日
  formula.owned:
    displayName: 所有
  note.book-wanted:
    displayName: 欲しい
  note.tags:
    displayName: タグ
${views}`;
}

/** 一覧のファイルがなければ作る。すでにあれば、利用者が手を入れたかもしれないので書き換えない。 */
export async function placeBooksBase(
  vault: BooksBaseVault,
  folder: string,
): Promise<BooksBasePlacement> {
  if (vault.exists(booksBasePath)) return "existing";
  await vault.create(booksBasePath, booksBase(folder));
  return "created";
}
