import type { EditionRecord } from "./book-note.ts";
import type { Operation, StoredBook } from "./catalog.ts";
import { optionalField } from "./optional-field.ts";
import type { CatalogRequest, Edition } from "./wasm.ts";

function catalogEdition({
  id,
  owned,
  isbns,
  label,
  archivedAt,
  ...details
}: EditionRecord): Edition {
  return {
    id,
    owned,
    isbns: [...isbns],
    ...optionalField("label", label),
    ...optionalField("archivedAt", archivedAt),
    details,
  };
}

/** 目録の判定に渡す要求を、操作と書籍の保存範囲にある本から作る。 */
export function catalogRequest(
  { action, product, selection }: Operation,
  entries: readonly StoredBook[],
): CatalogRequest {
  const { title, authors, isbns, label, ...details } = product;
  return {
    action,
    product: {
      ...optionalField("title", title),
      ...optionalField("authors", authors),
      ...optionalField("isbns", isbns),
      ...optionalField("label", label),
      details,
    },
    books: entries.map(({ book: { id, title, authors, wanted, archivedAt, editions } }) => ({
      id,
      title,
      authors: [...authors],
      wanted,
      ...optionalField("archivedAt", archivedAt),
      editions: editions.map(catalogEdition),
    })),
    ...optionalField("selection", selection),
  };
}
