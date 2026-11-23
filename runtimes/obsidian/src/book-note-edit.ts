import { isMap, isScalar, isSeq, stringify, type Node, type YAMLMap, type YAMLSeq } from "yaml";
import { unreadable } from "./book-note-error.ts";
import type { AppliedPurchase, EditionRecord } from "./book-note.ts";

/** 本ページ先頭のYAML。`offset`と`end`は全文での位置、`source`はYAMLの部分だけを持つ。 */
export type Frontmatter = Readonly<{
  offset: number;
  end: number;
  source: string;
  lineBreak: string;
}>;
/** `Frontmatter.source`の`start`から`end`までを`text`に置き換える。 */
export type Edit = Readonly<{ start: number; end: number; text: string }>;
export type Plain = string | number | boolean | null | readonly Plain[] | PlainMap;
export type PlainMap = Readonly<{ [key: string]: Plain }>;
type StoredEdition = Readonly<Record<string, string | boolean | readonly string[] | undefined>>;
type FieldValues = Readonly<Record<string, Plain | undefined>>;
type RowField = "editions" | "applied-purchases" | "isbns" | "custom-fields";
type Row = object | string;
/** 本ページのYAMLで、購入を適用した本と版を持つ項目の名前。 */
const appliedTo = "result";

/** 他の項目に影響せずに置き換えられるノードだけについて、YAML内の範囲を返す。 */
export function editableRange(node: unknown): NonNullable<Node["range"]> {
  if ((!isScalar(node) && !isMap(node) && !isSeq(node)) || !node.range || node.anchor || node.tag) {
    return unreadable("別の項目に影響せずにYAMLを書き換えられません。");
  }
  return node.range;
}

export function replace(node: unknown, text: string): Edit {
  const [start, end] = editableRange(node);
  return { start, end, text };
}

export function storePurchase(purchase: AppliedPurchase) {
  return {
    "request-id": purchase.requestId,
    "client-id": purchase.clientId,
    "input-hash": purchase.inputHash,
    "applied-at": purchase.appliedAt,
    [appliedTo]: { "book-id": purchase.bookId, "edition-id": purchase.editionId },
  };
}

export function storeEdition(edition: EditionRecord): StoredEdition {
  return {
    id: edition.id,
    label: edition.label,
    isbns: edition.isbns,
    owned: edition.owned,
    publisher: edition.publisher,
    "published-on": edition.publishedOn,
    cover: edition.cover,
    "purchased-on": edition.purchasedOn,
    "purchased-from": edition.purchasedFrom,
    "archived-at": edition.archivedAt,
  };
}

function lineStart(source: string, position: number): number {
  return source.lastIndexOf("\n", position - 1) + 1;
}

/** `end`までの範囲を含む行の、改行の直後の位置。範囲が改行で終わるときは`end`を返す。 */
function rowEnd(source: string, end: number): number {
  if (source[end - 1] === "\n") return end;
  const next = source.indexOf("\n", end);
  return next < 0 ? source.length : next + 1;
}

/** 行頭から`start`までの字下げ。空白以外があれば、ブロックの位置を識別できない。 */
function blockIndent(source: string, start: number): string {
  const indent = source.slice(lineStart(source, start), start);
  return /^ *$/.test(indent) ? indent : unreadable("YAMLのブロックの位置を識別できません。");
}

function blockRows(values: readonly unknown[], indent: string, lineBreak: string): string {
  return stringify(values)
    .trimEnd()
    .split("\n")
    .map((line) => indent + line)
    .join(lineBreak);
}

/**
 * 複数行のブロックを一行の値に置き換える。直前の行がコメントのないキーの行なら、その行に値を続ける。
 * そうでなければ、キーより深い字下げで次の行に置き、前にあるコメントの行を残す。
 */
function collapseBlock(header: Frontmatter, start: number, end: number, encoded: string): Edit {
  const { source, lineBreak } = header;
  const column = blockIndent(source, start).length;
  const begin = start - column;
  const stop = rowEnd(source, end);
  const previous = source.slice(lineStart(source, begin - 1), begin);
  const keyLine = /^ *(?:-[ \t]+)*[^\s#][^#\r\n]*:([ \t]*\r?\n)$/.exec(previous);
  if (begin > 0 && keyLine?.[1]) {
    return { start: begin - keyLine[1].length, end: stop, text: ` ${encoded}${lineBreak}` };
  }
  const above = source
    .slice(0, begin)
    .split("\n")
    .findLast((line) => !/^[ \t]*(?:#.*)?\r?$/.test(line));
  const keyColumn = /^ *(?:-[ \t]+)*/.exec(above ?? "")?.[0].length ?? 0;
  const indent = " ".repeat(Math.max(column, keyColumn + 2));
  return { start: begin, end: stop, text: `${indent}${encoded}${lineBreak}` };
}

function appendFlowRows(
  header: Frontmatter,
  sequence: YAMLSeq,
  field: RowField,
  values: readonly Row[],
): Edit {
  const [start, end] = editableRange(sequence);
  const [suffix] = header.source.slice(end).split(/\r?\n/, 1);
  const keyLine = header.source.slice(lineStart(header.source, start), start);
  const key = /^( +)(editions|applied-purchases|isbns|custom-fields):([ \t]*)$/.exec(keyLine);
  if (sequence.items.length === 0 && suffix.trim() === "" && key?.[2] === field) {
    const rows = blockRows(values, `${key[1]}  `, header.lineBreak);
    return { start: start - key[3].length, end, text: header.lineBreak + rows };
  }
  const items = values
    .map((value) => stringify(value, { collectionStyle: "flow", lineWidth: 0 }).trimEnd())
    .join(", ");
  const at = header.source.slice(0, end - 1).trimEnd().length;
  return { start: at, end: at, text: `${sequence.items.length ? ", " : ""}${items}` };
}

/** リストの末尾に行を足す。既存の行、コメント、書式は変えない。 */
export function appendRows(
  header: Frontmatter,
  sequence: YAMLSeq,
  field: RowField,
  values: readonly Row[],
): Edit {
  if (sequence.flow) return appendFlowRows(header, sequence, field, values);
  const [start, end] = editableRange(sequence);
  const indent = /^ */.exec(header.source.slice(lineStart(header.source, start), start))?.[0];
  if (indent === undefined || header.source[start] !== "-") {
    return unreadable(`${field}を安全に追記できません。`);
  }
  const lineEnd = header.source[end - 1] === "\n" ? end : header.source.indexOf("\n", end) + 1;
  if (lineEnd <= 0) return unreadable(`${field}を安全に追記できません。`);
  const text = blockRows(values, indent, header.lineBreak) + header.lineBreak;
  return { start: lineEnd, end: lineEnd, text };
}

function isTextList(value: Plain): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function encodeField(value: Plain): string {
  const options = {
    collectionStyle: "flow",
    defaultStringType: "QUOTE_DOUBLE",
    lineWidth: 0,
  } as const;
  return stringify(value, options).trimEnd();
}

/**
 * 値だけを置き換える。複数行のリストは同じ字下げのリストとして書き直し、
 * 空のリストや他の値になる複数行のブロックは一行にまとめる。どちらも次の項目との改行を残す。
 */
function replaceField(header: Frontmatter, stored: unknown, value: Plain): Edit {
  const [start, end] = editableRange(stored);
  const encoded = encodeField(value);
  if ((isSeq(stored) || isMap(stored)) && !stored.flow) {
    if (!isSeq(stored) || !Array.isArray(value) || !value.length) {
      return collapseBlock(header, start, end, encoded);
    }
    const indent = blockIndent(header.source, start);
    const rows = blockRows(value, indent, header.lineBreak) + header.lineBreak;
    return { start: start - indent.length, end: rowEnd(header.source, end), text: rows };
  }
  if (start !== end) {
    const lineBreak = header.source[end - 1] === "\n" ? header.lineBreak : "";
    return { start, end, text: encoded + lineBreak };
  }
  const before = header.source[start - 1] === ":" ? " " : "";
  const after = header.source[end] === "#" ? " " : "";
  return { start, end, text: before + encoded + after };
}

function insertFields(header: Frontmatter, node: YAMLMap, missing: readonly string[]): Edit {
  const [start, end] = editableRange(node);
  if (node.flow) {
    const separator = node.items.length ? ", " : "";
    return { start: end - 1, end: end - 1, text: `${separator}${missing.join(", ")}` };
  }
  const indent = " ".repeat(start - lineStart(header.source, start));
  const lines = missing.join(header.lineBreak + indent);
  return { start, end: start, text: `${lines}${header.lineBreak}${indent}` };
}

/**
 * マップの項目を置き換え、ない項目は先頭に足す。値が`undefined`の項目は変えない。
 * `appendIsbnAliases`では、既存のISBNのリストを置き換えずに末尾へ足す。
 */
export function fieldEdits(
  header: Frontmatter,
  node: YAMLMap,
  fields: FieldValues,
  appendIsbnAliases = false,
): Edit[] {
  editableRange(node);
  const edits: Edit[] = [];
  const missing: string[] = [];
  for (const [name, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    const stored = node.get(name, true);
    if (appendIsbnAliases && name === "isbns" && isSeq(stored) && isTextList(value)) {
      edits.push(appendRows(header, stored, "isbns", value));
    } else if (stored === undefined) {
      missing.push(`${name}: ${encodeField(value)}`);
    } else {
      edits.push(replaceField(header, stored, value));
    }
  }
  if (missing.length) edits.push(insertFields(header, node, missing));
  return edits;
}

/** 重ならない編集をYAMLの範囲内だけに適用し、本文と他の行はそのまま残す。 */
export function spliceNote(raw: string, header: Frontmatter, edits: Edit[]): string {
  if (!edits.length) return raw;
  let cursor = header.offset;
  const parts = [raw.slice(0, cursor)];
  for (const edit of edits.sort((a, b) => a.start - b.start)) {
    const start = header.offset + edit.start;
    if (cursor > start || header.offset + edit.end > header.end) {
      return unreadable("YAMLの更新範囲を確定できません。");
    }
    parts.push(raw.slice(cursor, start), edit.text);
    cursor = header.offset + edit.end;
  }
  parts.push(raw.slice(cursor));
  return parts.join("");
}

function dropFlowItem(ranges: readonly (readonly number[])[], index: number): Edit {
  const [start, stop] = ranges[index] ?? [];
  const [next] = ranges[index + 1] ?? [];
  const [, previous] = ranges[index - 1] ?? [];
  const [from, to] = index === ranges.length - 1 ? [previous, stop] : [start, next];
  if (from === undefined || to === undefined) return unreadable("YAMLの項目だけを取り除けません。");
  return { start: from, end: to, text: "" };
}

/** ブロック形式のリストの一行を、`-`のある行から項目の最後の行まで取り除く。前後の行は残す。 */
function dropBlockRow(header: Frontmatter, sequence: YAMLSeq, index: number, label: string): Edit {
  const { source } = header;
  const [first] = editableRange(sequence);
  const [start, stop] = editableRange(sequence.items[index]);
  const dash = source.slice(0, start).search(/-[ \t\r\n]*$/);
  if (dash < 0 || blockIndent(source, dash) !== blockIndent(source, first)) {
    return unreadable(`${label}の先頭行を識別できません。`);
  }
  return { start: lineStart(source, dash), end: rowEnd(source, stop), text: "" };
}

/** リストから一行だけを取り除く。最後の一行を取り除くと空のリストを残す。 */
export function dropRow(
  header: Frontmatter,
  sequence: YAMLSeq,
  index: number,
  label: string,
): Edit {
  const [start, end] = editableRange(sequence);
  if (sequence.items.length === 1) {
    return sequence.flow ? { start, end, text: "[]" } : collapseBlock(header, start, end, "[]");
  }
  if (sequence.flow) return dropFlowItem(sequence.items.map(editableRange), index);
  return dropBlockRow(header, sequence, index, label);
}

/** 版のリストから一行だけを取り除く。 */
export function dropEditionRow(header: Frontmatter, editions: YAMLSeq, index: number): Edit {
  return dropRow(header, editions, index, "版");
}

/** マップから一つの項目を取り除く。同じ行で始まる`-`や、他の項目とコメントの行は残す。 */
export function dropPair(header: Frontmatter, node: YAMLMap, name: string): Edit {
  editableRange(node);
  const index = node.items.findIndex(({ key }) => isScalar(key) && key.value === name);
  if (index < 0 || node.items.length < 2) return unreadable(`${name}だけを取り除けません。`);
  const ranges = node.items.map(({ key, value }) => [
    editableRange(key)[0],
    editableRange(value)[1],
  ]);
  if (node.flow) return dropFlowItem(ranges, index);
  const [start = 0, stop = 0] = ranges[index] ?? [];
  const begin = lineStart(header.source, start);
  if (/^ *$/.test(header.source.slice(begin, start))) {
    return { start: begin, end: rowEnd(header.source, stop), text: "" };
  }
  const [next] = ranges[index + 1] ?? [];
  return next === undefined
    ? unreadable(`${name}だけを取り除けません。`)
    : { start, end: next, text: "" };
}
