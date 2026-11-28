import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { exchange } from "../src/adapters/vault-transport.ts";

// A throwaway self-signed CA certificate, which the TLS client accepts as the plugin's anchor.
const anchor =
  "MIIBljCCAT2gAwIBAgIUBRDjnTgHJ4nOs+l6X6HK6JkwlV0wCgYIKoZIzj0EAwIwITEfMB0GA1UEAwwWQm9vayBQcm9wcyB0ZXN0IGFuY2hvcjAeFw0yNjExMjgxNjQwMTBaFw0yNjExMjkxNjQwMTBaMCExHzAdBgNVBAMMFkJvb2sgUHJvcHMgdGVzdCBhbmNob3IwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAAQGVBHEPWQ6ltNL34yL+XCsn3vriIRbUbNO9b9cKNo9d5wNQnR0IWYvwvEOm3cNEkY6e4RXXyktmplEgPfjqKA/o1MwUTAdBgNVHQ4EFgQUpYaCPOPGrUUrm8VxeHPEQIjDyN4wHwYDVR0jBBgwFoAUpYaCPOPGrUUrm8VxeHPEQIjDyN4wDwYDVR0TAQH/BAUwAwEB/zAKBggqhkjOPQQDAgNHADBEAiBLEUR5nHBKE7uqFi173cBzxz93NEwZft0JbU47av8G2gIgG9bSc94r/inkaHNPKQpTj9qRc2ttxoMC90O5ok/y5N0=";
const host = `bp-${"0".repeat(32)}.localhost:43210`;
const peer = { origin: `https://${host}`, anchor };
const wasm = new URL("../dist/tls/vault_tls_bg.wasm", import.meta.url);

/**
 * Runs `run` with chrome.runtime, fetch and WebSocket standing in for the worker's, and records each request to
 * the plugin's address and each WebSocket opened. Every WebSocket fails at once, as one to a closed port does.
 */
async function withNetwork(listening, run) {
  const probes = [];
  const sockets = [];
  const saved = { fetch: globalThis.fetch, WebSocket: globalThis.WebSocket };
  globalThis.chrome = { runtime: { getURL: (path) => `chrome-extension://test/${path}` } };
  // Both the worker's wasm and its probe of the plugin are fetched by a string address.
  globalThis.fetch = async (/** @type {string} */ url) => {
    if (url.endsWith("vault_tls_bg.wasm"))
      return new Response(await readFile(wasm), {
        headers: { "content-type": "application/wasm" },
      });
    probes.push(url);
    if (!listening) throw new TypeError("Failed to fetch");
    return new Response(null, { status: 404 });
  };
  globalThis.WebSocket = class extends EventTarget {
    constructor(url) {
      super();
      sockets.push(url);
      queueMicrotask(() => this.dispatchEvent(new Event("error")));
    }
    close() {}
  };
  try {
    await run({ probes, sockets });
  } finally {
    Object.assign(globalThis, saved);
    delete globalThis.chrome;
  }
}

void test("a plugin that is not listening goes unanswered without a WebSocket, whose failure Chrome lists as an error", async () => {
  await withNetwork(false, async ({ probes, sockets }) => {
    assert.equal(await exchange(peer, { action: "status" }), undefined);
    assert.deepEqual(probes, [`http://${host}/book-props/v1`]);
    assert.deepEqual(sockets, []);
  });
});

void test("a listening plugin is reached over a WebSocket", async () => {
  await withNetwork(true, async ({ probes, sockets }) => {
    assert.equal(await exchange(peer, { action: "status" }), undefined);
    assert.deepEqual(probes, [`http://${host}/book-props/v1`]);
    assert.deepEqual(sockets, [`ws://${host}/book-props/v1`]);
  });
});
