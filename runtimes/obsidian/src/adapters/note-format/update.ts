import type { AppliedPurchase, BookRecord, BookUpdate, EditionRecord } from "./book-record.ts";
import {
  appendRows,
  editableRange,
  fieldEdits,
  replace,
  storeEdition,
  storePurchase,
  type Edit,
} from "./edit.ts";
import { classificationEdits, type SectionRule } from "./classification.ts";
import { BookNoteError } from "./error.ts";
import { checkPurchase, map, type ParsedNote } from "./parse.ts";

function supplement(stored: string | undefined, requested: string | undefined): string | undefined {
  return stored === undefined ? requested : undefined;
}

/** 登録済みの版は所持だけを変え、ISBNの追加と空欄の補完をする。利用者が書いた値は上書きしない。 */
function editionEdits({ header, editions, book }: ParsedNote, requested: EditionRecord): Edit[] {
  const index = book.editions.findIndex(({ id }) => id === requested.id);
  const target = book.editions[index];
  if (!target) return [appendRows(header, editions, "editions", [storeEdition(requested)])];
  const node = map(editions.items[index], "版");
  editableRange(node);
  const edits: Edit[] = [];
  if (requested.owned !== target.owned) {
    edits.push(replace(node.get("owned", true), String(requested.owned)));
  }
  const additions = requested.isbns.filter((isbn) => !target.isbns.includes(isbn));
  const stated = target.series ?? [];
  const series = (requested.series ?? []).filter(
    ({ isbn }) => !stated.some((entry) => entry.isbn === isbn),
  );
  const fields = {
    isbns: additions.length ? additions : undefined,
    label: supplement(target.label, requested.label),
    publisher: supplement(target.publisher, requested.publisher),
    "published-on": supplement(target.publishedOn, requested.publishedOn),
    cover: supplement(target.cover, requested.cover),
    "purchased-on": supplement(target.purchasedOn, requested.purchasedOn),
    "purchased-from": supplement(target.purchasedFrom, requested.purchasedFrom),
    series: series.length
      ? [...stated, ...series].map(({ isbn, name }) => ({ isbn, name }))
      : undefined,
  };
  edits.push(...fieldEdits(header, node, fields, { appendIsbnAliases: true }));
  return edits;
}

function receiptEdit({ header, purchases, book }: ParsedNote, receipt: AppliedPurchase): Edit {
  checkPurchase(receipt, book.id);
  const known = book.appliedPurchases.some(
    (old) => old.clientId === receipt.clientId && old.requestId === receipt.requestId,
  );
  if (known) throw new BookNoteError("conflict", "同じ要求IDがすでに記録されています。");
  return appendRows(header, purchases, "applied-purchases", [storePurchase(receipt)]);
}

/** 購入希望、版、適用済み購入の記録と、照会を待つ記録と、番号のない本の分類の番号を書き換える編集。 */
export function updateEdits(note: ParsedNote, input: BookUpdate, rules: SectionRule): Edit[] {
  const { header, root, managed, editions, book } = note;
  for (const node of [root, managed, editions]) editableRange(node);
  const edits: Edit[] = [];
  if (input.wanted !== book.wanted) {
    edits.push(replace(root.get("book-wanted", true), String(input.wanted)));
  }
  if (input.edition) edits.push(...editionEdits(note, input.edition));
  if (input.receipt) edits.push(receiptEdit(note, input.receipt));
  if (input.pendingLookup !== undefined && input.pendingLookup !== book.pendingLookup) {
    edits.push(...fieldEdits(header, managed, { "pending-lookup": input.pendingLookup }));
  }
  if (input.classification !== undefined && book.classification === undefined) {
    edits.push(...classificationEdits(note, rules, input.classification));
  }
  return edits;
}

/** 書き換えた後の本に、指定した購入希望、版の所持とISBN、購入の記録、分類の番号があるかを確かめる。 */
export function confirmsUpdate(
  saved: BookRecord,
  { wanted, edition, receipt, pendingLookup, classification }: BookUpdate,
): boolean {
  if (saved.wanted !== wanted) return false;
  if (pendingLookup !== undefined && saved.pendingLookup !== pendingLookup) return false;
  if (classification !== undefined && saved.classification === undefined) return false;
  const editionSaved =
    !edition ||
    saved.editions.some(
      ({ id, owned, isbns }) =>
        id === edition.id &&
        owned === edition.owned &&
        edition.isbns.every((isbn) => isbns.includes(isbn)),
    );
  return (
    editionSaved &&
    (!receipt ||
      saved.appliedPurchases.some(
        ({ requestId, clientId }) =>
          requestId === receipt.requestId && clientId === receipt.clientId,
      ))
  );
}
