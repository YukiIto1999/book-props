import assert from "node:assert/strict";
import { test } from "node:test";
import { decodePairing, encodePairing, requestEnvelope } from "@book-props/vault-contract";

const expected = {
  origin: "https://bp-12345678901234567890123456789012.localhost:41887",
  anchor: "AQID",
  code: "XyuLiY407YhPSeZLi-FLFg",
};

void test("a pairing string copies all trust data for one local endpoint", () => {
  assert.deepEqual(decodePairing(` ${encodePairing(expected)}\n`), expected);
  for (const bad of [
    { origin: "https://test.example:41887" },
    { origin: `${expected.origin}/extra` },
    { origin: expected.origin.replace(":41887", ":99999") },
    { anchor: "<bad>" },
    { anchor: "A".repeat(2048) },
    { code: "" },
  ]) {
    assert.equal(decodePairing(JSON.stringify({ version: 1, ...expected, ...bad })), undefined);
  }
  assert.equal(decodePairing(JSON.stringify({ version: 2, ...expected })), undefined);
});

void test("the request envelope keeps a pairing code separate from an issued token", () => {
  const pair = { action: "pair", code: expected.code };
  const token = "o".repeat(43);
  assert(requestEnvelope.safeParse({ request: pair }).success);
  assert(!requestEnvelope.safeParse({ request: pair, token }).success);
  assert(!requestEnvelope.safeParse({ request: { action: "status" } }).success);
  assert(requestEnvelope.safeParse({ request: { action: "status" }, token }).success);
});
