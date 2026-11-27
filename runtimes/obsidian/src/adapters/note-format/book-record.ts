import type { PlainMap } from "./edit.ts";

/** 情報源が版のISBNごとに示すシリーズやレーベル。 */
export type SeriesEntry = Readonly<{ isbn: string; name: string }>;

/** 著者のうち、著作以外の役割(訳、監修など)を担った人とその役割。 */
export type AuthorRole = Readonly<{ name: string; role: string }>;

/** 本ページから読んだ版。 */
export type EditionRecord = Readonly<{
  id: string;
  owned: boolean;
  isbns: readonly string[];
  label?: string;
  publisher?: string;
  publishedOn?: string;
  cover?: string;
  purchasedOn?: string;
  purchasedFrom?: string;
  archivedAt?: string;
  series?: readonly SeriesEntry[];
}>;

/** 本ページに残した、適用済みの購入の記録。同じ要求の再確認を見分けるために使う。 */
export type AppliedPurchase = Readonly<{
  requestId: string;
  clientId: string;
  inputHash: string;
  appliedAt: string;
  bookId: string;
  editionId: string;
}>;

/** 版を手放す本ページに記録した、終わっていない版の移動。 */
export type PendingMove = Readonly<{
  editionId: string;
  destinationId: string;
  digest: string;
  backup?: string;
}>;

export type CustomField = Readonly<{ name: string }> &
  (
    | { kind: "text" | "date"; value: string }
    | { kind: "number"; value: number }
    | { kind: "boolean"; value: boolean }
    | { kind: "choice"; value: string; choices: readonly string[] }
  );

/** 本ページから読んだ本。 */
export type BookRecord = Readonly<{
  id: string;
  title: string;
  authors: readonly string[];
  authorRoles?: readonly AuthorRole[];
  tags?: readonly string[];
  wanted: boolean;
  readingStatus?: string;
  finishedOn?: string;
  archivedAt?: string;
  pendingMove?: PendingMove;
  /** 国立国会図書館サーチでの照会を待つ記録。中身はcoreだけが読む。 */
  pendingLookup?: string;
  /** 日本十進分類法の番号。本ページに書いてあるとおりで、手で書いた値のこともある。 */
  classification?: string;
  customFields?: readonly CustomField[];
  editions: readonly EditionRecord[];
  appliedPurchases: readonly AppliedPurchase[];
}>;

/**
 * 購入や所持の記録で、本ページに書く購入希望・版・購入の記録と、照会を待つ記録。
 * `classification`は、番号のない本にだけ書く日本十進分類法の番号。
 */
export type BookUpdate = Readonly<{
  wanted: boolean;
  edition?: EditionRecord;
  receipt?: AppliedPurchase;
  pendingLookup?: string;
  classification?: string;
}>;

/** 移動する版の項目の値と、移動先で同じ値であることを確かめるための署名。 */
export type Capture = Readonly<{ content: PlainMap; signature: string }>;
