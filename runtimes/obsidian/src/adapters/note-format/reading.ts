import type { Reading } from "../../core/catalog-core.ts";
import { optionalField } from "../../shared/optional-field.ts";
import type { BookRecord } from "./book-record.ts";
import { dropPair, fieldEdits, type Edit } from "./edit.ts";
import type { ParsedNote } from "./parse.ts";

/** 本の読書状態のプロパティ。値は`unread`などのキーで、Obsidianのプロパティ欄でも書き換えられる。 */
export const readingStatusKey = "book-reading-status";
/** 本を読み終えた日のプロパティ。 */
export const finishedOnKey = "book-finished-on";

/** 本ページから読んだ本の、読書状態と読了日。 */
export function readingOf({ readingStatus, finishedOn }: BookRecord): Reading {
  return { ...optionalField("status", readingStatus), ...optionalField("finishedOn", finishedOn) };
}

/** 読書状態と読了日のうち、`baseline`から変わる部分を、プロパティ名と変えた後の値で返す。 */
function changedParts(baseline: Reading, value: Reading): [string, string | undefined][] {
  const parts: [string, string | undefined, string | undefined][] = [
    [readingStatusKey, baseline.status, value.status],
    [finishedOnKey, baseline.finishedOn, value.finishedOn],
  ];
  return parts.flatMap(([key, before, after]) => (before === after ? [] : [[key, after]]));
}

/**
 * 読書状態と読了日のうち、`baseline`から変わる部分だけを書く編集。空にする部分はプロパティごと
 * 取り除き、足すプロパティは`book-props`の前に置く。
 */
export function readingEdits(
  { header, root }: ParsedNote,
  baseline: Reading,
  value: Reading,
): Edit[] {
  const fields: Record<string, string> = {};
  const dropped: Edit[] = [];
  for (const [key, after] of changedParts(baseline, value)) {
    if (after !== undefined) fields[key] = after;
    else if (root.has(key)) dropped.push(dropPair(header, root, key));
  }
  return [...fieldEdits(header, root, fields, { before: "book-props" }), ...dropped];
}

/** 書き換えた後の本で、変えた部分が指定した値になっているか。 */
export function confirmsReading(saved: BookRecord, baseline: Reading, value: Reading): boolean {
  const actual = readingOf(saved);
  return (
    (value.status === baseline.status || actual.status === value.status) &&
    (value.finishedOn === baseline.finishedOn || actual.finishedOn === value.finishedOn)
  );
}
