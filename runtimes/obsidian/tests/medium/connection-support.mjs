import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { connect as openTls } from "node:tls";
import {
  connectionFile,
  decodeConnectionCard,
  endpoint,
  pairingChallenge,
  pairingProofFile,
  response,
} from "@book-props/vault-contract";
import { createWebSocketStream, WebSocket } from "ws";

const origin = `chrome-extension://${"abcdefghijklmnop".repeat(2)}`;

export async function post(connection, anchor, input, options = {}) {
  const target = new URL(connection.address);
  const ws = new WebSocket(`ws://127.0.0.1:${connection.listeningPort}${endpoint}`, {
    origin: options.origin ?? origin,
    headers: { Host: target.host },
    handshakeTimeout: 3000,
  });
  const transport = createWebSocketStream(ws);
  try {
    return await new Promise((resolve, reject) => {
      const tls = openTls({
        socket: transport,
        ca:
          options.trust === false
            ? undefined
            : `-----BEGIN CERTIFICATE-----\n${anchor}\n-----END CERTIFICATE-----`,
        servername: options.servername ?? target.hostname,
        minVersion: "TLSv1.3",
        signal: AbortSignal.timeout(5000),
      });
      const protocol = () => tls.getProtocol();
      tls.once("error", reject);
      transport.once("error", reject);
      tls.once("secureConnect", () => {
        tls.write(`${JSON.stringify({ request: input, token: options.token })}\n`);
      });
      let reply = "";
      tls.setEncoding("utf8");
      tls.on("data", (part) => {
        reply += part;
        if (!reply.endsWith("\n")) return;
        try {
          resolve({ payload: response.parse(JSON.parse(reply)), protocol: protocol() });
        } catch (error) {
          reject(error);
        }
      });
      tls.once("end", () => reject(new Error("TLS response was closed")));
    });
  } finally {
    ws.terminate();
  }
}

export async function readCard(grant) {
  const card = decodeConnectionCard(await readFile(join(grant.directory, connectionFile), "utf8"));
  assert(card);
  return card;
}

export async function prove(grant, anchor, code) {
  const proof = createHash("sha256").update(pairingChallenge(anchor, code)).digest("hex");
  await writeFile(join(grant.directory, pairingProofFile), proof);
}
