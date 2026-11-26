import type { Product } from "@book-props/vault-contract";
import type { BadgeClaim, TabBadges } from "./badge.ts";
import type { Consent } from "./consent.ts";
import {
  consentRequired,
  unavailable,
  type ActivePage,
  type BookChange,
  type ConnectionStatus,
  type PageAnswer,
  type PageState,
  type Reply,
} from "./outcomes.ts";
import type { VaultClient } from "./vault-client.ts";

/** Asks product page tabs which book they show, shows them a re-check result, and tells them about consent. */
export type PageTabs = {
  /** The active tab and its book; no book when the tab does not answer. */
  active(): Promise<ActivePage>;
  inTab(tabId: number): Promise<PageAnswer>;
  show(tabId: number, url: string, reply: Reply): Promise<void>;
  /** Tells every open page that consent changed, so that each asks again. */
  consentChanged(): Promise<void>;
};
/** What each extension context may ask the worker for. */
export type WorkerOperations = {
  consented(): Promise<boolean>;
  /** Checks the book a product page in `tabId` reads, and marks the tab's toolbar icon with the answer. */
  check(book: Product, tabId: number): Promise<Reply>;
  inspect(): Promise<PageState>;
  open(): Promise<Reply>;
  change(kind: BookChange): Promise<Reply>;
  reconcile(): Promise<Reply>;
  forget(): Promise<Reply>;
  status(): Promise<ConnectionStatus>;
  pair(grantId: string): Promise<Reply>;
  disconnect(): Promise<Reply>;
  /** Checks the book in a tab again and shows the answer there, if it still shows `url`. */
  recheck(tabId: number, url: string): Promise<void>;
  /** Removes a tab's mark, because the tab started loading a page or its page no longer shows a book. */
  unmark(tabId: number): Promise<void>;
  /** Tells open pages that consent changed, and removes every mark once it is withdrawn. */
  consentChanged(): Promise<void>;
};
export type WorkerPorts = {
  client: VaultClient;
  tabs: PageTabs;
  badges: TabBadges;
  consent: Pick<Consent, "given">;
  /** Shows the user the disclosure they have not agreed to. */
  disclose: () => Promise<void>;
};

// The refusals decide each result type, so the Vault's narrower replies widen to a page's reply.
const refusedReply: Reply = consentRequired;
const refusedPage: PageState = { supported: false, pending: false, reply: consentRequired };
const refusedStatus: ConnectionStatus = { configured: undefined, state: "consentRequired" };

/** The worker's operations; until the user consents, none of them asks a tab or the Vault. */
export function workerOperations({
  client,
  tabs,
  badges,
  consent,
  disclose,
}: WorkerPorts): WorkerOperations {
  const inspectBook = async (book: Product | undefined): Promise<Reply> =>
    book ? client.send({ action: "inspect", product: book }) : unavailable;
  // Checks the book a tab shows and marks the tab under `claim`; a tab without a book has nothing to mark.
  const inspectFor = async (claim: BadgeClaim | undefined, book: Product | undefined) => {
    const reply = await inspectBook(book);
    await claim?.mark(book ? reply : undefined);
    return reply;
  };
  const inspectTab = (tabId: number | undefined, book: Product | undefined) =>
    inspectFor(tabId === undefined ? undefined : badges.claim(tabId), book);
  const agreed = async <T>(work: () => Promise<T>, refusal: T): Promise<T> =>
    (await consent.given()) ? work() : refusal;
  return {
    consented: consent.given,
    check: (book, tabId) => agreed(() => inspectTab(tabId, book), refusedReply),
    inspect: () =>
      agreed(async () => {
        const page = await tabs.active();
        const pending = await client.hasPending();
        const reply = await inspectTab(page.tabId, page.product);
        // Of the book, the popup gets only the title and authors the page gave.
        const { title, authors } = page.product ?? {};
        const book = page.product && {
          ...(title ? { title } : {}),
          ...(authors ? { authors } : {}),
        };
        return { supported: Boolean(page.url), ...(book ? { book } : {}), pending, reply };
      }, refusedPage),
    open: () =>
      agreed(async () => {
        const page = await tabs.active();
        return client.send({ action: "open", product: page.product ?? {} });
      }, refusedReply),
    // A saved change re-marks the tab even if the popup closes before it asks again. The tab is claimed when the
    // change starts, so a page load, a move off the book or a withdrawn consent meanwhile skips that check and
    // keeps the old book's dot off; the change's outcome stands whether or not the check gets an answer.
    change: (kind) =>
      agreed(async () => {
        const page = await tabs.active();
        if (!page.product) return unavailable;
        const claim = page.tabId === undefined ? undefined : badges.claim(page.tabId);
        const outcome = await client.changeBook(kind, page.product);
        const saved = outcome.kind === "saved" || outcome.kind === "replayed";
        if (saved && claim && (await consent.given()) && claim.current())
          await inspectFor(claim, page.product).catch(() => undefined);
        return outcome;
      }, refusedReply),
    reconcile: () => agreed(client.reconcilePending, refusedReply),
    forget: () => agreed(client.forgetPending, refusedReply),
    status: () => agreed(client.connectionStatus, refusedStatus),
    pair: (grantId) => agreed(() => client.pair(grantId), refusedReply),
    disconnect: () => agreed(client.disconnect, refusedReply),
    // A re-check the user asked for before agreeing opens the disclosure instead.
    async recheck(tabId, url) {
      if (!(await consent.given())) return disclose();
      const page = await tabs.inTab(tabId);
      if (page.url !== url) return;
      await tabs.show(tabId, url, await inspectTab(tabId, page.product));
    },
    unmark: badges.clear,
    async consentChanged() {
      const withdrawn = !(await consent.given());
      await Promise.all([tabs.consentChanged(), withdrawn ? badges.clearAll() : undefined]);
    },
  };
}
