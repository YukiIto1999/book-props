/** The element the page's markup must contain, of the kind the view drives. */
export function required<T extends Element>(
  selector: string,
  kind: { new (): T; prototype: T },
): T {
  const found = document.querySelector(selector);
  if (found instanceof kind) return found;
  throw new Error(`${selector} が見つかりません。`);
}
