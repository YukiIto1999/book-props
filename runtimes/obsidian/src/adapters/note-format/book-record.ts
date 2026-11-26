import type { PlainMap } from "./edit.ts";

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
  tags?: readonly string[];
  wanted: boolean;
  readingStatus?: string;
  finishedOn?: string;
  archivedAt?: string;
  pendingMove?: PendingMove;
  customFields?: readonly CustomField[];
  editions: readonly EditionRecord[];
  appliedPurchases: readonly AppliedPurchase[];
}>;

/** 購入や所持の記録で、本ページに書く購入希望・版・購入の記録。 */
export type BookUpdate = Readonly<{
  wanted: boolean;
  edition?: EditionRecord;
  receipt?: AppliedPurchase;
}>;

/** 移動する版の項目の値と、移動先で同じ値であることを確かめるための署名。 */
export type Capture = Readonly<{ content: PlainMap; signature: string }>;
