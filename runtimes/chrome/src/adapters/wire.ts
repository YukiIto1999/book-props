import { siteOf } from "@book-props/book-products";
import { product, response, type Product, type Response } from "@book-props/vault-contract";
import type { ConnectionStatus, PageAnswer, PageState, Reply } from "../extension/outcomes.ts";
import type { PopupAction } from "../extension/popup.ts";

// Messages exchanged between the extension's contexts over chrome.runtime and chrome.tabs messaging.
export type PopupMessage = { kind: "inspect" | PopupAction };
export type OptionsMessage = { kind: "status" | "disconnect" } | { kind: "pair"; grantId: string };
export type PageMessage = { kind: "check"; product: Product };
export type TabMessage = { kind: "product" } | { kind: "show"; url: string; reply: Reply };

// Reads one field of a runtime message or stored record without trusting its shape.
export function messageField(message: unknown, key: string): unknown {
  return typeof message === "object" && message !== null ? Reflect.get(message, key) : undefined;
}

export function decodeResponse(value: unknown, fallback: Response): Reply {
  const kind = messageField(value, "kind");
  if (kind === "forgotten" || kind === "scopeMismatch" || kind === "manualCheck") return { kind };
  const parsed = response.safeParse(value);
  return parsed.success ? parsed.data : fallback;
}

export function decodePageState(value: unknown): PageState | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  return {
    supported: messageField(value, "supported") === true,
    hasBook: messageField(value, "hasBook") === true,
    pending: messageField(value, "pending") === true,
    reply: decodeResponse(messageField(value, "reply"), { kind: "unavailable" }),
  };
}

export function decodeConnectionStatus(value: unknown): ConnectionStatus {
  const configured = messageField(value, "configured");
  const state = messageField(value, "state");
  return {
    configured: typeof configured === "string" ? configured : undefined,
    state: state === "paired" || state === "unpaired" ? state : "unknown",
  };
}

export function decodePageAnswer(answer: unknown): PageAnswer {
  const extracted = product.safeParse(messageField(answer, "product"));
  const url = messageField(answer, "url");
  return {
    ...(extracted.success ? { product: extracted.data } : {}),
    ...(typeof url === "string" && siteOf(url) ? { url } : {}),
  };
}
