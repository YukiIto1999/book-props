import type { Product, Request, Response } from "@book-props/vault-contract";
import type { BookChange, ConnectionStatus, Reply } from "./outcomes.ts";
import { PendingPurchases, type PendingStore } from "./pending-purchase.ts";
import { VaultSession, type Exchange, type Grants, type SessionStore } from "./vault-session.ts";

export type VaultPorts = {
  exchange: Exchange;
  grants: Grants;
  sessions: SessionStore;
  pending: PendingStore;
};

/** The requests the extension makes of the paired Vault, each under the current session. */
export class VaultClient {
  private readonly session: VaultSession;
  private readonly purchases: PendingPurchases;

  constructor({ exchange, grants, sessions, pending }: VaultPorts) {
    this.session = new VaultSession(exchange, grants, sessions);
    this.purchases = new PendingPurchases(this.session, pending);
  }

  send = async (request: Exclude<Request, { action: "pair" }>): Promise<Response> => {
    const current = await this.session.current();
    return current ? this.session.authorized(current, request) : { kind: "unauthorized" };
  };

  /** Changes a book, then opens its note when the Vault needs the user to pick the book or edition. */
  changeBook = async (kind: BookChange, book: Product): Promise<Response> => {
    const current = await this.session.current();
    if (!current) return { kind: "unauthorized" };
    const outcome =
      kind === "purchase"
        ? await this.purchases.record(book, current)
        : await this.session.authorized(current, { action: kind, product: book });
    if (outcome.kind === "needsInput" && !current.signal.aborted)
      await this.session.authorized(current, { action: "open", product: book, intent: kind });
    return outcome;
  };

  hasPending = (): Promise<boolean> => this.purchases.has();
  forgetPending = (): Promise<Reply> => this.purchases.forget();
  reconcilePending = (): Promise<Reply> => this.purchases.reconcile();
  connectionStatus = (): Promise<ConnectionStatus> => this.session.status();
  pair = (id: string): Promise<Response> => this.session.pair(id);
  disconnect = (): Promise<Response> => this.session.disconnect();
}
