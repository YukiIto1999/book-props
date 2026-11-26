import type { Product } from "@book-props/vault-contract";
import type { Consent } from "./consent.ts";
import {
  consentRequired,
  unavailable,
  type BookChange,
  type ConnectionStatus,
  type PageAnswer,
  type PageState,
  type Reply,
} from "./outcomes.ts";
import type { VaultClient } from "./vault-client.ts";

/** Asks product page tabs which book they show, shows them a re-check result, and tells them about consent. */
export type PageTabs = {
  /** The active tab's book; empty when the tab does not answer. */
  active(): Promise<PageAnswer>;
  inTab(tabId: number): Promise<PageAnswer>;
  show(tabId: number, url: string, reply: Reply): Promise<void>;
  /** Tells every open page that consent changed, so that each asks again. */
  consentChanged(): Promise<void>;
};
/** What each extension context may ask the worker for. */
export type WorkerOperations = {
  consented(): Promise<boolean>;
  check(book: Product): Promise<Reply>;
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
};
export type WorkerPorts = {
  client: VaultClient;
  tabs: PageTabs;
  consent: Pick<Consent, "given">;
  /** Shows the user the disclosure they have not agreed to. */
  disclose: () => Promise<void>;
};

// The refusals decide each result type, so the Vault's narrower replies widen to a page's reply.
const refusedReply: Reply = consentRequired;
const refusedPage: PageState = {
  supported: false,
  hasBook: false,
  pending: false,
  reply: consentRequired,
};
const refusedStatus: ConnectionStatus = { configured: undefined, state: "consentRequired" };

/** The worker's operations; until the user consents, none of them asks a tab or the Vault. */
export function workerOperations({
  client,
  tabs,
  consent,
  disclose,
}: WorkerPorts): WorkerOperations {
  const inspectBook = async (book: Product | undefined): Promise<Reply> =>
    book ? client.send({ action: "inspect", product: book }) : unavailable;
  const agreed = async <T>(work: () => Promise<T>, refusal: T): Promise<T> =>
    (await consent.given()) ? work() : refusal;
  return {
    consented: consent.given,
    check: (book) => agreed(() => inspectBook(book), refusedReply),
    inspect: () =>
      agreed(async () => {
        const page = await tabs.active();
        const pending = await client.hasPending();
        const reply = await inspectBook(page.product);
        return { supported: Boolean(page.url), hasBook: Boolean(page.product), pending, reply };
      }, refusedPage),
    open: () =>
      agreed(async () => {
        const page = await tabs.active();
        return client.send({ action: "open", product: page.product ?? {} });
      }, refusedReply),
    change: (kind) =>
      agreed(async () => {
        const page = await tabs.active();
        return page.product ? client.changeBook(kind, page.product) : unavailable;
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
      await tabs.show(tabId, url, await inspectBook(page.product));
    },
  };
}
