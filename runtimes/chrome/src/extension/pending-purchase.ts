import type { Product, Request, Response } from "@book-props/vault-contract";
import { unknownOutcome, type Reply } from "./outcomes.ts";
import type { LiveConnection, VaultSession } from "./vault-session.ts";

type Purchase = Extract<Request, { action: "purchase" }>;
/** A purchase whose outcome is unknown, with the Vault and book folder it went to; records from before folders were tracked have no scope. */
export type Pending = { origin: string; scope?: string; operation: Purchase };
type PendingRecord = {
  pending: Pending | "unreadable" | undefined;
  clientId: string | undefined;
};
/** Keeps at most one pending purchase and this browser's purchase client ID across restarts. */
export type PendingStore = {
  read(): Promise<PendingRecord>;
  save(clientId: string, pending: Pending): Promise<void>;
  clear(): Promise<void>;
};

/** Records each purchase before sending it, and re-checks or releases one whose outcome was lost. */
export class PendingPurchases {
  private readonly session: VaultSession;
  private readonly store: PendingStore;
  private changing = false;

  constructor(session: VaultSession, store: PendingStore) {
    this.session = session;
    this.store = store;
  }

  // Only one popup may record, re-check, or release the pending purchase at a time.
  private async exclusive<T extends Reply>(
    work: () => Promise<T>,
  ): Promise<T | typeof unknownOutcome> {
    if (this.changing) return unknownOutcome;
    this.changing = true;
    try {
      return await work();
    } finally {
      this.changing = false;
    }
  }

  record(book: Product, current: LiveConnection): Promise<Response> {
    return this.exclusive(async () => {
      const stored = await this.store.read();
      if (stored.pending) return unknownOutcome;
      const clientId = stored.clientId ?? crypto.randomUUID();
      const operation: Purchase = {
        action: "purchase",
        product: book,
        purchase: { clientId, requestId: crypto.randomUUID(), issuedAt: Date.now() },
      };
      await this.store.save(clientId, { origin: current.origin, scope: current.scope, operation });
      const outcome = await this.session.authorized(current, operation);
      if (outcome.kind !== "unknown" && outcome.kind !== "unavailable") await this.store.clear();
      return outcome;
    });
  }

  async has(): Promise<boolean> {
    return Boolean((await this.store.read()).pending);
  }

  forget(): Promise<Reply> {
    return this.exclusive(async () => {
      if (!(await this.store.read()).pending) return { kind: "notSaved" };
      await this.store.clear();
      return { kind: "forgotten" };
    });
  }

  /** Asks the Vault the purchase was made in whether it was saved; never another Vault or folder. */
  reconcile(): Promise<Reply> {
    return this.exclusive(async () => {
      const { pending } = await this.store.read();
      if (!pending) return { kind: "notSaved" };
      if (pending === "unreadable" || !pending.scope) return { kind: "manualCheck" };
      const current = await this.session.current();
      if (!current) return { kind: "unauthorized" };
      if (current.origin !== pending.origin || current.scope !== pending.scope)
        return { kind: "scopeMismatch" };
      const outcome = await this.session.authorized(current, {
        ...pending.operation,
        action: "reconcile",
      });
      if (outcome.kind === "replayed") await this.store.clear();
      return outcome;
    });
  }
}
