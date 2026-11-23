import assert from "node:assert/strict";
import test from "node:test";

const origin = "https://bp-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.localhost:4242";
const scope = "a".repeat(64);
const otherScope = "b".repeat(64);
const clientId = "4fa20a45-80a4-4c8c-b74c-c3e307076da5";
const requestId = "1cf19174-6b31-4060-b2b5-df47987ed56b";
const code = "A".repeat(22);
const firstToken = "F".repeat(43);
const secondToken = "S".repeat(43);

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
    permissions: { contains: async () => true },
  };
  return globalThis.chrome.storage;
}

function connection(token, connectionScope = scope) {
  return { origin, token, expiresAt: Date.now() + 60_000, scope: connectionScope };
}

function purchaseOf(title, id = requestId) {
  return {
    action: "purchase",
    product: { title },
    purchase: { clientId, requestId: id, issuedAt: Date.now() },
  };
}

// Records what reaches the plugin and answers from `reply`, which may also throw or wait.
function plugin(reply) {
  const sent = [];
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    sent.push({ url, body, authorization: init.headers.Authorization });
    return reply(body);
  };
  return sent;
}

void test("purchase recovery does not let another popup replace the record it is resolving", async () => {
  const operation = purchaseOf("前の本");
  const { local } = install(
    { clientId, pending: { origin, scope, operation } },
    { connection: connection(firstToken) },
  );
  const started = Promise.withResolvers();
  const response = Promise.withResolvers();
  const purchases = [];
  globalThis.fetch = async (_url, init) => {
    const request = JSON.parse(init.body);
    if (request.action === "reconcile") {
      started.resolve(request);
      return response.promise;
    }
    purchases.push(request);
    throw new Error("the purchase reply was lost");
  };
  const { changeBook, forgetPending, hasPending, reconcilePending } =
    await import("../src/vault-client.ts");
  const recovery = reconcilePending();
  try {
    assert.deepEqual(await started.promise, { ...operation, action: "reconcile" });
    await forgetPending();
    await changeBook("purchase", { title: "次の本" });
    assert.deepEqual(purchases, []);
    assert.deepEqual((await local.get("pending")).pending, { origin, scope, operation });
  } finally {
    response.resolve(Response.json({ kind: "replayed" }));
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
  const sent = plugin((body) =>
    Response.json(
      body.action === "pair"
        ? { kind: "paired", token: secondToken, expiresAt: Date.now() + 60_000, scope }
        : { kind: "replayed" },
    ),
  );
  const { hasPending, pair, reconcilePending } = await import("../src/vault-client.ts");
  assert.deepEqual(await reconcilePending(), { kind: "scopeMismatch" });
  assert.deepEqual(sent, []);
  assert.deepEqual((await local.get("pending")).pending, { origin, scope, operation });

  assert.deepEqual(await pair(origin, code), { kind: "saved" });
  assert.deepEqual(await reconcilePending(), { kind: "replayed" });
  assert.deepEqual(sent.slice(1), [
    {
      url: `${origin}/book-props/v1`,
      body: { ...operation, action: "reconcile" },
      authorization: `Bearer ${secondToken}`,
    },
  ]);
  assert.equal(await hasPending(), false);
});

void test("a pending purchase without its book folder waits for the user to check the Vault", async () => {
  const operation = purchaseOf("以前の版で買った本");
  install({ clientId, pending: { origin, operation } }, { connection: connection(firstToken) });
  const sent = plugin(() => Response.json({ kind: "replayed" }));
  const { forgetPending, hasPending, reconcilePending } = await import("../src/vault-client.ts");
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
  const sent = plugin((body) => {
    if (body.action === "pair")
      return Response.json({
        kind: "paired",
        token: secondToken,
        expiresAt: Date.now() + 60_000,
        scope: otherScope,
      });
    statusSent.resolve();
    return answer();
  });
  const { connectionStatus, pair } = await import("../src/vault-client.ts");

  const opening = connectionStatus();
  await statusSent.promise;
  assert.deepEqual(await pair(origin, code), { kind: "saved" });
  statusReply.resolve(Response.json({ kind: "unauthorized" }, { status: 401 }));
  assert.deepEqual(await opening, { configured: origin, state: "unpaired" });
  assert.equal((await session.get("connection")).connection.token, secondToken);

  answer = () => Response.json({ kind: "connected" });
  assert.deepEqual(await connectionStatus(), { configured: origin, state: "paired" });
  assert.deepEqual(sent.at(-1), {
    url: `${origin}/book-props/v1`,
    body: { action: "status" },
    authorization: `Bearer ${secondToken}`,
  });

  answer = () => {
    throw new TypeError("Failed to fetch");
  };
  assert.deepEqual(await connectionStatus(), { configured: origin, state: "unknown" });
  assert.equal((await session.get("connection")).connection.token, secondToken);

  answer = () => Response.json({ kind: "unauthorized" }, { status: 401 });
  assert.deepEqual(await connectionStatus(), { configured: origin, state: "unpaired" });
  assert.equal((await session.get("connection")).connection, undefined);
  const count = sent.length;
  assert.deepEqual(await connectionStatus(), { configured: origin, state: "unpaired" });
  assert.equal(sent.length, count);
});

void test("a session stored before scopes counts as unpaired and sends nothing", async () => {
  const legacy = { origin, token: firstToken, expiresAt: Date.now() + 60_000 };
  install({ origin }, { connection: legacy });
  const sent = plugin(() => Response.json({ kind: "connected" }));
  const { connectionStatus, send } = await import("../src/vault-client.ts");
  assert.deepEqual(await connectionStatus(), { configured: origin, state: "unpaired" });
  assert.deepEqual(await send({ action: "inspect", product: { title: "本" } }), {
    kind: "unauthorized",
  });
  assert.deepEqual(sent, []);
});
