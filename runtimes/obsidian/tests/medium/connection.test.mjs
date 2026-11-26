import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Catalog } from "../../src/catalog.ts";
import { ConnectionGrant } from "../../src/connection-grant.ts";
import { Connection, scopeOf } from "../../src/connection.ts";
import { LocalMoveCopies } from "../../src/local-move-copies.ts";
import { createHost } from "../../src/tls-identity.ts";
import * as core from "../../dist/wasm/book_props_vault.js";
import { post, prove, readCard } from "./connection-support.mjs";

const product = {
  title: "Design Handbook",
  authors: ["Example Author"],
  isbns: ["9780306406157"],
  label: "First",
};
core.initSync({
  module: await readFile(new URL("../../dist/wasm/book_props_vault_bg.wasm", import.meta.url)),
});

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
    Connection.start(createHost(), 0, "Books", undefined, async () => ({
      kind: "unavailable",
    })),
    { message: "接続設定が不正です。" },
  );
});

await test("only the extension that proved the folder can save a purchase through a trusted TLS endpoint", async (context) => {
  const folder = await mkdtemp(join(tmpdir(), "shelf-"));
  context.after(async () => await rm(folder, { recursive: true, force: true }));
  const profile = await mkdtemp(join(tmpdir(), "book-props-profile-"));
  context.after(async () => await rm(profile, { recursive: true, force: true }));
  const grant = await ConnectionGrant.create("Reading Vault", profile);
  assert.equal(grant.directory, join(await realpath(profile), "Book Props", "Reading Vault"));
  const files = bookFiles(folder);
  const catalog = new Catalog(files, core);
  // Only purchases reach the Vault; any other request arriving here fails the test.
  const dispatch = async (input, signal) => {
    assert.equal(input.action, "purchase");
    const receipt = await catalog.execute(input, signal);
    assert.equal(receipt.kind, "saved");
    return { kind: "saved" };
  };
  const scope = scopeOf(folder, "Books");
  const host = createHost();
  const connection = await Connection.start(host, 0, scope, grant, dispatch);
  context.after(() => connection.stop());
  const card = await readCard(grant);
  const { anchor } = card;
  const pair = { action: "pair", code: randomBytes(16).toString("base64url") };
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
  assert.equal((await post(connection, anchor, pair)).payload.kind, "unauthorized");
  await prove(grant, anchor, pair.code);
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
  // The session belongs to the extension that paired; another extension cannot reuse its token.
  const otherExtension = { ...options, origin: `chrome-extension://${"p".repeat(32)}` };
  assert.equal(
    (await post(connection, anchor, { action: "status" }, otherExtension)).payload.kind,
    "unauthorized",
  );
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
  connection.stop();
  const restoredGrant = await ConnectionGrant.open(grant.id, grant.name, profile);
  const restored = await Connection.start(
    host,
    connection.listeningPort,
    scope,
    restoredGrant,
    dispatch,
  );
  context.after(() => restored.stop());
  const fresh = await readCard(restoredGrant);
  assert.equal(fresh.grantId, card.grantId);
  assert.equal(fresh.origin, card.origin);
  assert.notEqual(fresh.anchor, anchor);
  await assert.rejects(post(restored, anchor, pair));
  assert.equal((await post(restored, fresh.anchor, pair)).payload.kind, "unauthorized");
  assert.equal(
    (await post(restored, fresh.anchor, { action: "status" }, options)).payload.kind,
    "unauthorized",
  );
  const renew = { action: "pair", code: randomBytes(16).toString("base64url") };
  await prove(restoredGrant, fresh.anchor, renew.code);
  const renewed = (await post(restored, fresh.anchor, renew)).payload;
  assert.equal(renewed.kind, "paired");
  assert.equal(renewed.scope, scope);
  assert.equal(
    (await post(restored, fresh.anchor, { action: "status" }, { token: renewed.token })).payload
      .kind,
    "connected",
  );
  assert.deepEqual(await readdir(folder), notes);
  assert.equal(await readFile(join(folder, notes[0]), "utf8"), markdown);
});
