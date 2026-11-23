import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { request as httpsRequest } from "node:https";
import { join } from "node:path";
import test from "node:test";
import { endpoint, response } from "@book-props/vault-contract";
import { Catalog } from "../../src/catalog.ts";
import { Connection, scopeOf } from "../../src/connection.ts";
import { LocalMoveCopies } from "../../src/local-move-copies.ts";
import { dropIdentity, provisionIdentity } from "../../src/tls-identity.ts";
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

function post(connection, identity, input, options) {
  const body = JSON.stringify(input);
  return new Promise((resolve, reject) => {
    const exchange = httpsRequest(
      {
        hostname: "127.0.0.1",
        port: connection.listeningPort,
        path: endpoint,
        method: "POST",
        ca: options?.trust === false ? undefined : identity.certificate,
        servername: options?.servername ?? identity.name,
        agent: false,
        signal: AbortSignal.timeout(5000),
        headers: {
          Host: new URL(connection.address).host,
          Origin: options?.origin ?? origin,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          ...(options?.token ? { Authorization: `Bearer ${options.token}` } : {}),
        },
      },
      (reply) => {
        const chunks = [];
        const protocol = reply.socket.getProtocol();
        reply.on("data", (chunk) => chunks.push(chunk));
        reply.on("error", reject);
        reply.on("end", () => {
          try {
            const payload = response.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
            resolve({ status: reply.statusCode, payload, protocol });
          } catch (cause) {
            reject(cause);
          }
        });
      },
    );
    exchange.on("error", reject);
    exchange.end(body);
  });
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
  const vault = join(process.env.XDG_RUNTIME_DIR, "Reading Vault");
  const scope = scopeOf(vault, "Books");
  assert.match(scope, /^[0-9a-f]{64}$/);
  assert.equal(scopeOf(vault, "Books"), scope);
  assert.notEqual(scopeOf(vault, "Books/Archive"), scope);
  assert.notEqual(scopeOf(join(process.env.XDG_RUNTIME_DIR, "Other Vault"), "Books"), scope);
  await assert.rejects(
    Connection.start({}, extension, 0, "Books", async () => ({ kind: "unavailable" })),
    { message: "接続設定が不正です。" },
  );
});

await test("only the paired extension can save a purchase through a trusted TLS endpoint", async (context) => {
  const folder = await mkdtemp(join(process.env.XDG_RUNTIME_DIR, "shelf-"));
  context.after(async () => await rm(folder, { recursive: true, force: true }));
  const files = bookFiles(folder);
  const catalog = new Catalog(files, evaluate);
  const identity = await provisionIdentity();
  context.after(async () => await dropIdentity(identity));
  // Only purchases reach the Vault; any other request arriving here fails the test.
  const dispatch = async (input, signal) => {
    assert.equal(input.action, "purchase");
    const receipt = await catalog.execute(input, signal);
    assert.equal(receipt.kind, "saved");
    return { kind: "saved" };
  };
  const scope = scopeOf(folder, "Books");
  const connection = await Connection.start(identity, extension, 0, scope, dispatch);
  context.after(() => connection.stop());
  const { value: code } = connection.issueCode();
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
  await assert.rejects(post(connection, identity, pair, { trust: false }), {
    code: "DEPTH_ZERO_SELF_SIGNED_CERT",
  });
  await assert.rejects(post(connection, identity, pair, { servername: "elsewhere.localhost" }), {
    code: "ERR_TLS_CERT_ALTNAME_INVALID",
  });
  assert.equal(
    (await post(connection, identity, pair, { origin: "https://elsewhere.test" })).status,
    403,
  );
  assert.equal((await post(connection, identity, purchase)).status, 401);
  assert.equal((await post(connection, identity, { action: "status" })).status, 401);
  const paired = await post(connection, identity, pair);
  assert.equal(paired.status, 200);
  assert.equal(paired.protocol, "TLSv1.3");
  assert.equal(paired.payload.kind, "paired");
  assert.equal(paired.payload.scope, scope);
  assert.deepEqual(Object.keys(paired.payload).sort(), ["expiresAt", "kind", "scope", "token"]);
  assert.equal((await post(connection, identity, pair)).status, 401);
  const options = { token: paired.payload.token };
  // The status check answers without reaching the Vault.
  assert.deepEqual(await post(connection, identity, { action: "status" }, options), {
    status: 200,
    payload: { kind: "connected" },
    protocol: "TLSv1.3",
  });
  assert.equal(
    (await post(connection, identity, { action: "status", path: "outside.md" }, options)).status,
    400,
  );
  assert.equal(
    (await post(connection, identity, { ...purchase, path: "outside.md" }, options)).status,
    400,
  );
  assert.deepEqual(await readdir(folder), []);
  assert.deepEqual((await post(connection, identity, purchase, options)).payload, {
    kind: "saved",
  });
  const notes = await readdir(folder);
  assert.equal(notes.length, 1);
  const markdown = await readFile(join(folder, notes[0]), "utf8");
  assert.match(markdown, /owned: true/);
  assert.match(markdown, /9780306406157/);
  connection.revoke();
  assert.equal((await post(connection, identity, purchase, options)).status, 401);
  assert.equal((await post(connection, identity, { action: "status" }, options)).status, 401);
  assert.deepEqual(await readdir(folder), notes);
  assert.equal(await readFile(join(folder, notes[0]), "utf8"), markdown);
});
