import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { Duplex } from "node:stream";
import { TLSSocket, type SecureContext } from "node:tls";
import {
  encodePairing,
  endpoint,
  maxRequestBytes,
  requestEnvelope,
  vaultScope,
  type Request,
  type Response,
} from "@book-props/vault-contract";
import { WebSocketServer, createWebSocketStream, type WebSocket } from "ws";
import { startTls } from "./tls-identity.ts";

export const extensionIdPattern = /^[a-p]{32}$/;
const sessionMs = 4 * 60 * 60 * 1000;
const codeMs = 5 * 60 * 1000;
export type Credentials = { value: string; expiresAt: number };
type Authorized = Exclude<Request, { action: "pair" | "status" }>;

/**
 * 購入結果の再確認先を接続時の書籍範囲に限定するための識別子
 * @param vaultPath - Vaultの絶対パス
 * @param folder - Vaultからの正規化済み書籍フォルダ
 * @returns パス自体を送らずに書籍範囲を比較できるSHA-256
 */
export function scopeOf(vaultPath: string, folder: string): string {
  return createHash("sha256")
    .update(JSON.stringify([vaultPath, folder]))
    .digest("hex");
}

function matches(secret: Credentials | undefined, supplied: string | undefined): boolean {
  if (!secret || Date.now() >= secret.expiresAt || !supplied) return false;
  const a = Buffer.from(secret.value);
  const b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}

function decode(body: Buffer) {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(body);
    return requestEnvelope.safeParse(JSON.parse(text));
  } catch {
    return undefined;
  }
}

export class Connection {
  private code?: Credentials;
  private session?: Credentials;
  private sessionLifetime = new AbortController();
  private readonly listener: Server;
  private readonly sockets = new WebSocketServer({
    noServer: true,
    maxPayload: 64 * 1024,
    perMessageDeflate: false,
  });
  private port = 0;

  private constructor(
    private readonly host: string,
    private readonly extensionOrigin: string,
    private readonly scope: string,
    private readonly anchor: string,
    private readonly context: SecureContext,
    private readonly dispatch: (input: Authorized, signal: AbortSignal) => Promise<Response>,
  ) {
    this.listener = createServer({ maxHeaderSize: 4096 }, (_request, response) => {
      response.writeHead(404, { Connection: "close" }).end();
    });
    this.listener.maxConnections = 32;
    this.listener.setTimeout(15_000, (socket) => socket.destroy());
    this.listener.on("upgrade", this.upgrade);
  }

  static async start(
    host: string,
    extensionId: string,
    port: number,
    scope: string,
    dispatch: (input: Authorized, signal: AbortSignal) => Promise<Response>,
  ): Promise<Connection> {
    if (
      !extensionIdPattern.test(extensionId) ||
      !Number.isSafeInteger(port) ||
      port < 0 ||
      port > 65535 ||
      !vaultScope.safeParse(scope).success
    )
      throw new Error("接続設定が不正です。");
    const { anchor, context } = await startTls(host);
    const connection = new Connection(
      host,
      `chrome-extension://${extensionId}`,
      scope,
      anchor,
      context,
      dispatch,
    );
    const ready = Promise.withResolvers<void>();
    connection.listener.once("error", ready.reject);
    connection.listener.listen(port, "127.0.0.1", ready.resolve);
    await ready.promise;
    connection.listener.removeListener("error", ready.reject);
    connection.listener.on("error", () => connection.stop());
    const address = connection.listener.address();
    if (!address || typeof address === "string") {
      connection.stop();
      throw new Error("接続先を確定できません。");
    }
    connection.port = address.port;
    return connection;
  }

  get address(): string {
    return `https://${this.host}:${this.port}`;
  }
  get listeningPort(): number {
    return this.port;
  }

  issueCode(): Credentials {
    const code = randomBytes(16).toString("base64url");
    const expiresAt = Date.now() + codeMs;
    this.code = { value: code, expiresAt };
    return { value: encodePairing({ origin: this.address, anchor: this.anchor, code }), expiresAt };
  }

  revoke(): void {
    this.code = this.session = undefined;
    this.resetSessionLifetime();
    for (const socket of this.sockets.clients) socket.terminate();
  }

  stop(): void {
    this.revoke();
    this.listener.close();
    this.listener.closeAllConnections();
    this.sockets.close();
  }

  private resetSessionLifetime(): void {
    this.sessionLifetime.abort();
    this.sessionLifetime = new AbortController();
  }

  private readonly upgrade = (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
    if (
      req.socket.remoteAddress !== "127.0.0.1" ||
      req.headers.host !== `${this.host}:${this.port}` ||
      req.headers.origin !== this.extensionOrigin ||
      req.url !== endpoint ||
      this.sockets.clients.size >= 16
    ) {
      socket.destroy();
      return;
    }
    this.sockets.handleUpgrade(req, socket, head, (client) => this.open(client));
  };

  private open(client: WebSocket): void {
    const transport = createWebSocketStream(client);
    const tls = new TLSSocket(transport, { isServer: true, secureContext: this.context });
    const disconnected = new AbortController();
    const timer = setTimeout(() => client.terminate(), 12_000);
    client.once("close", () => {
      clearTimeout(timer);
      disconnected.abort();
      tls.destroy();
    });
    tls.on("error", () => client.terminate());
    transport.on("error", () => client.terminate());
    let length = 0;
    const chunks: Buffer[] = [];
    const onData = (chunk: Buffer) => {
      length += chunk.length;
      const end = chunk.indexOf(10);
      if (length > maxRequestBytes || (end >= 0 && end !== chunk.length - 1)) {
        client.terminate();
        return;
      }
      if (end < 0) {
        chunks.push(chunk);
        return;
      }
      tls.removeListener("data", onData);
      tls.resume();
      let body = chunk;
      if (chunks.length) {
        chunks.push(chunk);
        body = Buffer.concat(chunks, length);
      }
      chunks.length = 0;
      const reply = (outcome: Response) => {
        if (!tls.destroyed) tls.write(`${JSON.stringify(outcome)}\n`);
      };
      void this.receive(body, disconnected.signal).then(reply, () =>
        reply({ kind: "unavailable" }),
      );
    };
    tls.on("data", onData);
  }

  private async receive(body: Buffer, disconnected: AbortSignal): Promise<Response> {
    const parsed = decode(body);
    if (!parsed?.success) return { kind: "invalidRequest" };
    const { request, token } = parsed.data;
    if (request.action === "pair") {
      if (!matches(this.code, request.code)) return { kind: "unauthorized" };
      this.code = undefined;
      this.resetSessionLifetime();
      const expiresAt = Date.now() + sessionMs;
      const value = randomBytes(32).toString("base64url");
      this.session = { value, expiresAt };
      return { kind: "paired", token: value, expiresAt, scope: this.scope };
    }
    if (!matches(this.session, token)) return { kind: "unauthorized" };
    if (request.action === "status") return { kind: "connected" };
    const deadline = AbortSignal.any([
      disconnected,
      this.sessionLifetime.signal,
      AbortSignal.timeout(10_000),
    ]);
    return this.dispatch(request, deadline);
  }
}
