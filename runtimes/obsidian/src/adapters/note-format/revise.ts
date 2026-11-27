import type { YAMLMap } from "yaml";
import type { BibliographyRevision } from "../../core/catalog-core.ts";
import type { BookRecord } from "./book-record.ts";
import { dropPair, fieldEdits, type Edit, type Frontmatter, type Plain } from "./edit.ts";
import { map, type ParsedNote } from "./parse.ts";

/** 値があれば書き、空なら項目ごと取り除く編集。もともとない項目を取り除く編集は作らない。 */
function setOrDrop(
  header: Frontmatter,
  node: YAMLMap,
  name: string,
  value: Plain | undefined,
): Edit[] {
  if (value === undefined) return [];
  if (value !== null) return fieldEdits(header, node, { [name]: value });
  return node.has(name) ? [dropPair(header, node, name)] : [];
}

function rolesValue(revision: BibliographyRevision): Plain | undefined {
  const roles = revision.authorRoles;
  if (!roles) return undefined;
  return roles.length ? Object.fromEntries(roles.map(({ name, role }) => [name, role])) : null;
}

/** 書名・著者・著者の役割・版の書誌・照会待ちの記録を書き換える編集。他の項目と本文は変えない。 */
export function revisionEdits(
  { header, root, managed, editions, book }: ParsedNote,
  revision: BibliographyRevision,
): Edit[] {
  const edits = fieldEdits(header, root, {
    "book-title": revision.title,
    "book-authors": revision.authors,
  });
  edits.push(...setOrDrop(header, managed, "author-roles", rolesValue(revision)));
  if (revision.endsLookups && managed.has("pending-lookup"))
    edits.push(dropPair(header, managed, "pending-lookup"));
  for (const text of revision.editions) {
    const index = book.editions.findIndex(({ id }) => id === text.id);
    const node = map(editions.items[index], "版");
    edits.push(...fieldEdits(header, node, { publisher: text.publisher, label: text.label }));
    const series = text.series?.map(({ isbn, name }) => ({ isbn, name }));
    edits.push(...setOrDrop(header, node, "series", series && (series.length ? series : null)));
  }
  return edits;
}

/** 書き換えた後の本が、書き換えの内容どおりか。 */
export function confirmsRevision(saved: BookRecord, revision: BibliographyRevision): boolean {
  const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
  const roles = (saved.authorRoles ?? []).map(({ name, role }) => ({ name, role }));
  const editionsSaved = revision.editions.every((text) => {
    const edition = saved.editions.find(({ id }) => id === text.id);
    return (
      edition !== undefined &&
      (text.publisher === undefined || edition.publisher === text.publisher) &&
      (text.label === undefined || edition.label === text.label) &&
      (text.series === undefined || same(edition.series ?? [], text.series))
    );
  });
  return (
    editionsSaved &&
    (revision.title === undefined || saved.title === revision.title) &&
    (revision.authors === undefined || same(saved.authors, revision.authors)) &&
    (revision.authorRoles === undefined || same(roles, revision.authorRoles)) &&
    (!revision.endsLookups || saved.pendingLookup === undefined)
  );
}
