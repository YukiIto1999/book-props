import type { Product } from "@book-props/vault-contract";
import {
  unavailable,
  type BookChange,
  type ConnectionStatus,
  type PageAnswer,
  type PageState,
  type Reply,
} from "./outcomes.ts";
import type { VaultClient } from "./vault-client.ts";

/** Asks product page tabs which book they show and shows them a re-check result. */
export type PageTabs = {
  /** The active tab's book; empty when the tab does not answer. */
  active(): Promise<PageAnswer>;
  inTab(tabId: number): Promise<PageAnswer>;
  show(tabId: number, url: string, reply: Reply): Promise<void>;
};
/** What each extension context may ask the worker for. */
export type WorkerOperations = {
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

export function workerOperations(client: VaultClient, tabs: PageTabs): WorkerOperations {
  const inspectBook = async (book: Product | undefined): Promise<Reply> =>
    book ? client.send({ action: "inspect", product: book }) : unavailable;
  return {
    check: inspectBook,
    async inspect() {
      const page = await tabs.active();
      const pending = await client.hasPending();
      const reply = await inspectBook(page.product);
      return { supported: Boolean(page.url), hasBook: Boolean(page.product), pending, reply };
    },
    async open() {
      const page = await tabs.active();
      return client.send({ action: "open", product: page.product ?? {} });
    },
    async change(kind) {
      const page = await tabs.active();
      return page.product ? client.changeBook(kind, page.product) : unavailable;
    },
    reconcile: client.reconcilePending,
    forget: client.forgetPending,
    status: client.connectionStatus,
    pair: client.pair,
    disconnect: client.disconnect,
    async recheck(tabId, url) {
      const page = await tabs.inTab(tabId);
      if (page.url !== url) return;
      await tabs.show(tabId, url, await inspectBook(page.product));
    },
  };
}
