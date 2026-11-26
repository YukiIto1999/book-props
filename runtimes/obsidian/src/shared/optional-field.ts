/**
 * 値があるときだけ項目を持つオブジェクト。`undefined`は項目がないことを表し、キーも残さない。
 * @param key - 項目名
 * @param value - 項目の値。`undefined`なら項目を作らない
 * @returns 展開して使う、項目が一つか空のオブジェクト
 */
export function optionalField<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
  const field: { [P in K]?: V } = {};
  if (value !== undefined) field[key] = value;
  return field;
}
