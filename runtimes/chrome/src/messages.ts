import { response, type Response } from "@book-props/vault-contract";

// Shapes exchanged between the extension pages and the worker over chrome.runtime messaging.
export type Reply = Response | { kind: "forgotten" | "scopeMismatch" | "manualCheck" };
export type PageState = { supported: boolean; hasBook: boolean; pending: boolean; reply: Reply };
// "unknown" means the plugin could not be reached, which says nothing about the pairing.
// `configured` is always reported; undefined means no connection has been set up.
export type ConnectionStatus = {
  configured: string | undefined;
  state: "paired" | "unpaired" | "unknown";
};

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
