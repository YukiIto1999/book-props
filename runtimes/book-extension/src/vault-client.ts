import {
  connectionOrigin,
  decodePairing,
  request,
  vaultScope,
  type Product,
  type Request,
  type Response,
} from "@book-props/vault-contract";
import { messageField, type ConnectionStatus, type Reply } from "./messages.ts";
import type { Exchange, VaultPeer } from "./vault-transport.ts";

type Connection = VaultPeer & { token: string; expiresAt: number; scope: string };
type LiveConnection = Connection & { signal: AbortSignal };
type Purchase = Extract<Request, { action: "purchase" }>;
type Pending = { origin: string; scope?: string; operation: Purchase };
export type BookChange = "purchase" | "setWish" | "clearWish";

const unknownOutcome = { kind: "unknown" } as const;
export const unavailable = { kind: "unavailable" } as const;

function decodeConnection(stored: unknown): Connection | undefined {
  const origin = messageField(stored, "origin");
  const anchor = messageField(stored, "anchor");
  const token = messageField(stored, "token");
  const expiresAt = messageField(stored, "expiresAt");
  const scope = vaultScope.safeParse(messageField(stored, "scope"));
  if (
    typeof origin !== "string" ||
    typeof anchor !== "string" ||
    typeof token !== "string" ||
    typeof expiresAt !== "number"
  )
    return undefined;
  return connectionOrigin(origin) && scope.success
    ? { origin, anchor, token, expiresAt, scope: scope.data }
    : undefined;
}

function decodePending(stored: unknown): Pending | undefined {
  const origin = messageField(stored, "origin");
  const storedScope = messageField(stored, "scope");
  const scope = vaultScope.safeParse(storedScope);
  const parsed = request.safeParse(messageField(stored, "operation"));
  const operation = parsed.success ? parsed.data : undefined;
  if (typeof origin !== "string" || operation?.action !== "purchase") return undefined;
  if (storedScope === undefined) return { origin, operation };
  return scope.success ? { origin, scope: scope.data, operation } : undefined;
}

export class VaultClient {
  private readonly sessionAccess = chrome.storage.session.setAccessLevel({
    accessLevel: "TRUSTED_CONTEXTS",
  });
  private readonly localAccess = chrome.storage.local.setAccessLevel({
    accessLevel: "TRUSTED_CONTEXTS",
  });
  private readonly exchange: Exchange;
  private changingPendingPurchase = false;
  private sessionChanges: Promise<unknown> = Promise.resolve();
  private sessionLifetime = new AbortController();

  constructor(exchange: Exchange) {
    this.exchange = exchange;
  }

  private changeSession<T>(work: () => Promise<T>): Promise<T> {
    const next = this.sessionChanges.then(work);
    this.sessionChanges = next.catch(() => undefined);
    return next;
  }

  private async session(): Promise<LiveConnection | undefined> {
    await this.sessionAccess;
    const currentChange = this.sessionChanges;
    await currentChange;
    const { signal } = this.sessionLifetime;
    const { connection: stored } = await chrome.storage.session.get("connection");
    const connection = decodeConnection(stored);
    return currentChange === this.sessionChanges &&
      !signal.aborted &&
      connection &&
      connection.expiresAt > Date.now()
      ? { ...connection, signal }
      : undefined;
  }

  private resetSessionLifetime(): void {
    this.sessionLifetime.abort();
    this.sessionLifetime = new AbortController();
  }

  private async call(
    peer: VaultPeer,
    vaultRequest: Request,
    token?: string,
    signal?: AbortSignal,
  ): Promise<Response> {
    const failure = vaultRequest.action === "purchase" ? unknownOutcome : unavailable;
    try {
      return (await this.exchange(peer, vaultRequest, token, signal)) ?? failure;
    } catch {
      return failure;
    }
  }

  private async authorized(current: LiveConnection, vaultRequest: Request): Promise<Response> {
    if (current.signal.aborted || current.expiresAt <= Date.now()) return { kind: "unauthorized" };
    const reply = await this.call(current, vaultRequest, current.token, current.signal);
    if (reply.kind === "unauthorized") {
      await this.changeSession(async () => {
        await this.sessionAccess;
        const { connection: stored } = await chrome.storage.session.get("connection");
        if (messageField(stored, "token") === current.token) {
          this.resetSessionLifetime();
          await chrome.storage.session.remove("connection");
        }
      });
    }
    return reply;
  }

  send = async (vaultRequest: Exclude<Request, { action: "pair" }>): Promise<Response> => {
    const current = await this.session();
    return current ? this.authorized(current, vaultRequest) : { kind: "unauthorized" };
  };

  private async withPendingPurchase<T extends Reply>(
    work: () => Promise<T>,
  ): Promise<T | typeof unknownOutcome> {
    if (this.changingPendingPurchase) return unknownOutcome;
    this.changingPendingPurchase = true;
    try {
      return await work();
    } finally {
      this.changingPendingPurchase = false;
    }
  }

  private purchase(book: Product, current: LiveConnection): Promise<Response> {
    return this.withPendingPurchase(async () => {
      await this.localAccess;
      const stored = await chrome.storage.local.get(["pending", "clientId"]);
      if (stored.pending) return unknownOutcome;
      const clientId = typeof stored.clientId === "string" ? stored.clientId : crypto.randomUUID();
      const operation: Purchase = {
        action: "purchase",
        product: book,
        purchase: { clientId, requestId: crypto.randomUUID(), issuedAt: Date.now() },
      };
      await chrome.storage.local.set({
        clientId,
        pending: { origin: current.origin, scope: current.scope, operation } satisfies Pending,
      });
      const outcome = await this.authorized(current, operation);
      if (outcome.kind !== "unknown" && outcome.kind !== "unavailable")
        await chrome.storage.local.remove("pending");
      return outcome;
    });
  }

  changeBook = async (kind: BookChange, book: Product): Promise<Response> => {
    const current = await this.session();
    if (!current) return { kind: "unauthorized" };
    const outcome =
      kind === "purchase"
        ? await this.purchase(book, current)
        : await this.authorized(current, { action: kind, product: book });
    if (outcome.kind === "needsInput" && !current.signal.aborted)
      await this.authorized(current, { action: "open", product: book, intent: kind });
    return outcome;
  };

  private async storedPending(): Promise<unknown> {
    await this.localAccess;
    const { pending } = await chrome.storage.local.get("pending");
    return pending;
  }

  hasPending = async (): Promise<boolean> => {
    return Boolean(await this.storedPending());
  };

  forgetPending = (): Promise<Reply> => {
    return this.withPendingPurchase(async () => {
      if (!(await this.storedPending())) return { kind: "notSaved" };
      await chrome.storage.local.remove("pending");
      return { kind: "forgotten" };
    });
  };

  reconcilePending = (): Promise<Reply> => {
    return this.withPendingPurchase(async () => {
      const stored = await this.storedPending();
      if (!stored) return { kind: "notSaved" };
      const pending = decodePending(stored);
      if (!pending?.scope) return { kind: "manualCheck" };
      const current = await this.session();
      if (!current) return { kind: "unauthorized" };
      if (current.origin !== pending.origin || current.scope !== pending.scope)
        return { kind: "scopeMismatch" };
      const outcome = await this.authorized(current, { ...pending.operation, action: "reconcile" });
      if (outcome.kind === "replayed") await chrome.storage.local.remove("pending");
      return outcome;
    });
  };

  connectionStatus = async (): Promise<ConnectionStatus> => {
    await this.localAccess;
    const { origin } = await chrome.storage.local.get("origin");
    const configured = typeof origin === "string" ? connectionOrigin(origin) : undefined;
    const current = await this.session();
    if (!current) return { configured, state: "unpaired" };
    const reply = await this.authorized(current, { action: "status" });
    if (reply.kind === "connected") return { configured, state: "paired" };
    return { configured, state: reply.kind === "unauthorized" ? "unpaired" : "unknown" };
  };

  pair = async (text: unknown): Promise<Response> => {
    const pairing = typeof text === "string" ? decodePairing(text) : undefined;
    if (!pairing) return { kind: "invalidRequest" };
    const { origin, anchor, code } = pairing;
    return this.changeSession(async (): Promise<Response> => {
      const reply = await this.call({ origin, anchor }, { action: "pair", code });
      if (reply.kind !== "paired") return reply;
      const { token, expiresAt, scope } = reply;
      await this.localAccess;
      await this.sessionAccess;
      this.resetSessionLifetime();
      await chrome.storage.session.set({
        connection: { origin, anchor, token, expiresAt, scope } satisfies Connection,
      });
      await chrome.storage.local.set({ origin });
      return { kind: "saved" };
    });
  };

  disconnect = async (): Promise<Response> => {
    await this.changeSession(async () => {
      await this.sessionAccess;
      this.resetSessionLifetime();
      await chrome.storage.session.remove("connection");
    });
    return { kind: "saved" };
  };
}
