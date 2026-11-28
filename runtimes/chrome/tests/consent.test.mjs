import assert from "node:assert/strict";
import test from "node:test";
import { TabBadges } from "../src/extension/badge.ts";
import { consentVersion } from "../src/extension/consent.ts";
import { Options } from "../src/extension/options.ts";
import { consentRequired } from "../src/extension/outcomes.ts";
import { PageWatch } from "../src/extension/page-watch.ts";
import { Popup } from "../src/extension/popup.ts";
import { statusLabel } from "../src/extension/status.ts";
import { workerOperations } from "../src/extension/worker-operations.ts";
import { optionsView } from "./page-stubs.mjs";
import { install, storedConsent } from "./vault-storage.mjs";

const productUrl = "https://www.amazon.co.jp/dp/4000000000";
const book = { title: "本" };
const observed = { kind: "observed", ownership: "unowned", wanted: true };
const settle = () => new Promise((resolve) => setImmediate(resolve));

// A product page that records every read, check, unmark, toast and page watch it is asked for.
function recordedPage(ask) {
  const log = [];
  const page = {
    url: () => (log.push("url"), productUrl),
    product: () => (log.push("product"), book),
  };
  const watch = new PageWatch(
    page,
    {
      consented: ask,
      check: async () => (log.push("check"), observed),
      unmark: async () => void log.push("unmark"),
    },
    { show: (text) => log.push(`show ${text}`), clear: () => log.push("clear") },
    () => (log.push("watch"), () => log.push("unwatch")),
  );
  return { log, watch };
}

void test("a product page reads nothing and asks nothing before consent", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { log, watch } = recordedPage(async () => false);
  await watch.refresh();
  watch.schedule();
  t.mock.timers.tick(375);
  await settle();
  assert.deepEqual(watch.describe(), {});
  watch.showRecheck(productUrl, observed);
  assert.deepEqual(log, []);
});

void test("an answer about consent that a withdrawal overtook does not restart reading", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const answers = [];
  const { log, watch } = recordedPage(() => {
    const answer = Promise.withResolvers();
    answers.push(answer);
    return answer.promise;
  });
  // The page asked when it opened, while the user still agreed; the withdrawal's notice made it ask again.
  const opening = watch.refresh();
  const afterWithdrawal = watch.refresh();
  answers[1].resolve(false);
  await afterWithdrawal;
  answers[0].resolve(true);
  await opening;
  t.mock.timers.tick(375);
  await settle();
  assert.deepEqual(watch.describe(), {});
  assert.deepEqual(log, []);
});

void test("a page restored from the back-forward cache asks again before it reads", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let agreed = true;
  const { log, watch } = recordedPage(async () => agreed);
  await watch.refresh();
  t.mock.timers.tick(375);
  await settle();
  assert.ok(log.includes("product"));

  // The user leaves, withdraws consent elsewhere, and comes back; the cached page heard nothing meanwhile.
  log.length = 0;
  watch.suspend();
  agreed = false;
  watch.schedule();
  await watch.refresh();
  t.mock.timers.tick(375);
  await settle();
  assert.deepEqual(watch.describe(), {});
  assert.deepEqual(log, ["unwatch", "clear"]);

  // Coming back with consent still given reads the page again.
  agreed = true;
  watch.suspend();
  await watch.refresh();
  t.mock.timers.tick(375);
  await settle();
  assert.ok(log.includes("product"));
});

void test("the worker refuses every page and Vault operation until consent, then serves them", async () => {
  install({}, {});
  const consent = storedConsent();
  const calls = [];
  const client = new Proxy(
    {},
    {
      get: (_target, name) => async () => {
        calls.push(`client ${String(name)}`);
        return name === "hasPending" ? false : observed;
      },
    },
  );
  const tabs = {
    active: async () => (calls.push("active"), { url: productUrl, product: book }),
    inTab: async () => (calls.push("inTab"), { url: productUrl, product: book }),
    show: async () => calls.push("show"),
    consentChanged: async () => {},
  };
  const icon = {
    show: async (tabId, badge) => void calls.push(`icon ${tabId} ${badge?.tone}`),
    clearAll: async () => void calls.push("icon clearAll"),
  };
  let disclosed = 0;
  const operations = workerOperations({
    client,
    tabs,
    badges: new TabBadges(icon),
    consent,
    disclose: async () => void disclosed++,
  });
  assert.equal(await operations.consented(), false);
  assert.deepEqual(await operations.check(book, 1), consentRequired);
  assert.deepEqual(await operations.inspect(), {
    supported: false,
    pending: false,
    reply: consentRequired,
  });
  for (const refused of [
    operations.open(),
    operations.change("purchase"),
    operations.change("setWish"),
    operations.reconcile(),
    operations.forget(),
    operations.pair("grant"),
    operations.disconnect(),
  ])
    assert.deepEqual(await refused, consentRequired);
  assert.deepEqual(await operations.status(), {
    configured: undefined,
    state: "consentRequired",
  });
  await operations.recheck(1, productUrl);
  assert.equal(disclosed, 1);
  assert.deepEqual(calls, []);

  await consent.agree();
  assert.equal(await operations.consented(), true);
  assert.deepEqual(await operations.check(book, 1), observed);
  await operations.recheck(1, productUrl);
  assert.equal(disclosed, 1);
  assert.deepEqual(calls, [
    "client send",
    "icon 1 wanted",
    "inTab",
    "client send",
    "icon 1 wanted",
    "show",
  ]);
});

void test("consent persists across contexts and a newer data practice asks for it again", async () => {
  install({}, {});
  assert.equal(await storedConsent().given(), false);
  await storedConsent().agree();
  assert.equal(await storedConsent().given(), true);

  const { local } = install({ consent: { version: consentVersion - 1, at: 1 } }, {});
  const earlier = storedConsent();
  assert.equal(await earlier.given(), false);
  await earlier.agree();
  const { consent } = await local.get("consent");
  assert.equal(consent.version, consentVersion);
  assert.equal(typeof consent.at, "number");
  assert.equal(await storedConsent().given(), true);

  install({ consent: "agreed" }, {});
  assert.equal(await storedConsent().given(), false);
});

void test("withdrawing consent stops reading open pages at once", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  install({}, {});
  const consent = storedConsent();
  const { log, watch } = recordedPage(consent.given);
  // The worker relays each change to the tabs, which ask again; here the page hears it directly.
  consent.follow(() => void watch.refresh());
  await consent.agree();
  await settle();
  t.mock.timers.tick(375);
  await settle();
  assert.deepEqual(log, [
    "watch",
    "url",
    "product",
    "clear",
    "check",
    "url",
    "show 欲しいに登録済み",
  ]);

  log.length = 0;
  await consent.withdraw();
  await settle();
  assert.deepEqual(log, ["unwatch", "clear"]);
  watch.schedule();
  t.mock.timers.tick(375);
  await settle();
  assert.deepEqual(watch.describe(), {});
  watch.showRecheck(productUrl, observed);
  assert.deepEqual(log, ["unwatch", "clear"]);
});

void test("the settings page shows the disclosure until the user agrees, and only then the pairing", async () => {
  install({}, {});
  const said = [];
  const shown = {};
  let checked = 0;
  const options = new Options(
    {
      status: async () => (checked++, { configured: undefined, state: "unpaired" }),
      pair: async () => ({ kind: "saved" }),
      disconnect: async () => ({ kind: "saved" }),
    },
    {
      permission: async () => undefined,
      select: async () => ({ kind: "cancelled" }),
      restore: async () => "granted",
    },
    storedConsent(),
    optionsView(said, shown),
  );
  await options.open();
  assert.equal(shown.disclosed, true);
  assert.equal(checked, 0);
  await options.agree();
  assert.equal(shown.disclosed, false);
  assert.equal(said.at(-1), "ペアリングされていません。");
  assert.equal(checked, 1);
  await options.withdraw();
  assert.equal(shown.disclosed, true);
  assert.equal(await storedConsent().given(), false);
  assert.equal(checked, 1);
});

void test("the popup offers no action before consent and points to the disclosure", async () => {
  let controls;
  const said = [];
  const popup = new Popup(
    {
      inspect: async () => ({
        supported: false,
        pending: false,
        reply: consentRequired,
      }),
      request: async () => consentRequired,
    },
    { permission: async () => undefined },
    { render: (shown) => (controls = shown), say: (text) => said.push(text), lock: () => {} },
  );
  await popup.refresh();
  await popup.act("purchase");
  assert.deepEqual(
    [controls.canPurchase, controls.canWish, controls.canOpen, controls.pending],
    [false, false, false, false],
  );
  assert.deepEqual(said, [statusLabel(consentRequired, true), statusLabel(consentRequired, true)]);
  assert.match(said[0], /接続設定・対応サイト/);
});
