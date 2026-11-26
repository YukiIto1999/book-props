import type { Catalog, Product } from "../catalog/catalog.ts";
import { optionalField } from "../shared/optional-field.ts";

export type ProductInput = "title" | "authors" | "isbns" | "label" | "publisher";
type DraftValues = Record<ProductInput, string>;
type IsbnReader = Pick<Catalog, "normalizeIsbns">;

export const inputLabels: Record<ProductInput, string> = {
  title: "書名",
  authors: "著者",
  isbns: "ISBN",
  label: "版",
  publisher: "出版社",
};
export const productInputs: readonly ProductInput[] = [
  "title",
  "authors",
  "isbns",
  "label",
  "publisher",
];

export function inputValues(details: Product): DraftValues {
  return {
    title: details.title ?? "",
    authors: details.authors?.join("、") ?? "",
    isbns: details.isbns?.join("、") ?? "",
    label: details.label ?? "",
    publisher: details.publisher ?? "",
  };
}

function listedValues(text: string): string[] {
  return text
    .split(/[、,]/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function readIsbns(catalog: IsbnReader, isbns: readonly string[] | undefined): string[] {
  const normalized = catalog.normalizeIsbns(isbns ?? []);
  return normalized.kind === "invalid" ? [] : normalized.values;
}

/**
 * 出版日や表紙の取得元の版を引き続き指定しているかの判定
 * @param source - 選択した書誌
 * @param entered - 現在の入力
 * @param catalog - ISBNの正規化に使う蔵書
 * @returns 正規化したISBNが一致するかISBNのない取得元の書名・著者・版が一致する場合に真
 */
function namesSource(source: Product, entered: Product, catalog: IsbnReader): boolean {
  const fetched = readIsbns(catalog, source.isbns);
  if (fetched.length) {
    const current = readIsbns(catalog, entered.isbns);
    return current.length > 0 && current.every((isbn) => fetched.includes(isbn));
  }
  const named = inputValues(source);
  return (
    entered.title === named.title.trim() &&
    entered.label === (named.label.trim() || undefined) &&
    entered.authors?.join("\n") === listedValues(named.authors).join("\n")
  );
}

/**
 * 照合と保存で共有する現在の書誌入力
 * @param details - 出版日や表紙を含む取得済みの書誌
 * @param values - 画面に表示している入力値
 * @param catalog - ISBNの正規化に使う蔵書
 * @returns 取得元の版を引き続き指定している場合だけ表示していない項目を含む書誌
 */
export function draftProduct(details: Product, values: DraftValues, catalog: IsbnReader): Product {
  const entered = {
    title: values.title.trim(),
    authors: listedValues(values.authors),
    isbns: listedValues(values.isbns),
    ...optionalField("label", values.label.trim() || undefined),
    ...optionalField("publisher", values.publisher.trim() || undefined),
  };
  // 画面の入力欄にある項目は、空欄でも取得した書誌の値を引き継がない。
  const { label: _label, publisher: _publisher, ...hidden } = details;
  return namesSource(details, entered, catalog) ? { ...hidden, ...entered } : entered;
}
