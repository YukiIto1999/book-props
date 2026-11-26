import { siteOf } from "@book-props/book-products";
import { product, response, type Product, type Response } from "@book-props/vault-contract";
import type { ConnectionStatus, PageAnswer, PageState, Reply } from "../extension/outcomes.ts";
import type { PopupAction } from "../extension/popup.ts";

// Messages exchanged between the extension's contexts over chrome.runtime and chrome.tabs messaging.
export type PopupMessage = { kind: "inspect" | PopupAction };
export type OptionsMessage = { kind: "status" | "disconnect" } | { kind: "pair"; grantId: string };
// A content script asks for consent with `consent` before it reads its page, and sends `unmark` only after it checked a book.
export type PageMessage = { kind: "check"; product: Product } | { kind: "consent" | "unmark" };
// `consent` only says that consent changed; the page asks again rather than trusting an order of notices.
export type TabMessage =
  | { kind: "product" }
  | { kind: "show"; url: string; reply: Reply }
  | { kind: "consent" };

// Reads one field of a runtime message or stored record without trusting its shape.
export function messageField(message: unknown, key: string): unknown {
  return typeof message === "object" && message !== null ? Reflect.get(message, key) : undefined;
}

export function decodeResponse(value: unknown, fallback: Response): Reply {
  const kind = messageField(value, "kind");
  if (
    kind === "forgotten" ||
    kind === "scopeMismatch" ||
    kind === "manualCheck" ||
    kind === "consentRequired"
  )
    return { kind };
  const parsed = response.safeParse(value);
  return parsed.success ? parsed.data : fallback;
}

// Of a book, a page state carries only its title and authors.
const bookHeading = product.pick({ title: true, authors: true });

export function decodePageState(value: unknown): PageState | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const book = bookHeading.safeParse(messageField(value, "book"));
  return {
    supported: messageField(value, "supported") === true,
    ...(book.success ? { book: book.data } : {}),
    pending: messageField(value, "pending") === true,
    reply: decodeResponse(messageField(value, "reply"), { kind: "unavailable" }),
  };
}

export function decodeConnectionStatus(value: unknown): ConnectionStatus {
  const configured = messageField(value, "configured");
  const state = messageField(value, "state");
  return {
    configured: typeof configured === "string" ? configured : undefined,
    state:
      state === "paired" || state === "unpaired" || state === "consentRequired" ? state : "unknown",
  };
}

/** The worker's answer to whether the user consented; anything else counts as no consent. */
export function decodeConsent(answer: unknown): boolean {
  return messageField(answer, "given") === true;
}

export function decodePageAnswer(answer: unknown): PageAnswer {
  const extracted = product.safeParse(messageField(answer, "product"));
  const url = messageField(answer, "url");
  return {
    ...(extracted.success ? { product: extracted.data } : {}),
    ...(typeof url === "string" && siteOf(url) ? { url } : {}),
  };
}
