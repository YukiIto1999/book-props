import type { ConnectionCard, Request, Response } from "@book-props/vault-contract";
import { unavailable, unknownOutcome, type ConnectionStatus } from "./outcomes.ts";

/** Where the plugin listens and the certificate anchor it must present. */
export type VaultPeer = { origin: string; anchor: string };
/** Sends one request to the plugin; undefined when no valid reply arrived. */
export type Exchange = (
  peer: VaultPeer,
  request: Request,
  token?: string,
  signal?: AbortSignal,
) => Promise<Response | undefined>;
/** The session credential the plugin issued for one Vault and book folder. */
export type Connection = VaultPeer & { token: string; expiresAt: number; scope: string };
export type LiveConnection = Connection & { signal: AbortSignal };
/** Keeps the session credential for the browser session only. */
export type SessionStore = {
  read(): Promise<Connection | undefined>;
  write(connection: Connection): Promise<void>;
  /** Drops the credential only while it is still `token`, and tells whether it did. */
  forget(token: string): Promise<boolean>;
  clear(): Promise<void>;
};
type Binding = Pick<ConnectionCard, "origin" | "scope" | "grantId">;
/** The connection folder the user chose, bound to the card it held when chosen. */
export type Grant = {
  binding: Binding;
  read(): Promise<ConnectionCard | undefined>;
  prove(anchor: string): Promise<string>;
};
export type Grants = {
  read(): Promise<Grant | undefined>;
  selected(id: string): Promise<Grant | undefined>;
  commit(id: string): Promise<boolean>;
  forget(): Promise<void>;
};

/** Pairs with the plugin through the connection folder and keeps one session credential alive. */
export class VaultSession {
  private readonly exchange: Exchange;
  private readonly grants: Grants;
  private readonly store: SessionStore;
  private changes: Promise<unknown> = Promise.resolve();
  // Aborted whenever the credential is replaced or dropped, so requests made with it stop.
  private lifetime = new AbortController();

  constructor(exchange: Exchange, grants: Grants, store: SessionStore) {
    this.exchange = exchange;
    this.grants = grants;
    this.store = store;
  }

  private change<T>(work: () => Promise<T>): Promise<T> {
    const next = this.changes.then(work);
    this.changes = next.catch(() => undefined);
    return next;
  }

  private resetLifetime(): void {
    this.lifetime.abort();
    this.lifetime = new AbortController();
  }

  /** The usable credential for the paired folder, pairing again when it expired or changed. */
  current(): Promise<LiveConnection | undefined> {
    return this.change(async () => {
      const grant = await this.grants.read();
      const card = await grant?.read();
      if (!grant || !card) return undefined;
      const stored = await this.store.read();
      if (
        stored &&
        stored.origin === card.origin &&
        stored.anchor === card.anchor &&
        stored.scope === card.scope &&
        stored.expiresAt > Date.now()
      )
        return { ...stored, signal: this.lifetime.signal };
      const paired = await this.authenticate(grant, card);
      if (paired.kind !== "paired") return undefined;
      return this.save(card, paired);
    });
  }

  private async authenticate(grant: Grant, peer: VaultPeer): Promise<Response> {
    const code = await grant.prove(peer.anchor).catch(() => undefined);
    if (!code) return unavailable;
    const reply = await this.call(peer, { action: "pair", code });
    return reply.kind === "paired" && reply.scope !== grant.binding.scope
      ? { kind: "unauthorized" }
      : reply;
  }

  private async save(
    peer: VaultPeer,
    { scope, token, expiresAt }: Extract<Response, { kind: "paired" }>,
  ): Promise<LiveConnection> {
    this.resetLifetime();
    const connection: Connection = {
      origin: peer.origin,
      anchor: peer.anchor,
      scope,
      token,
      expiresAt,
    };
    await this.store.write(connection);
    return { ...connection, signal: this.lifetime.signal };
  }

  private async call(
    peer: VaultPeer,
    request: Request,
    token?: string,
    signal?: AbortSignal,
  ): Promise<Response> {
    const failure = request.action === "purchase" ? unknownOutcome : unavailable;
    try {
      return (await this.exchange(peer, request, token, signal)) ?? failure;
    } catch {
      return failure;
    }
  }

  /** Sends with the credential, and drops it once the plugin rejects it. */
  async authorized(current: LiveConnection, request: Request): Promise<Response> {
    if (current.signal.aborted || current.expiresAt <= Date.now()) return { kind: "unauthorized" };
    const reply = await this.call(current, request, current.token, current.signal);
    if (reply.kind === "unauthorized") {
      await this.change(async () => {
        if (await this.store.forget(current.token)) this.resetLifetime();
      });
    }
    return reply;
  }

  async status(): Promise<ConnectionStatus> {
    const configured = (await this.grants.read())?.binding.origin;
    const current = await this.current();
    if (!current) return { configured, state: configured ? "unknown" : "unpaired" };
    const reply = await this.authorized(current, { action: "status" });
    if (reply.kind === "connected") return { configured, state: "paired" };
    return { configured, state: reply.kind === "unauthorized" ? "unpaired" : "unknown" };
  }

  /** Pairs with the folder the user just selected, replacing the previous pairing only on success. */
  pair(id: string): Promise<Response> {
    return this.change(async (): Promise<Response> => {
      const grant = await this.grants.selected(id);
      const card = await grant?.read();
      if (!grant || !card) return { kind: "invalidRequest" };
      const reply = await this.authenticate(grant, card);
      if (reply.kind !== "paired") return reply;
      if (!(await this.grants.commit(id))) return unavailable;
      await this.save(card, reply);
      return { kind: "saved" };
    });
  }

  async disconnect(): Promise<Response> {
    await this.change(async () => {
      this.resetLifetime();
      await this.grants.forget();
      await this.store.clear();
    });
    return { kind: "saved" };
  }
}
