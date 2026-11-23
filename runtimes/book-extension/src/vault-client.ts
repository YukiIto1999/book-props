import {
  connectionOrigin,
  endpoint,
  request,
  response,
  vaultScope,
  type Product,
  type Request,
  type Response,
} from "@book-props/vault-contract";
import { messageField, type ConnectionStatus, type Reply } from "./messages.ts";

type Connection = { origin: string; token: string; expiresAt: number; scope: string };
type Purchase = Extract<Request, { action: "purchase" }>;
// Records written before purchases were tied to a book folder have no scope.
type Pending = { origin: string; scope?: string; operation: Purchase };
export type BookChange = "purchase" | "setWish" | "clearWish";

const unknownOutcome = { kind: "unknown" } as const;
export const unavailable = { kind: "unavailable" } as const;
const pairingCode = /^[A-Za-z0-9_-]{22}$/;
const sessionAccess = chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
const localAccess = chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
let changingPendingPurchase = false;
let sessionChanges: Promise<unknown> = Promise.resolve();

function hostPermission(origin: string): string {
  return `https://${new URL(origin).hostname}/*`;
}

function decodeConnection(stored: unknown): Connection | undefined {
  const origin = messageField(stored, "origin");
  const token = messageField(stored, "token");
  const expiresAt = messageField(stored, "expiresAt");
  const scope = vaultScope.safeParse(messageField(stored, "scope"));
  if (typeof origin !== "string" || typeof token !== "string" || typeof expiresAt !== "number")
    return undefined;
  return connectionOrigin(origin) && scope.success
    ? { origin, token, expiresAt, scope: scope.data }
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

/** Runs session writes one at a time so a late rejection cannot remove a newer pairing. */
function changeSession(work: () => Promise<void>): Promise<void> {
  const next = sessionChanges.then(work);
  sessionChanges = next.catch(() => undefined);
  return next;
}

function forgetSession(token: string): Promise<void> {
  return changeSession(async () => {
    await sessionAccess;
    const { connection: stored } = await chrome.storage.session.get("connection");
    if (messageField(stored, "token") === token) await chrome.storage.session.remove("connection");
  });
}

async function session(): Promise<Connection | undefined> {
  await sessionAccess;
  const { connection: stored } = await chrome.storage.session.get("connection");
  const connection = decodeConnection(stored);
  return connection && connection.expiresAt > Date.now() ? connection : undefined;
}

async function call(origin: string, vaultRequest: Request, token?: string): Promise<Response> {
  if (
    !connectionOrigin(origin) ||
    !(await chrome.permissions.contains({ origins: [hostPermission(origin)] }))
  )
    return { kind: "unauthorized" };
  const failure = vaultRequest.action === "purchase" ? unknownOutcome : unavailable;
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    const reply = await fetch(origin + endpoint, {
      method: "POST",
      redirect: "error",
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      headers,
      body: JSON.stringify(vaultRequest),
      signal: AbortSignal.timeout(12_000),
    });
    const parsed = response.safeParse(await reply.json());
    return parsed.success ? parsed.data : failure;
  } catch {
    return failure;
  }
}

/** Sends with the session's token; a rejected token means the pairing is gone, so it is dropped. */
async function authorized(current: Connection, vaultRequest: Request): Promise<Response> {
  const reply = await call(current.origin, vaultRequest, current.token);
  if (reply.kind === "unauthorized") await forgetSession(current.token);
  return reply;
}

export async function send(vaultRequest: Exclude<Request, { action: "pair" }>): Promise<Response> {
  const current = await session();
  if (!current) return { kind: "unauthorized" };
  return authorized(current, vaultRequest);
}

async function withPendingPurchase<T extends Reply>(
  work: () => Promise<T>,
): Promise<T | typeof unknownOutcome> {
  if (changingPendingPurchase) return unknownOutcome;
  changingPendingPurchase = true;
  try {
    return await work();
  } finally {
    changingPendingPurchase = false;
  }
}

function purchase(book: Product): Promise<Response> {
  return withPendingPurchase(async () => {
    await localAccess;
    const stored = await chrome.storage.local.get(["pending", "clientId"]);
    if (stored.pending) return unknownOutcome;
    const current = await session();
    if (!current) return { kind: "unauthorized" };
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
    const outcome = await authorized(current, operation);
    if (outcome.kind !== "unknown" && outcome.kind !== "unavailable")
      await chrome.storage.local.remove("pending");
    return outcome;
  });
}

export async function changeBook(kind: BookChange, book: Product): Promise<Response> {
  const outcome =
    kind === "purchase" ? await purchase(book) : await send({ action: kind, product: book });
  if (outcome.kind === "needsInput") await send({ action: "open", product: book, intent: kind });
  return outcome;
}

async function storedPending(): Promise<unknown> {
  await localAccess;
  const { pending } = await chrome.storage.local.get("pending");
  return pending;
}

export async function hasPending(): Promise<boolean> {
  return Boolean(await storedPending());
}

export function forgetPending(): Promise<Reply> {
  return withPendingPurchase(async () => {
    if (!(await storedPending())) return { kind: "notSaved" };
    await chrome.storage.local.remove("pending");
    return { kind: "forgotten" };
  });
}

export function reconcilePending(): Promise<Reply> {
  return withPendingPurchase(async () => {
    const stored = await storedPending();
    if (!stored) return { kind: "notSaved" };
    // Without its book folder, a record stays pending until the user checks the Vault.
    const pending = decodePending(stored);
    if (!pending?.scope) return { kind: "manualCheck" };
    const current = await session();
    if (!current) return { kind: "unauthorized" };
    if (current.origin !== pending.origin || current.scope !== pending.scope)
      return { kind: "scopeMismatch" };
    const outcome = await authorized(current, { ...pending.operation, action: "reconcile" });
    if (outcome.kind === "replayed") await chrome.storage.local.remove("pending");
    return outcome;
  });
}

async function savedOrigin(): Promise<string | undefined> {
  await localAccess;
  const { origin } = await chrome.storage.local.get("origin");
  return typeof origin === "string" ? origin : undefined;
}

/** Asks the plugin whether the session still works, so a revoked pairing is not shown as paired. */
export async function connectionStatus(): Promise<ConnectionStatus> {
  const configured = await savedOrigin();
  const current = await session();
  if (!current) return { configured, state: "unpaired" };
  const reply = await authorized(current, { action: "status" });
  if (reply.kind === "connected") return { configured, state: "paired" };
  return { configured, state: reply.kind === "unauthorized" ? "unpaired" : "unknown" };
}

export async function pair(origin: unknown, code: unknown): Promise<Response> {
  if (typeof origin !== "string" || typeof code !== "string" || !pairingCode.test(code))
    return unavailable;
  const reply = await call(origin, { action: "pair", code });
  if (reply.kind !== "paired") return reply;
  const { token, expiresAt, scope } = reply;
  await changeSession(async () => {
    await sessionAccess;
    await chrome.storage.session.set({
      connection: { origin, token, expiresAt, scope } satisfies Connection,
    });
  });
  await chrome.storage.local.set({ origin });
  return { kind: "saved" };
}

export async function disconnect(): Promise<Response> {
  const origin = await savedOrigin();
  await changeSession(() => chrome.storage.session.remove("connection"));
  if (origin && connectionOrigin(origin))
    await chrome.permissions.remove({ origins: [hostPermission(origin)] });
  return { kind: "saved" };
}
