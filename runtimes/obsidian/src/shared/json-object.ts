/** JSONから読み取った値が、配列ではないオブジェクトであるかを確かめる。 */
export function isJsonObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
