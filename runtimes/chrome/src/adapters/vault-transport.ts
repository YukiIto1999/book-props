import {
  connectionOrigin,
  endpoint,
  maxReplyBytes,
  maxRequestBytes,
  response,
  type Response,
} from "@book-props/vault-contract";
import type { Exchange, VaultPeer } from "../extension/vault-session.ts";
import initialize, { VaultTrust } from "../../dist/tls/vault_tls.js";

const encoder = new TextEncoder();
const maxCarrierFrame = 64 * 1024;
const replyTimeoutMs = 12_000;
let wasm: ReturnType<typeof initialize> | undefined;
let trust: (VaultPeer & { client: VaultTrust }) | undefined;

function trustPeer(peer: VaultPeer, hostname: string): VaultTrust {
  if (trust?.origin === peer.origin && trust.anchor === peer.anchor) return trust.client;
  const client = new VaultTrust(
    Uint8Array.from(atob(peer.anchor), (c) => c.charCodeAt(0)),
    hostname,
  );
  trust?.client.free();
  trust = { origin: peer.origin, anchor: peer.anchor, client };
  return client;
}

function requestOverTls(
  socket: WebSocket,
  tls: ReturnType<VaultTrust["connect"]>,
  plaintext: Uint8Array,
  signal: AbortSignal,
  cancelled?: AbortSignal,
): Promise<Response | undefined> {
  const pending = Promise.withResolvers<Response | undefined>();
  const unavailable = () => pending.resolve(undefined);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let text = "";
  let length = 0;
  let sent = false;
  const flush = () => {
    const output = tls.drain();
    if (output.length && output.buffer instanceof ArrayBuffer)
      socket.send(new Uint8Array(output.buffer, output.byteOffset, output.byteLength));
  };
  socket.addEventListener(
    "open",
    () => {
      try {
        flush();
      } catch {
        unavailable();
      }
    },
    { signal },
  );
  socket.addEventListener(
    "message",
    (event: MessageEvent<unknown>) => {
      try {
        const frame = event.data;
        if (!(frame instanceof ArrayBuffer) || frame.byteLength > maxCarrierFrame)
          return unavailable();
        const content = tls.receive(new Uint8Array(frame));
        if (!sent && tls.ready()) {
          tls.send(plaintext);
          plaintext.fill(0);
          sent = true;
        }
        flush();
        if (!content.length) return;
        length += content.length;
        if (length > maxReplyBytes) return unavailable();
        const end = content.indexOf(10);
        if (end < 0) text += decoder.decode(content, { stream: true });
        else if (end === content.length - 1 && sent) {
          text += decoder.decode(content);
          const parsed = response.safeParse(JSON.parse(text));
          pending.resolve(parsed.success ? parsed.data : undefined);
        } else unavailable();
      } catch {
        unavailable();
      }
    },
    { signal },
  );
  socket.addEventListener("close", unavailable, { once: true, signal });
  cancelled?.addEventListener("abort", unavailable, { signal });
  socket.addEventListener("error", unavailable, { once: true, signal });
  const timeout = setTimeout(unavailable, replyTimeoutMs);
  return pending.promise.finally(() => clearTimeout(timeout));
}

export const exchange: Exchange = async (peer, request, token, signal) => {
  const origin = connectionOrigin(peer.origin);
  if (!origin) return undefined;
  const { host, hostname } = new URL(origin);
  await (wasm ??= initialize({ module_or_path: chrome.runtime.getURL("vault_tls_bg.wasm") }));
  signal?.throwIfAborted();
  const plaintext = encoder.encode(`${JSON.stringify({ request, token })}\n`);
  const events = new AbortController();
  let socket: WebSocket | undefined;
  let channel: ReturnType<VaultTrust["connect"]> | undefined;
  try {
    if (plaintext.byteLength > maxRequestBytes) return { kind: "invalidRequest" };
    // Chrome lists every WebSocket that cannot connect among the extension's errors, though not a fetch that
    // cannot. Asking whether anything listens first keeps a closed Obsidian from adding an error for every page
    // checked meanwhile; the request carries nothing, and the plugin answers it with 404.
    const listening = await fetch(`http://${host}${endpoint}`, {
      mode: "no-cors",
      cache: "no-store",
      credentials: "omit",
      signal: AbortSignal.any([AbortSignal.timeout(replyTimeoutMs), ...(signal ? [signal] : [])]),
    }).catch(() => undefined);
    if (!listening) return undefined;
    channel = trustPeer(peer, hostname).connect();
    socket = new WebSocket(`ws://${host}${endpoint}`);
    socket.binaryType = "arraybuffer";
    return await requestOverTls(socket, channel, plaintext, events.signal, signal);
  } finally {
    events.abort();
    socket?.close();
    plaintext.fill(0);
    channel?.free();
  }
};
