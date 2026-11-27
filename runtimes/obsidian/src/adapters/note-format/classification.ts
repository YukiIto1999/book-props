import { isScalar } from "yaml";
import type { CatalogCore } from "../../core/catalog-core.ts";
import { dropPair, fieldEdits, type Edit } from "./edit.ts";
import type { ParsedNote } from "./parse.ts";

/** 本の日本十進分類法の番号のプロパティ。利用者が手で書き換えてもよい。 */
export const classificationKey = "book-ndc";
/** 番号から作る要目の名前のプロパティ。Basesでまとめるために置き、番号に合わせて書き直す。 */
export const sectionKey = "book-ndc-section";

/** 番号から要目の名前を作るcoreの規則。 */
export type SectionRule = Pick<CatalogCore, "ndcSection">;

/** 本の番号が属する要目の名前。番号がないか、日本十進分類法の番号として読めなければ`undefined`。 */
export function sectionOf(number: string | undefined, rules: SectionRule): string | undefined {
  return number === undefined ? undefined : rules.ndcSection(number);
}

/**
 * 番号を書き、要目の名前をその番号に合わせる編集。`number`を渡さなければ、いまの番号に名前だけを
 * 合わせる。名前は番号だけから決まるので、利用者が書き換えた名前も番号の名前に戻し、番号のない本や
 * 番号として読めない値の本からは取り除く。足す項目は`book-props`の前に置く。
 */
export function classificationEdits(
  { header, root, book }: ParsedNote,
  rules: SectionRule,
  number?: string,
): Edit[] {
  const section = sectionOf(number ?? book.classification, rules);
  const stored = root.get(sectionKey, true);
  const storedText = isScalar(stored) ? stored.value : undefined;
  const fields = {
    [classificationKey]: number === book.classification ? undefined : number,
    [sectionKey]: section === storedText ? undefined : section,
  };
  const edits = fieldEdits(header, root, fields, { before: "book-props" });
  if (section === undefined && stored !== undefined) edits.push(dropPair(header, root, sectionKey));
  return edits;
}
