import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type Server } from "node:https";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  endpoint,
  request,
  vaultScope,
  type Request,
  type Response,
} from "@book-props/vault-contract";
import { openIdentity, type Identity } from "./tls-identity.ts";

export const extensionIdPattern = /^[a-p]{32}$/;
const maxBody = 24 * 1024;
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

function send(res: ServerResponse, status: number, reply: Response): void {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(reply));
}

async function decode(req: IncomingMessage): Promise<Request | undefined> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    if (!Buffer.isBuffer(chunk)) return undefined;
    size += chunk.length;
    if (size > maxBody) return undefined;
    chunks.push(chunk);
  }
  try {
    const body = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, size));
    const parsed = request.safeParse(JSON.parse(body));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export class Connection {
  private code?: Credentials;
  private session?: Credentials;
  private accepting = true;
  private readonly listener: Server;
  private port = 0;

  private constructor(
    private readonly identity: Identity,
    private readonly origin: string,
    private readonly scope: string,
    readonly fingerprint: string,
    tls: { key: Buffer; cert: string },
    private readonly dispatch: (input: Authorized, signal: AbortSignal) => Promise<Response>,
  ) {
    this.listener = createServer(
      {
        ...tls,
        minVersion: "TLSv1.3",
        maxHeaderSize: 4096,
        requestTimeout: 12_000,
        headersTimeout: 4_000,
        keepAliveTimeout: 1_000,
      },
      (req, res) => {
        void this.receive(req, res).catch(() => send(res, 500, { kind: "unavailable" }));
      },
    );
    this.listener.maxConnections = 32;
  }

  static async start(
    identity: Identity,
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
    const tls = await openIdentity(identity);
    let connection: Connection;
    try {
      connection = new Connection(
        identity,
        `chrome-extension://${extensionId}`,
        scope,
        tls.fingerprint,
        { key: tls.key, cert: tls.cert },
        dispatch,
      );
    } finally {
      tls.key.fill(0);
    }
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
    return `https://${this.identity.name}:${this.port}`;
  }
  get listeningPort(): number {
    return this.port;
  }

  issueCode(): Credentials {
    this.code = { value: randomBytes(16).toString("base64url"), expiresAt: Date.now() + codeMs };
    return this.code;
  }

  revoke(): void {
    this.code = this.session = undefined;
  }

  stop(): void {
    this.accepting = false;
    this.revoke();
    this.listener.close();
    this.listener.closeIdleConnections();
  }

  private async receive(req: IncomingMessage, res: ServerResponse): Promise<void> {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Vary", "Origin");
    if (
      !this.accepting ||
      req.socket.remoteAddress !== "127.0.0.1" ||
      req.headers.host !== `${this.identity.name}:${this.port}` ||
      req.headers.origin !== this.origin
    ) {
      send(res, 403, { kind: "unauthorized" });
      return;
    }
    res.setHeader("Access-Control-Allow-Origin", this.origin);
    if (req.url !== endpoint) {
      send(res, 404, { kind: "invalidRequest" });
      return;
    }
    if (req.method === "OPTIONS" && req.headers["access-control-request-method"] === "POST") {
      res.writeHead(204, {
        "Access-Control-Allow-Methods": "POST",
        "Access-Control-Allow-Headers": "content-type, authorization",
      });
      res.end();
      return;
    }
    const length = req.headers["content-length"];
    if (
      req.method !== "POST" ||
      req.headers["content-type"] !== "application/json" ||
      !length ||
      !/^[1-9][0-9]*$/.test(length) ||
      Number(length) > maxBody
    ) {
      send(res, 400, { kind: "invalidRequest" });
      return;
    }
    const input = await decode(req);
    if (!input) {
      send(res, 400, { kind: "invalidRequest" });
      return;
    }
    if (input.action === "pair") {
      if (!matches(this.code, input.code)) {
        send(res, 401, { kind: "unauthorized" });
        return;
      }
      this.code = undefined;
      const expiresAt = Date.now() + sessionMs;
      const token = randomBytes(32).toString("base64url");
      this.session = { value: token, expiresAt };
      send(res, 200, { kind: "paired", token, expiresAt, scope: this.scope });
      return;
    }
    const token = req.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
    if (!matches(this.session, token)) {
      send(res, 401, { kind: "unauthorized" });
      return;
    }
    // Lets the extension confirm its session without reaching the Vault.
    if (input.action === "status") {
      send(res, 200, { kind: "connected" });
      return;
    }
    const disconnected = new AbortController();
    res.once("close", () => disconnected.abort());
    const deadline = AbortSignal.any([disconnected.signal, AbortSignal.timeout(10_000)]);
    send(res, 200, await this.dispatch(input, deadline));
  }
}
