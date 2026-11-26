import { isMap, isScalar, isSeq, parseDocument, type YAMLMap, type YAMLSeq } from "yaml";
import type { CatalogCore } from "../../core/catalog-core.ts";
import { isJsonObject } from "../../shared/json-object.ts";
import { optionalField } from "../../shared/optional-field.ts";
import type {
  AppliedPurchase,
  BookRecord,
  Capture,
  CustomField,
  EditionRecord,
  PendingMove,
} from "./book-record.ts";
import type { Frontmatter } from "./edit.ts";
import { BookNoteError, unreadable } from "./error.ts";
import { decodeCustomFields, plainMap, text } from "./values.ts";

/** 本ページの読み取りが使う、coreの識別の規則。保存済みのISBNが正規のISBN-13かを決める。 */
export type NoteRules = Pick<CatalogCore, "isCanonicalIsbnList">;

/** 読み取った本と、書き換えに使うYAMLのノード。 */
export type ParsedNote = Readonly<{
  header: Frontmatter;
  root: YAMLMap;
  managed: YAMLMap;
  editions: YAMLSeq;
  purchases: YAMLSeq;
  book: BookRecord;
}>;

const readingStates: Readonly<Record<string, true>> = {
  unread: true,
  reading: true,
  rereading: true,
  finished: true,
  reference: true,
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const digest = /^[0-9a-f]{64}$/;
const instant = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function frontmatter(raw: string): Frontmatter {
  const start = /^\uFEFF?---[ \t]*(\r?\n)/.exec(raw);
  if (!start) return unreadable("本ページの先頭にYAMLがありません。");
  const [opening, lineBreak = "\n"] = start;
  const offset = opening.length;
  const remaining = raw.slice(offset);
  const close = /^---[ \t]*(?:\r?\n|$)/m.exec(remaining);
  if (!close) return unreadable("本ページのYAMLが閉じられていません。");
  return {
    offset,
    end: offset + close.index,
    source: remaining.slice(0, close.index),
    lineBreak,
  };
}

export function map(node: unknown, field: string): YAMLMap {
  return isMap(node) ? node : unreadable(`${field} はYAMLのマップではありません。`);
}

function seq(node: unknown, field: string): YAMLSeq {
  return isSeq(node) ? node : unreadable(`${field} はYAMLのリストではありません。`);
}

function readId(node: unknown, field: string): string {
  const value = text(node, field);
  return uuid.test(value) ? value : unreadable(`${field} のIDを読み取れません。`);
}

function optionalText(record: YAMLMap, field: string): string | undefined {
  const node = record.get(field, true);
  const blank = isScalar(node) && (node.value === null || node.value === "");
  return node === undefined || blank ? undefined : text(node, field);
}

function flag(node: unknown, field: string): boolean {
  return isScalar(node) && typeof node.value === "boolean"
    ? node.value
    : unreadable(`${field} はtrueかfalseで指定してください。`);
}

function texts(record: YAMLMap, field: string): string[] {
  const node = record.get(field, true);
  if (node === undefined || (isScalar(node) && node.value === null)) return [];
  return seq(node, field).items.map((item) => text(item, field));
}

function readEdition(node: unknown, rules: NoteRules): EditionRecord {
  const edition = map(node, "版");
  const isbns = texts(edition, "isbns");
  if (!rules.isCanonicalIsbnList(isbns)) {
    return unreadable("版のISBNは、重複しないISBN-13の文字列で指定してください。");
  }
  return {
    id: readId(edition.get("id", true), "版"),
    owned: flag(edition.get("owned", true), "版の所持"),
    isbns,
    ...optionalField("label", optionalText(edition, "label")),
    ...optionalField("publisher", optionalText(edition, "publisher")),
    ...optionalField("publishedOn", optionalText(edition, "published-on")),
    ...optionalField("cover", optionalText(edition, "cover")),
    ...optionalField("purchasedOn", optionalText(edition, "purchased-on")),
    ...optionalField("purchasedFrom", optionalText(edition, "purchased-from")),
    ...optionalField("archivedAt", optionalText(edition, "archived-at")),
  };
}

export function readEditionBackup(
  signature: string,
  rules: NoteRules,
): Capture & { edition: EditionRecord } {
  const document = parseDocument(signature);
  if (document.errors.length) return unreadable("移動中の版の控えを読めません。");
  const edition = readEdition(document.contents, rules);
  const content = plainMap(map(document.contents, "移動中の版の控え"));
  return { edition, content, signature: JSON.stringify(content) };
}

/** 適用済み購入の記録が、この本についての正しい形式であることを確かめる。 */
export function checkPurchase(purchase: AppliedPurchase, bookId: string): AppliedPurchase {
  const valid =
    uuid.test(purchase.requestId) &&
    uuid.test(purchase.clientId) &&
    digest.test(purchase.inputHash) &&
    purchase.bookId === bookId &&
    uuid.test(purchase.editionId) &&
    instant.test(purchase.appliedAt) &&
    Number.isFinite(Date.parse(purchase.appliedAt));
  return valid ? purchase : unreadable("適用済み購入の記録の形式が正しくありません。");
}

function readPurchase(node: unknown, bookId: string): AppliedPurchase {
  const record = map(node, "適用済み購入");
  const applied = map(record.get("result", true), "購入結果");
  return checkPurchase(
    {
      requestId: text(record.get("request-id", true), "要求ID"),
      clientId: text(record.get("client-id", true), "要求元ID"),
      inputHash: text(record.get("input-hash", true), "要求の指紋"),
      appliedAt: text(record.get("applied-at", true), "適用時刻"),
      bookId: text(applied.get("book-id", true), "購入結果の本"),
      editionId: text(applied.get("edition-id", true), "購入結果の版"),
    },
    bookId,
  );
}

function readMove(
  encoded: string | undefined,
  bookId: string,
  rules: NoteRules,
): PendingMove | undefined {
  if (!encoded) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(encoded);
  } catch {
    return unreadable("版の移動記録を読めません。");
  }
  if (!isJsonObject(value)) return unreadable("版の移動記録を読めません。");
  const { editionId, destinationId, digest: signature, backup } = value;
  const valid =
    typeof editionId === "string" &&
    uuid.test(editionId) &&
    typeof destinationId === "string" &&
    uuid.test(destinationId) &&
    destinationId !== bookId &&
    typeof signature === "string" &&
    digest.test(signature);
  if (!valid || (backup !== undefined && typeof backup !== "string"))
    return unreadable("版の移動記録を読めません。");
  if (backup !== undefined && readEditionBackup(backup, rules).edition.id !== editionId)
    return unreadable("移動中の版の控えが移動記録と一致しません。");
  return { editionId, destinationId, digest: signature, ...optionalField("backup", backup) };
}

function readEditions(editions: YAMLSeq, rules: NoteRules): EditionRecord[] {
  const records = editions.items.map((edition) => readEdition(edition, rules));
  if (new Set(records.map(({ id }) => id)).size !== records.length) {
    return unreadable("同じ版IDが一つの本ページに複数あります。");
  }
  return records;
}

function readPurchases(purchases: YAMLSeq, bookId: string): AppliedPurchase[] {
  const records = purchases.items.map((entry) => readPurchase(entry, bookId));
  const keys = new Set(records.map(({ clientId, requestId }) => `${clientId}:${requestId}`));
  if (keys.size !== records.length) {
    return unreadable("同じ要求元・要求IDの購入が一つの本ページに複数あります。");
  }
  return records;
}

function readReadingStatus(root: YAMLMap): string | undefined {
  const status = optionalText(root, "book-reading-status");
  if (status !== undefined && !Object.hasOwn(readingStates, status)) {
    return unreadable("読書状態を読み取れません。");
  }
  return status;
}

function readTags(root: YAMLMap): string[] {
  const tags = root.get("tags", true);
  if (isSeq(tags)) {
    return tags.items.flatMap((tag) =>
      isScalar(tag) && typeof tag.value === "string" ? [tag.value] : [],
    );
  }
  if (isScalar(tags) && typeof tags.value === "string") {
    return tags.value.split(/[\s,]+/).filter(Boolean);
  }
  return [];
}

function readCustomFields(managed: YAMLMap): CustomField[] {
  const custom = managed.get("custom-fields", true);
  if (custom === undefined || (isScalar(custom) && custom.value === null)) return [];
  return decodeCustomFields(seq(custom, "独自項目").items);
}

function readBook(
  { root, managed, editions, purchases }: Omit<ParsedNote, "header" | "book">,
  rules: NoteRules,
): BookRecord {
  const bookId = readId(managed.get("book-id", true), "本");
  const ownedEditions = readEditions(editions, rules);
  const appliedPurchases = readPurchases(purchases, bookId);
  const readingStatus = readReadingStatus(root);
  const tags = readTags(root);
  const customFields = readCustomFields(managed);
  return {
    id: bookId,
    title: text(root.get("book-title", true), "書名"),
    authors: texts(root, "book-authors"),
    tags,
    wanted: flag(root.get("book-wanted", true), "購入希望"),
    ...optionalField("readingStatus", readingStatus),
    ...optionalField("finishedOn", optionalText(root, "book-finished-on")),
    ...optionalField("archivedAt", optionalText(managed, "archived-at")),
    editions: ownedEditions,
    appliedPurchases,
    ...optionalField("pendingMove", readMove(optionalText(managed, "pending-move"), bookId, rules)),
    customFields,
  };
}

/** 本ページを読み取り、書き換えに使うYAMLのノードと一緒に返す。 */
export function parseNote(raw: string, rules: NoteRules): ParsedNote {
  const header = frontmatter(raw);
  const doc = parseDocument(header.source, { uniqueKeys: true, strict: true });
  if (doc.errors.length) return unreadable("本ページのYAMLが壊れています。");
  const root = map(doc.contents, "本ページ");
  const managed = map(root.get("book-props", true), "book-props");
  if (managed.get("schema") !== 1) {
    throw new BookNoteError("unsupported-format", "未対応の本ページ形式です。");
  }
  const editions = seq(managed.get("editions", true), "editions");
  const purchases = seq(managed.get("applied-purchases", true), "applied-purchases");
  const book = readBook({ root, managed, editions, purchases }, rules);
  return { header, root, managed, editions, purchases, book };
}
