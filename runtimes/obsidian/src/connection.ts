import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { Duplex } from "node:stream";
import { TLSSocket, type SecureContext } from "node:tls";
import {
  endpoint,
  maxRequestBytes,
  pairingChallenge,
  requestEnvelope,
  vaultScope,
  type Request,
  type Response,
} from "@book-props/vault-contract";
import { WebSocketServer, createWebSocketStream, type WebSocket } from "ws";
import type { ConnectionGrant } from "./connection-grant.ts";
import { startTls } from "./tls-identity.ts";

// ペアリングまでどの拡張かは決めず、接続用フォルダで証明した拡張のOriginにセッションを結び付ける
const extensionOrigin = /^chrome-extension:\/\/[a-p]{32}$/;
const sessionMs = 4 * 60 * 60 * 1000;
type Credentials = { value: string; expiresAt: number; origin: string };
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

function matches(
  secret: Credentials | undefined,
  supplied: string | undefined,
  origin: string,
): boolean {
  if (!secret || Date.now() >= secret.expiresAt || !supplied || secret.origin !== origin)
    return false;
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
  private pairing = false;
  private stopped = false;
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
    private readonly scope: string,
    private readonly anchor: string,
    private readonly context: SecureContext,
    readonly grant: ConnectionGrant,
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
    port: number,
    scope: string,
    grant: ConnectionGrant,
    dispatch: (input: Authorized, signal: AbortSignal) => Promise<Response>,
  ): Promise<Connection> {
    if (
      !Number.isSafeInteger(port) ||
      port < 0 ||
      port > 65535 ||
      !vaultScope.safeParse(scope).success
    )
      throw new Error("接続設定が不正です。");
    const { anchor, context } = await startTls(host);
    const connection = new Connection(host, scope, anchor, context, grant, dispatch);
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
    try {
      await grant.publish({ origin: connection.address, scope, anchor });
    } catch (error) {
      connection.stop();
      throw error;
    }
    return connection;
  }

  get address(): string {
    return `https://${this.host}:${this.port}`;
  }
  get listeningPort(): number {
    return this.port;
  }

  private async pair(code: string, disconnected: AbortSignal, origin: string): Promise<Response> {
    if (this.stopped || this.pairing) return { kind: "unauthorized" };
    this.pairing = true;
    try {
      const proof = createHash("sha256").update(pairingChallenge(this.anchor, code)).digest("hex");
      if (!(await this.grant.consume(proof)) || this.stopped || disconnected.aborted)
        return { kind: "unauthorized" };
      return this.issueSession(origin);
    } finally {
      this.pairing = false;
    }
  }

  private issueSession(origin: string): Response {
    this.resetSessionLifetime();
    const expiresAt = Date.now() + sessionMs;
    const value = randomBytes(32).toString("base64url");
    this.session = { value, expiresAt, origin };
    return { kind: "paired", token: value, expiresAt, scope: this.scope };
  }

  stop(): void {
    this.stopped = true;
    this.session = undefined;
    this.sessionLifetime.abort();
    for (const socket of this.sockets.clients) socket.terminate();
    this.listener.close();
    this.listener.closeAllConnections();
    this.sockets.close();
  }

  private resetSessionLifetime(): void {
    this.sessionLifetime.abort();
    this.sessionLifetime = new AbortController();
  }

  private readonly upgrade = (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
    const { origin } = req.headers;
    if (
      req.socket.remoteAddress !== "127.0.0.1" ||
      req.headers.host !== `${this.host}:${this.port}` ||
      !origin ||
      !extensionOrigin.test(origin) ||
      req.url !== endpoint ||
      this.sockets.clients.size >= 16
    ) {
      socket.destroy();
      return;
    }
    this.sockets.handleUpgrade(req, socket, head, (client) => this.open(client, origin));
  };

  private open(client: WebSocket, origin: string): void {
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
      void this.receive(body, disconnected.signal, origin).then(reply, () =>
        reply({ kind: "unavailable" }),
      );
    };
    tls.on("data", onData);
  }

  private async receive(
    body: Buffer,
    disconnected: AbortSignal,
    origin: string,
  ): Promise<Response> {
    const parsed = decode(body);
    if (!parsed?.success) return { kind: "invalidRequest" };
    const { request, token } = parsed.data;
    if (request.action === "pair") return this.pair(request.code, disconnected, origin);
    if (!matches(this.session, token, origin)) return { kind: "unauthorized" };
    if (request.action === "status") return { kind: "connected" };
    const deadline = AbortSignal.any([
      disconnected,
      this.sessionLifetime.signal,
      AbortSignal.timeout(10_000),
    ]);
    return this.dispatch(request, deadline);
  }
}
