import { isMap, isScalar, isSeq, type YAMLMap } from "yaml";
import { isJsonObject } from "../../shared/json-object.ts";
import type { CustomField } from "./book-record.ts";
import {
  appendRows,
  dropPair,
  dropRow,
  editableRange,
  fieldEdits,
  type Edit,
  type Frontmatter,
  type Plain,
  type PlainMap,
} from "./edit.ts";
import { unreadable } from "./error.ts";

export function text(node: unknown, field: string): string {
  return isScalar(node) && typeof node.value === "string" && node.value.trim() !== ""
    ? node.value
    : unreadable(`${field} は空でない文字列で指定してください。`);
}

function isPlainScalar(value: unknown): value is string | number | boolean | null {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

/** 版の項目を、書式を除いた値として展開する。キーは順序に依存しないよう並べ替える。 */
export function plainMap(node: YAMLMap): PlainMap {
  editableRange(node);
  const entries = node.items.map(
    ({ key, value }) => [text(key, "版の項目"), plain(value)] as const,
  );
  return Object.fromEntries(entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

function plain(node: unknown): Plain {
  if (isMap(node)) return plainMap(node);
  editableRange(node);
  if (isSeq(node)) return node.items.map(plain);
  if (isScalar(node) && isPlainScalar(node.value)) return node.value;
  return unreadable("移動対象の版に展開できないYAML項目があります。");
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isChoiceList(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (choice) => typeof choice === "string" && choice !== "" && choice.trim() === choice,
    ) &&
    new Set(value).size === value.length
  );
}

function customValue(
  name: string,
  kind: unknown,
  entry: unknown,
  choices: unknown,
): CustomField | undefined {
  if (kind === "text" && typeof entry === "string") return { name, kind, value: entry };
  if (kind === "number" && typeof entry === "number" && Number.isFinite(entry)) {
    return { name, kind, value: entry };
  }
  if (kind === "boolean" && typeof entry === "boolean") return { name, kind, value: entry };
  if (kind === "date" && typeof entry === "string" && isCalendarDate(entry)) {
    return { name, kind, value: entry };
  }
  if (
    kind === "choice" &&
    typeof entry === "string" &&
    isChoiceList(choices) &&
    choices.includes(entry)
  ) {
    return { name, kind, value: entry, choices };
  }
  return undefined;
}

/** 独自項目を、指定された型の値として読み取る。 */
export function decodeCustomField(value: unknown): CustomField {
  if (!isJsonObject(value)) return unreadable("独自項目の形式が正しくありません。");
  const { name, kind, value: entry, choices } = value;
  if (typeof name !== "string" || !name || name.trim() !== name) {
    return unreadable("独自項目の名前が正しくありません。");
  }
  const field = customValue(name, kind, entry, choices);
  return field ?? unreadable("独自項目の値を指定した型で読み取れません。");
}

/** 独自項目のリストを読み取る。同じ名前の項目は一つの本に一つだけ置ける。 */
export function decodeCustomFields(items: readonly unknown[]): CustomField[] {
  const fields = items.map((item) => decodeCustomField(plain(item)));
  if (new Set(fields.map(({ name }) => name)).size !== fields.length) {
    return unreadable("同じ名前の独自項目があります。");
  }
  return fields;
}

/**
 * 独自項目を一行だけ足す、変える、または取り除く。他の行と、変える行の未知のキーやコメントは残す。
 * `index`は変える行の位置で、足すときは負の値を渡す。
 */
export function customFieldEdits(
  header: Frontmatter,
  managed: YAMLMap,
  index: number,
  field: CustomField | undefined,
): Edit[] {
  const list = managed.get("custom-fields", true);
  if (!isSeq(list)) {
    return field ? fieldEdits(header, managed, { "custom-fields": [{ ...field }] }) : [];
  }
  if (index < 0) return field ? [appendRows(header, list, "custom-fields", [{ ...field }])] : [];
  if (!field) return [dropRow(header, list, index, "独自項目")];
  const row = list.items[index];
  if (!isMap(row)) return unreadable("独自項目はYAMLのマップではありません。");
  const stored = plainMap(row);
  const changed = Object.entries(field).filter(
    ([key, value]) => JSON.stringify(stored[key]) !== JSON.stringify(value),
  );
  const edits = fieldEdits(header, row, Object.fromEntries(changed));
  if (!("choices" in field) && "choices" in stored) edits.push(dropPair(header, row, "choices"));
  return edits;
}
