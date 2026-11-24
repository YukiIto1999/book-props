import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { connect as openTls } from "node:tls";
import { join } from "node:path";
import test from "node:test";
import { decodePairing, endpoint, response } from "@book-props/vault-contract";
import { createWebSocketStream, WebSocket } from "ws";
import { Catalog } from "../../src/catalog.ts";
import { Connection, scopeOf } from "../../src/connection.ts";
import { LocalMoveCopies } from "../../src/local-move-copies.ts";
import { createHost } from "../../src/tls-identity.ts";
import { evaluate, initSync } from "../../dist/wasm/book_props_vault.js";

const product = {
  title: "Design Handbook",
  authors: ["Example Author"],
  isbns: ["9780306406157"],
  label: "First",
};
const extension = "abcdefghijklmnopabcdefghijklmnop";
const origin = `chrome-extension://${extension}`;
initSync({
  module: await readFile(new URL("../../dist/wasm/book_props_vault_bg.wasm", import.meta.url)),
});

async function post(connection, anchor, input, options = {}) {
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

function bookFiles(folder) {
  return {
    moveCopies: new LocalMoveCopies(() => join(folder, "edition-moves")),
    versions: () => new Map(),
    read: (path) => readFile(path, "utf8"),
    create: async (id, markdown) => {
      const path = join(folder, `${id}.md`);
      await writeFile(path, markdown, { flag: "wx" });
      return path;
    },
    canUpdate: () => true,
  };
}

await test("each Vault book folder keeps its own stable opaque scope", async () => {
  const vault = join(tmpdir(), "Reading Vault");
  const scope = scopeOf(vault, "Books");
  assert.match(scope, /^[0-9a-f]{64}$/);
  assert.equal(scopeOf(vault, "Books"), scope);
  assert.notEqual(scopeOf(vault, "Books/Archive"), scope);
  assert.notEqual(scopeOf(join(tmpdir(), "Other Vault"), "Books"), scope);
  await assert.rejects(
    Connection.start(createHost(), extension, 0, "Books", async () => ({ kind: "unavailable" })),
    { message: "接続設定が不正です。" },
  );
});

await test("only the paired extension can save a purchase through a trusted TLS endpoint", async (context) => {
  const folder = await mkdtemp(join(tmpdir(), "shelf-"));
  context.after(async () => await rm(folder, { recursive: true, force: true }));
  const files = bookFiles(folder);
  const catalog = new Catalog(files, evaluate);
  // Only purchases reach the Vault; any other request arriving here fails the test.
  const dispatch = async (input, signal) => {
    assert.equal(input.action, "purchase");
    const receipt = await catalog.execute(input, signal);
    assert.equal(receipt.kind, "saved");
    return { kind: "saved" };
  };
  const scope = scopeOf(folder, "Books");
  const connection = await Connection.start(createHost(), extension, 0, scope, dispatch);
  context.after(() => connection.stop());
  const { code, anchor } = decodePairing(connection.issueCode().value);
  const pair = { action: "pair", code };
  const purchase = {
    action: "purchase",
    product,
    purchase: {
      clientId: crypto.randomUUID(),
      requestId: crypto.randomUUID(),
      issuedAt: Date.now(),
    },
  };
  await assert.rejects(post(connection, anchor, pair, { trust: false }), {
    code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  });
  await assert.rejects(post(connection, anchor, pair, { servername: "elsewhere.localhost" }), {
    code: "ERR_TLS_CERT_ALTNAME_INVALID",
  });
  await assert.rejects(post(connection, anchor, pair, { origin: "https://elsewhere.test" }));
  const unauthorized = { token: "F".repeat(43) };
  assert.equal(
    (await post(connection, anchor, purchase, unauthorized)).payload.kind,
    "unauthorized",
  );
  assert.equal(
    (await post(connection, anchor, { action: "status" }, unauthorized)).payload.kind,
    "unauthorized",
  );
  const paired = await post(connection, anchor, pair);
  assert.equal(paired.protocol, "TLSv1.3");
  assert.equal(paired.payload.kind, "paired");
  assert.equal(paired.payload.scope, scope);
  assert.deepEqual(Object.keys(paired.payload).sort(), ["expiresAt", "kind", "scope", "token"]);
  assert.equal((await post(connection, anchor, pair)).payload.kind, "unauthorized");
  const options = { token: paired.payload.token };
  // The status check answers without reaching the Vault.
  assert.deepEqual(await post(connection, anchor, { action: "status" }, options), {
    payload: { kind: "connected" },
    protocol: "TLSv1.3",
  });
  assert.equal(
    (await post(connection, anchor, { action: "status", path: "outside.md" }, options)).payload
      .kind,
    "invalidRequest",
  );
  assert.equal(
    (await post(connection, anchor, { ...purchase, path: "outside.md" }, options)).payload.kind,
    "invalidRequest",
  );
  assert.deepEqual(await readdir(folder), []);
  assert.deepEqual((await post(connection, anchor, purchase, options)).payload, {
    kind: "saved",
  });
  const notes = await readdir(folder);
  assert.equal(notes.length, 1);
  const markdown = await readFile(join(folder, notes[0]), "utf8");
  assert.match(markdown, /owned: true/);
  assert.match(markdown, /9780306406157/);
  connection.revoke();
  assert.equal((await post(connection, anchor, purchase, options)).payload.kind, "unauthorized");
  assert.equal(
    (await post(connection, anchor, { action: "status" }, options)).payload.kind,
    "unauthorized",
  );
  assert.deepEqual(await readdir(folder), notes);
  assert.equal(await readFile(join(folder, notes[0]), "utf8"), markdown);
});
