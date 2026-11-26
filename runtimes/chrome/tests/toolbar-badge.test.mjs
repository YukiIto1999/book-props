import assert from "node:assert/strict";
import test from "node:test";
import { decodePageState } from "../src/adapters/wire.ts";
import { badgeFor, TabBadges } from "../src/extension/badge.ts";
import { consentRequired } from "../src/extension/outcomes.ts";
import { PageWatch } from "../src/extension/page-watch.ts";
import { Popup } from "../src/extension/popup.ts";
import { statusLabel } from "../src/extension/status.ts";
import { workerOperations } from "../src/extension/worker-operations.ts";
import { markIcon } from "../src/views/toolbar-dot.ts";

const productUrl = "https://www.amazon.co.jp/dp/4000000000";
const book = { title: "吾輩は猫である", authors: ["夏目漱石"], isbns: ["9784101010014"] };
const observed = (ownership, wanted) => ({ kind: "observed", ownership, wanted });
const settle = () => new Promise((resolve) => setImmediate(resolve));

// A toolbar that keeps each tab's tone, as chrome.action keeps each tab's icon.
function toolbar() {
  const tones = new Map();
  return {
    tones,
    show: async (tabId, badge) => {
      if (badge) tones.set(tabId, badge.tone);
      else tones.delete(tabId);
    },
    clearAll: async () => tones.clear(),
  };
}

// The worker over a Vault whose answers and saves the test releases one by one, and a consent the test sets.
function worker({ active = { tabId: 1, url: productUrl, product: book } } = {}) {
  const icon = toolbar();
  const answers = [];
  const saves = [];
  const consent = { agreed: true, given: async () => consent.agreed };
  const client = {
    send: () => {
      const answer = Promise.withResolvers();
      answers.push(answer);
      return answer.promise;
    },
    hasPending: async () => false,
    changeBook: () => {
      const save = Promise.withResolvers();
      saves.push(save);
      return save.promise;
    },
  };
  const operations = workerOperations({
    client,
    tabs: {
      active: async () => active,
      inTab: async () => active,
      show: async () => {},
      consentChanged: async () => {},
    },
    badges: new TabBadges(icon),
    consent,
    disclose: async () => {},
  });
  return { operations, tones: icon.tones, answers, saves, consent };
}

void test("a saved change marks its tab from a check afterwards, unless the tab or consent moved on meanwhile", async () => {
  // Nothing newer: the check after the save marks the tab.
  const kept = worker();
  kept.tones.set(1, "wanted");
  const purchase = kept.operations.change("purchase");
  await settle();
  kept.saves[0].resolve({ kind: "saved" });
  await settle();
  kept.answers[0].resolve(observed("sameEdition", true));
  assert.deepEqual(await purchase, { kind: "saved" });
  assert.equal(kept.tones.get(1), "owned");

  // The page moves off the book while the save is on its way.
  const moved = worker();
  moved.tones.set(1, "wanted");
  const wish = moved.operations.change("setWish");
  await settle();
  await moved.operations.unmark(1);
  moved.saves[0].resolve({ kind: "saved" });
  await settle();
  assert.equal(moved.answers.length, 0);
  assert.deepEqual(await wish, { kind: "saved" });
  assert.equal(moved.tones.has(1), false);

  // Consent is withdrawn while the save is on its way, and the marks are cleared.
  const withdrawn = worker();
  withdrawn.tones.set(1, "wanted");
  const bought = withdrawn.operations.change("purchase");
  await settle();
  withdrawn.consent.agreed = false;
  await withdrawn.operations.consentChanged();
  withdrawn.saves[0].resolve({ kind: "replayed" });
  await settle();
  assert.equal(withdrawn.answers.length, 0);
  assert.deepEqual(await bought, { kind: "replayed" });
  assert.deepEqual([...withdrawn.tones], []);

  // Even before the withdrawal's notice clears the marks, nothing more is asked of the Vault.
  const unnoticed = worker();
  const cleared = unnoticed.operations.change("clearWish");
  await settle();
  unnoticed.consent.agreed = false;
  unnoticed.saves[0].resolve({ kind: "saved" });
  await settle();
  assert.equal(unnoticed.answers.length, 0);
  assert.deepEqual(await cleared, { kind: "saved" });
});

void test("the dot says ownership before a wish, and nothing for a book neither owned nor wanted", () => {
  const cases = [
    [observed("sameEdition", false), "owned"],
    [observed("sameEdition", true), "owned"],
    [observed("otherEdition", false), "ownedUnconfirmed"],
    [observed("otherEdition", true), "ownedUnconfirmed"],
    [observed("unknownEdition", true), "ownedUnconfirmed"],
    [observed("unowned", true), "wanted"],
    [observed("unowned", false), undefined],
    [observed("undetermined", false), "unchecked"],
    [observed("undetermined", true), "unchecked"],
    [{ kind: "unreadable" }, "unchecked"],
    [{ kind: "unavailable" }, "unchecked"],
    [{ kind: "unauthorized" }, "unchecked"],
    [{ kind: "needsInput" }, "unchecked"],
    [consentRequired, undefined],
  ];
  for (const [reply, tone] of cases) {
    assert.equal(badgeFor(reply)?.tone, tone, JSON.stringify(reply));
    if (tone) assert.equal(badgeFor(reply).title, `Book Props：${statusLabel(reply, true)}`);
  }
});

void test("each tone draws its own colour, cut free from the glyph by a transparent ring", () => {
  const opaque = (size) => new Uint8ClampedArray(size * size * 4).fill(255);
  const pixel = (icon, size, x, y) => [
    ...icon.subarray((y * size + x) * 4, (y * size + x) * 4 + 4),
  ];
  const colours = {
    owned: [0x1e, 0x8e, 0x3e],
    ownedUnconfirmed: [0xf2, 0x99, 0x00],
    wanted: [0x1a, 0x73, 0xe8],
    unchecked: [0x80, 0x86, 0x8b],
  };
  for (const [tone, colour] of Object.entries(colours)) {
    const small = markIcon(opaque(16), tone);
    assert.deepEqual(pixel(small, 16, 12, 12), [...colour, 255], tone);
    // The 16-pixel dot is a crisp seven-pixel circle: full in its middle row, absent from its corner.
    assert.deepEqual(pixel(small, 16, 9, 12), [...colour, 255]);
    assert.equal(pixel(small, 16, 8, 12)[3], 0);
    assert.equal(pixel(small, 16, 15, 9)[3], 0);
    assert.deepEqual(pixel(small, 16, 2, 2), [255, 255, 255, 255]);

    const large = markIcon(opaque(32), tone);
    assert.deepEqual(pixel(large, 32, 24, 24), [...colour, 255]);
    assert.equal(pixel(large, 32, 17, 25)[3], 0);
    assert.deepEqual(pixel(large, 32, 4, 4), [255, 255, 255, 255]);
  }
});

void test("a check marks its tab, and an answer that a page load overtook marks nothing", async () => {
  const { operations, tones, answers } = worker();
  const checked = operations.check(book, 1);
  await settle();
  answers[0].resolve(observed("sameEdition", false));
  await checked;
  assert.equal(tones.get(1), "owned");

  // The tab starts loading another page while the next answer is on its way.
  const late = operations.check(book, 1);
  await settle();
  await operations.unmark(1);
  answers[1].resolve(observed("unowned", true));
  await late;
  assert.equal(tones.has(1), false);
});

void test("withdrawing consent removes every dot and drops answers still on their way", async () => {
  const { operations, tones, answers, consent } = worker();
  const first = operations.check(book, 1);
  await settle();
  answers[0].resolve(observed("unowned", true));
  await first;
  const second = operations.check(book, 2);
  await settle();
  assert.equal(tones.get(1), "wanted");

  // Consent given again changes nothing; a withdrawal clears every tab.
  await operations.consentChanged();
  assert.equal(tones.get(1), "wanted");
  consent.agreed = false;
  await operations.consentChanged();
  answers[1].resolve(observed("sameEdition", false));
  await second;
  assert.deepEqual([...tones], []);
});

void test("the popup's check marks the active tab, and a tab without a book loses its dot", async () => {
  const { operations, tones, answers } = worker();
  const inspected = operations.inspect();
  await settle();
  answers[0].resolve(observed("otherEdition", true));
  const state = await inspected;
  assert.equal(tones.get(1), "ownedUnconfirmed");
  // Only the title and authors reach the popup.
  assert.deepEqual(state.book, { title: book.title, authors: book.authors });

  const bare = worker({ active: { tabId: 1, url: productUrl } });
  bare.tones.set(1, "owned");
  const blank = await bare.operations.inspect();
  assert.equal(bare.tones.has(1), false);
  assert.equal("book" in blank, false);
});

void test("a page that moves within itself off the book it checked takes its dot away", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const sent = [];
  const page = { href: productUrl, book, url: () => page.href, product: () => page.book };
  const watch = new PageWatch(
    page,
    {
      consented: async () => true,
      check: async () => (sent.push("check"), observed("sameEdition", false)),
      unmark: async () => void sent.push("unmark"),
    },
    { show: () => {}, clear: () => {} },
    () => () => {},
  );
  await watch.refresh();
  t.mock.timers.tick(375);
  await settle();
  page.href = "https://www.amazon.co.jp/s?k=猫";
  watch.schedule();
  t.mock.timers.tick(375);
  await settle();
  // Nothing more to take away until the page checks a book again.
  page.href = "https://www.amazon.co.jp/dp/4000000001";
  page.book = undefined;
  watch.schedule();
  t.mock.timers.tick(375);
  await settle();
  assert.deepEqual(sent, ["check", "unmark"]);
});

void test("the popup shows the open book's title and authors only when the page shows a book", async () => {
  let controls;
  let state;
  const popup = new Popup(
    { inspect: async () => state, request: async () => ({ kind: "saved" }) },
    { permission: async () => undefined },
    { render: (shown) => (controls = shown), say: () => {}, lock: () => {} },
  );
  const heading = () => [controls.title, controls.authors];

  state = decodePageState({
    supported: true,
    book: { title: book.title, authors: ["夏目漱石", "編者"] },
    pending: false,
    reply: observed("unowned", false),
  });
  await popup.refresh();
  assert.deepEqual(heading(), [book.title, "夏目漱石、編者"]);

  state = { supported: true, pending: false, reply: { kind: "unavailable" } };
  await popup.refresh();
  assert.deepEqual(heading(), ["", ""]);
  // Without a book, purchase and wish stay off while opening Obsidian stays available for manual entry.
  assert.deepEqual(
    [controls.canPurchase, controls.canWish, controls.canOpen],
    [false, false, true],
  );

  state = { supported: false, book: { title: book.title }, pending: false, reply: consentRequired };
  await popup.refresh();
  assert.deepEqual(heading(), ["", ""]);
});
