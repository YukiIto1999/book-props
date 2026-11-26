import type { Product, Response } from "@book-props/vault-contract";

/** The answer a page gets: the Vault's reply, or an outcome the extension decided without asking it. */
export type Reply =
  | Response
  | { kind: "forgotten" | "scopeMismatch" | "manualCheck" | "consentRequired" };
export type PageState = { supported: boolean; hasBook: boolean; pending: boolean; reply: Reply };
// "unknown" means the plugin could not be reached, which says nothing about the pairing.
// `configured` is always reported; undefined means no connection has been set up.
export type ConnectionStatus = {
  configured: string | undefined;
  state: "paired" | "unpaired" | "unknown" | "consentRequired";
};
/** The book a tab shows; `url` only when it is a supported product page. */
export type PageAnswer = { product?: Product; url?: string };
export type BookChange = "purchase" | "setWish" | "clearWish";

export const unavailable = { kind: "unavailable" } as const;
// A purchase whose reply is lost may still have been saved, so it stays unknown rather than unavailable.
export const unknownOutcome = { kind: "unknown" } as const;
// The user has not agreed to the disclosure, so nothing read the page or asked the Vault.
export const consentRequired = { kind: "consentRequired" } as const;
