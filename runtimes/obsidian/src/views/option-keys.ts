/** Narrows a dropdown or stored value to one of the keys whose labels were offered. */
export function isOptionKey<Key extends string>(
  labels: Readonly<Record<Key, string>>,
  value: string,
): value is Key {
  return Object.hasOwn(labels, value);
}
