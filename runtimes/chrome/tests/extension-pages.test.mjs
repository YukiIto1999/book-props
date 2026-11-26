import assert from "node:assert/strict";
import test from "node:test";
import { Options } from "../src/extension/options.ts";
import { PageWatch } from "../src/extension/page-watch.ts";
import { Popup } from "../src/extension/popup.ts";
import { statusLabel } from "../src/extension/status.ts";

const observed = { kind: "observed", ownership: "sameEdition", wanted: false };

void test("a purchase whose reply is lost stays unknown and blocks another purchase", async () => {
  const said = [];
  let controls;
  let pending = false;
  const popup = new Popup(
    {
      inspect: async () => ({ supported: true, hasBook: true, pending, reply: observed }),
      request: async () => {
        pending = true;
        throw new Error("the worker went away");
      },
    },
    { permission: async () => undefined },
    { render: (shown) => (controls = shown), say: (text) => said.push(text), lock: () => {} },
  );
  await popup.act("purchase");
  assert.equal(said.at(-1), statusLabel({ kind: "unknown" }, true));
  assert.equal(controls.canPurchase, false);
  await popup.act("open");
  assert.equal(said.at(-1), statusLabel({ kind: "unavailable" }, true));
});

void test("a product page shows an answer only while it still shows the page that asked", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const first = "https://www.amazon.co.jp/dp/4000000000";
  const page = { href: first, url: () => page.href, product: () => ({ title: "本" }) };
  const answer = Promise.withResolvers();
  const shown = [];
  const watch = new PageWatch(page, () => answer.promise, {
    show: (text) => shown.push(text),
    clear: () => {},
  });
  watch.schedule();
  t.mock.timers.tick(375);
  page.href = "https://www.amazon.co.jp/dp/4000000001";
  answer.resolve(observed);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(shown, []);
  watch.showRecheck(first, observed);
  assert.deepEqual(shown, []);
  watch.showRecheck(page.href, observed);
  assert.deepEqual(shown, [statusLabel(observed, true)]);
});

void test("the opening status check does not overwrite a pairing the user started", async () => {
  const status = Promise.withResolvers();
  const said = [];
  const options = new Options(
    {
      status: () => status.promise,
      pair: async () => ({ kind: "saved" }),
      disconnect: async () => ({ kind: "saved" }),
    },
    {
      permission: async () => "prompt",
      select: async () => ({ kind: "selected", grantId: "id" }),
      restore: async () => "granted",
    },
    { say: (text) => said.push(text), offerAllow: () => {}, pairing: () => {}, allowing: () => {} },
  );
  const opening = options.open();
  await options.pair();
  const paired = said.at(-1);
  status.resolve({ configured: undefined, state: "unknown" });
  await opening;
  assert.equal(said.at(-1), paired);
});
