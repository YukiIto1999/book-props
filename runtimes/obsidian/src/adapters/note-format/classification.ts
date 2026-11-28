import { isScalar } from "yaml";
import type { CatalogCore } from "../../core/catalog-core.ts";
import { dropPair, fieldEdits, type Edit } from "./edit.ts";
import type { ParsedNote } from "./parse.ts";

/** 本の日本十進分類法の番号のプロパティ。利用者が手で書き換えてもよい。 */
export const classificationKey = "book-ndc";
/** 番号から作る要目(3桁)の名前のプロパティ。Basesでまとめるために置き、番号に合わせて書き直す。 */
const sectionKey = "book-ndc-section";
/** 番号から作る細目(4桁)の名前のプロパティ。要目より細かくまとめるために置く。 */
const subsectionKey = "book-ndc-subsection";

/** 番号から要目と細目の名前を作るcoreの規則。 */
export type SectionRule = Pick<CatalogCore, "ndcSection" | "ndcSubsection">;

/**
 * 本の番号から作る名前を、プロパティごとに上の階層から順に返す。番号がないか、日本十進分類法の
 * 番号として読めなければ値は`undefined`。
 */
export function namesOf(
  number: string | undefined,
  rules: SectionRule,
): Record<string, string | undefined> {
  if (number === undefined) return { [sectionKey]: undefined, [subsectionKey]: undefined };
  return { [sectionKey]: rules.ndcSection(number), [subsectionKey]: rules.ndcSubsection(number) };
}

/**
 * 番号を書き、要目と細目の名前をその番号に合わせる編集。`number`を渡さなければ、いまの番号に
 * 名前だけを合わせる。名前は番号だけから決まるので、利用者が書き換えた名前も番号の名前に戻し、
 * 番号のない本や番号として読めない値の本からは取り除く。足す項目は`book-props`の前に置く。
 */
export function classificationEdits(
  { header, root, book }: ParsedNote,
  rules: SectionRule,
  number?: string,
): Edit[] {
  const names = namesOf(number ?? book.classification, rules);
  const fields: Record<string, string | undefined> = {
    [classificationKey]: number === book.classification ? undefined : number,
  };
  const dropped: string[] = [];
  for (const [key, name] of Object.entries(names)) {
    const stored: unknown = root.get(key, true);
    if (name === undefined && stored !== undefined) dropped.push(key);
    else if (name !== (isScalar(stored) ? stored.value : undefined)) fields[key] = name;
  }
  const edits = fieldEdits(header, root, fields, { before: "book-props" });
  for (const key of dropped) edits.push(dropPair(header, root, key));
  return edits;
}
