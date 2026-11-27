import type { Product, Response } from "@book-props/vault-contract";

/**
 * The answer a page gets: the Vault's reply, or an outcome the extension decided without asking it.
 * `pageChanged` means the active tab no longer shows what the popup showed, so nothing was written.
 */
export type Reply =
  | Response
  | { kind: "forgotten" | "scopeMismatch" | "manualCheck" | "consentRequired" | "pageChanged" };
/** What a popup shows of a book: its title and authors as the page gave them. */
type BookHeading = Pick<Product, "title" | "authors">;
/**
 * The active tab as the popup sees it; `book` only when the page shows one. `page` names the tab and the book
 * the page gave without revealing the book; each action on the page carries it back.
 */
export type PageState = {
  supported: boolean;
  book?: BookHeading;
  page?: string;
  pending: boolean;
  reply: Reply;
};
// "unknown" means the plugin could not be reached, which says nothing about the pairing.
// `configured` is always reported; undefined means no connection has been set up.
export type ConnectionStatus = {
  configured: string | undefined;
  state: "paired" | "unpaired" | "unknown" | "consentRequired";
};
/** The book a tab shows; `url` only when it is a supported product page. */
export type PageAnswer = { product?: Product; url?: string };
/** The active tab's id, when there is one, and the book it shows. */
export type ActivePage = PageAnswer & { tabId?: number };
export type BookChange = "purchase" | "setWish" | "clearWish";
/** The popup's actions on the book its page shows, which the worker runs only while the page still shows it. */
export type PageAction = BookChange | "open";

export const unavailable = { kind: "unavailable" } as const;
// A purchase whose reply is lost may still have been saved, so it stays unknown rather than unavailable.
export const unknownOutcome = { kind: "unknown" } as const;
// The user has not agreed to the disclosure, so nothing read the page or asked the Vault.
export const consentRequired = { kind: "consentRequired" } as const;
// The popup's page changed after it was shown, so the action it asked for was not run.
export const pageChanged = { kind: "pageChanged" } as const;
