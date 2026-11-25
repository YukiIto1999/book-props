import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeConnectionCard, requestEnvelope } from "@book-props/vault-contract";

const expected = {
  version: 1,
  origin: "https://bp-12345678901234567890123456789012.localhost:41887",
  anchor: "AQID",
  scope: "a".repeat(64),
  grantId: "4fa20a45-80a4-4c8c-b74c-c3e307076da5",
};

void test("a connection card identifies just one loopback endpoint and book scope", () => {
  assert.deepEqual(decodeConnectionCard(` ${JSON.stringify(expected)}\n`), expected);
  for (const bad of [
    { origin: "https://test.example:41887" },
    { origin: `${expected.origin}/extra` },
    { origin: expected.origin.replace(":41887", ":99999") },
    { anchor: "<bad>" },
    { anchor: "A".repeat(2048) },
    { scope: "" },
    { grantId: "different directory" },
    { code: "not part of the card" },
  ]) {
    assert.equal(decodeConnectionCard(JSON.stringify({ ...expected, ...bad })), undefined);
  }
  assert.equal(decodeConnectionCard(JSON.stringify({ ...expected, version: 2 })), undefined);
});

void test("the request envelope keeps a pairing code separate from an issued token", () => {
  const pair = { action: "pair", code: "XyuLiY407YhPSeZLi-FLFg" };
  const token = "o".repeat(43);
  assert(requestEnvelope.safeParse({ request: pair }).success);
  assert(!requestEnvelope.safeParse({ request: pair, token }).success);
  assert(!requestEnvelope.safeParse({ request: { action: "status" } }).success);
  assert(requestEnvelope.safeParse({ request: { action: "status" }, token }).success);
});
