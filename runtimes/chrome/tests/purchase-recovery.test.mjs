import assert from "node:assert/strict";
import test from "node:test";
import { VaultClient } from "../src/vault-client.ts";

const origin = "https://bp-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.localhost:4242";
const anchor = "AQID";
const scope = "a".repeat(64);
const otherScope = "b".repeat(64);
const clientId = "4fa20a45-80a4-4c8c-b74c-c3e307076da5";
const requestId = "1cf19174-6b31-4060-b2b5-df47987ed56b";
const code = "A".repeat(22);
const firstToken = "F".repeat(43);
const secondToken = "S".repeat(43);
const grantId = "955d60ba-36ca-4263-b469-202f97034c09";

function storage(initial) {
  const values = { ...initial };
  return {
    setAccessLevel: async () => {},
    get: async (keys) => Object.fromEntries([keys].flat().map((key) => [key, values[key]])),
    set: async (update) => Object.assign(values, update),
    remove: async (key) => {
      delete values[key];
    },
  };
}

function install(local, session) {
  globalThis.chrome = {
    storage: { local: storage(local), session: storage(session) },
  };
  return globalThis.chrome.storage;
}

function connection(token, connectionScope = scope) {
  return { origin, anchor, token, expiresAt: Date.now() + 60_000, scope: connectionScope };
}

function grants(currentScope = scope, selectedScope = scope) {
  const grant = (scope) => {
    const binding = { origin, scope, grantId };
    return {
      binding,
      read: async () => ({ version: 1, ...binding, anchor }),
      prove: async () => code,
    };
  };
  let remembered = currentScope === null ? undefined : grant(currentScope);
  const selected = grant(selectedScope);
  return {
    read: async () => remembered,
    selected: async (id) => (id === grantId ? selected : undefined),
    commit: async () => {
      remembered = selected;
      return true;
    },
    forget: async () => {
      remembered = undefined;
    },
  };
}

function purchaseOf(title, id = requestId) {
  return {
    action: "purchase",
    product: { title },
    purchase: { clientId, requestId: id, issuedAt: Date.now() },
  };
}

// Records what reaches the plugin and answers from `reply`, which may also throw or wait.
function plugin(reply, authorization = grants()) {
  const sent = [];
  const client = new VaultClient(({ origin, anchor }, body, token) => {
    sent.push({ origin, anchor, body, token });
    return reply(body);
  }, authorization);
  return Object.assign(client, { sent });
}

void test("a remembered Vault issues a fresh session after expiration without replaying a purchase", async () => {
  const operation = purchaseOf("保存結果が不明な本");
  const pending = { origin, scope, operation };
  const { local } = install(
    { clientId, pending },
    { connection: { ...connection(firstToken), expiresAt: 0 } },
  );
  const { sent, send } = plugin((body) =>
    body.action === "pair"
      ? { kind: "paired", token: secondToken, expiresAt: Date.now() + 60_000, scope }
      : { kind: "observed", ownership: "unowned", wanted: false },
  );
  const inspect = { action: "inspect", product: { title: "別の本" } };
  assert.deepEqual(await send(inspect), { kind: "observed", ownership: "unowned", wanted: false });
  assert.deepEqual(sent, [
    { origin, anchor, body: { action: "pair", code }, token: undefined },
    { origin, anchor, body: inspect, token: secondToken },
  ]);
  assert.deepEqual((await local.get("pending")).pending, pending);
});

void test("purchase recovery does not let another popup replace the record it is resolving", async () => {
  const operation = purchaseOf("前の本");
  const { local } = install(
    { clientId, pending: { origin, scope, operation } },
    { connection: connection(firstToken) },
  );
  const started = Promise.withResolvers();
  const response = Promise.withResolvers();
  const purchases = [];
  const { changeBook, forgetPending, hasPending, reconcilePending } = new VaultClient(
    async (_peer, request) => {
      if (request.action === "reconcile") {
        started.resolve(request);
        return response.promise;
      }
      purchases.push(request);
      throw new Error("the purchase reply was lost");
    },
    grants(),
  );
  const recovery = reconcilePending();
  try {
    assert.deepEqual(await started.promise, { ...operation, action: "reconcile" });
    await forgetPending();
    await changeBook("purchase", { title: "次の本" });
    assert.deepEqual(purchases, []);
    assert.deepEqual((await local.get("pending")).pending, { origin, scope, operation });
  } finally {
    response.resolve({ kind: "replayed" });
    await recovery;
  }
  assert.equal(await hasPending(), false);
  assert.equal((await changeBook("purchase", { title: "次の本" })).kind, "unknown");
  assert.equal(purchases.length, 1);
  const { pending } = await local.get("pending");
  assert.equal(pending.operation.product.title, "次の本");
  assert.equal(pending.scope, scope);
  assert.notEqual(pending.operation.purchase.requestId, requestId);
});

void test("a pending purchase is rechecked only through the book folder it was made in", async () => {
  const operation = purchaseOf("元のフォルダの本");
  const { local } = install(
    { clientId, origin, pending: { origin, scope, operation } },
    { connection: connection(firstToken, otherScope) },
  );
  const { sent, hasPending, pair, reconcilePending } = plugin(
    (body) =>
      body.action === "pair"
        ? { kind: "paired", token: secondToken, expiresAt: Date.now() + 60_000, scope }
        : { kind: "replayed" },
    grants(otherScope),
  );
  assert.deepEqual(await reconcilePending(), { kind: "scopeMismatch" });
  assert.deepEqual(sent, []);
  assert.deepEqual((await local.get("pending")).pending, { origin, scope, operation });

  assert.deepEqual(await pair(grantId), { kind: "saved" });
  assert.deepEqual(await reconcilePending(), { kind: "replayed" });
  assert.deepEqual(sent.slice(1), [
    {
      origin,
      anchor,
      body: { ...operation, action: "reconcile" },
      token: secondToken,
    },
  ]);
  assert.equal(await hasPending(), false);
});

void test("a pending purchase without its book folder waits for the user to check the Vault", async () => {
  const operation = purchaseOf("以前の版で買った本");
  install({ clientId, pending: { origin, operation } }, { connection: connection(firstToken) });
  const { sent, forgetPending, hasPending, reconcilePending } = plugin(() => ({
    kind: "replayed",
  }));
  assert.deepEqual(await reconcilePending(), { kind: "manualCheck" });
  assert.deepEqual(await reconcilePending(), { kind: "manualCheck" });
  assert.deepEqual(sent, []);
  assert.equal(await hasPending(), true);
  assert.deepEqual(await forgetPending(), { kind: "forgotten" });
  assert.equal(await hasPending(), false);
  assert.deepEqual(await forgetPending(), { kind: "notSaved" });
});

void test("the settings status asks the plugin and drops only the session it rejected", async () => {
  const { session } = install({ origin }, { connection: connection(firstToken) });
  const statusSent = Promise.withResolvers();
  const statusReply = Promise.withResolvers();
  let answer = () => statusReply.promise;
  let allowPair = true;
  const { sent, connectionStatus, pair } = plugin(
    (body) => {
      if (body.action === "pair") {
        if (!allowPair) return { kind: "unauthorized" };
        return {
          kind: "paired",
          token: secondToken,
          expiresAt: Date.now() + 60_000,
          scope: otherScope,
        };
      }
      statusSent.resolve();
      return answer();
    },
    grants(scope, otherScope),
  );

  const opening = connectionStatus();
  await statusSent.promise;
  assert.deepEqual(await pair(grantId), { kind: "saved" });
  statusReply.resolve({ kind: "unauthorized" });
  assert.deepEqual(await opening, { configured: origin, state: "unpaired" });
  assert.equal((await session.get("connection")).connection.token, secondToken);

  answer = () => ({ kind: "connected" });
  assert.deepEqual(await connectionStatus(), { configured: origin, state: "paired" });
  assert.deepEqual(sent.at(-1), {
    origin,
    anchor,
    body: { action: "status" },
    token: secondToken,
  });

  answer = () => {
    throw new TypeError("Connection lost");
  };
  assert.deepEqual(await connectionStatus(), { configured: origin, state: "unknown" });
  assert.equal((await session.get("connection")).connection.token, secondToken);

  answer = () => ({ kind: "unauthorized" });
  assert.deepEqual(await connectionStatus(), { configured: origin, state: "unpaired" });
  assert.equal((await session.get("connection")).connection, undefined);
  allowPair = false;
  const count = sent.length;
  assert.deepEqual(await connectionStatus(), { configured: origin, state: "unknown" });
  assert.equal(sent.length, count + 1);
  assert.equal(sent.at(-1).body.action, "pair");
});

void test("an HTTPS pairing from before the transport cutover sends nothing and keeps the pending purchase", async () => {
  const { anchor: _oldFormat, ...legacy } = connection(firstToken);
  const pending = { origin, scope, operation: purchaseOf("更新前に買った本") };
  const { local } = install({ origin, pending }, { connection: legacy });
  const { sent, connectionStatus, send, reconcilePending } = plugin(
    () => ({ kind: "connected" }),
    grants(null),
  );
  assert.deepEqual(await connectionStatus(), { configured: undefined, state: "unpaired" });
  assert.deepEqual(await send({ action: "inspect", product: { title: "本" } }), {
    kind: "unauthorized",
  });
  assert.deepEqual(sent, []);
  assert.deepEqual(await reconcilePending(), { kind: "unauthorized" });
  assert.deepEqual((await local.get("pending")).pending, pending);
});

void test("re-pairing while recording a purchase does not send it to either Vault", async () => {
  const { local } = install({ clientId }, { connection: connection(firstToken) });
  const pendingWrite = Promise.withResolvers();
  const releaseWrite = Promise.withResolvers();
  const set = local.set;
  local.set = async (update) => {
    if (update.pending) {
      pendingWrite.resolve();
      await releaseWrite.promise;
    }
    return set(update);
  };
  const { sent, changeBook, pair, hasPending } = plugin(
    (body) => {
      assert.equal(body.action, "pair");
      return connectionReply(otherScope);
    },
    grants(scope, otherScope),
  );
  const purchase = changeBook("purchase", { title: "違うVaultへ送ってはいけない本" });
  await pendingWrite.promise;
  try {
    assert.deepEqual(await pair(grantId), { kind: "saved" });
  } finally {
    releaseWrite.resolve();
  }
  assert.deepEqual(await purchase, { kind: "unauthorized" });
  assert.deepEqual(
    sent.map(({ body }) => body.action),
    ["pair"],
  );
  assert.equal(await hasPending(), false);
});

function connectionReply(targetScope) {
  return { kind: "paired", token: secondToken, expiresAt: Date.now() + 60_000, scope: targetScope };
}

void test("a late request to open a note cannot open the same book in another Vault", async () => {
  install({}, { connection: connection(firstToken) });
  const wishSent = Promise.withResolvers();
  const wishReply = Promise.withResolvers();
  const sent = [];
  const { changeBook, pair } = new VaultClient(
    (_peer, body, token, signal) => {
      sent.push(body.action);
      if (body.action === "pair") return Promise.resolve(connectionReply(otherScope));
      assert.equal(token, firstToken);
      wishSent.resolve(signal);
      return wishReply.promise;
    },
    grants(scope, otherScope),
  );
  const wish = changeBook("wish", { title: "補記が必要な本" });
  const signal = await wishSent.promise;
  try {
    assert.deepEqual(await pair(grantId), { kind: "saved" });
    assert.equal(signal.aborted, true);
  } finally {
    wishReply.resolve({ kind: "needsInput" });
  }
  assert.deepEqual(await wish, { kind: "needsInput" });
  assert.deepEqual(sent, ["wish", "pair"]);
});
