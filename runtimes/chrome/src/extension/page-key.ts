import type { ActivePage } from "./outcomes.ts";

/**
 * Names the active tab and the book its page gave, so that an action can tell whether the page still shows
 * what the popup showed. It is a SHA-256 digest, so the popup holds no more of the book than its heading.
 */
export async function pageKey({ tabId, product }: ActivePage): Promise<string> {
  // Sorted fields make the same book give the same name however the page listed them.
  const book =
    product && Object.fromEntries(Object.entries(product).sort(([a], [b]) => (a < b ? -1 : 1)));
  const named = new TextEncoder().encode(JSON.stringify([tabId ?? null, book ?? null]));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", named));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Whether a value has the shape `pageKey` gives; anything else names no page. */
export function isPageKey(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}
