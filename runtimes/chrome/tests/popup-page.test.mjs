import assert from "node:assert/strict";
import test from "node:test";
import { pageChanged } from "../src/extension/outcomes.ts";
import { isPageKey } from "../src/extension/page-key.ts";
import { Popup } from "../src/extension/popup.ts";
import { statusLabel } from "../src/extension/status.ts";
import { book, observed, productUrl, stubWorker } from "./page-stubs.mjs";

const other = { title: "坊っちゃん", authors: ["夏目漱石"], isbns: ["9784101010021"] };

// A popup that reaches the stub worker as the popup's messages reach the real one.
function popupOver(worker) {
  const shown = { said: [] };
  const popup = new Popup(
    {
      inspect: () => worker.operations.inspect(),
      request: (action, page) =>
        action === "open"
          ? worker.operations.open(page)
          : action === "reconcile" || action === "forget"
            ? worker.operations[action]()
            : worker.operations.change(action, page),
    },
    { permission: async () => undefined },
    {
      render: (controls) => (shown.controls = controls),
      say: (text) => shown.said.push(text),
      lock: () => {},
    },
  );
  return { popup, shown };
}

void test("an action on a book the tab no longer shows writes nothing and shows the tab's book", async () => {
  for (const [label, act] of [
    ["purchase", (popup) => popup.act("purchase")],
    ["setWish", (popup) => popup.toggleWish()],
    ["open", (popup) => popup.act("open")],
  ]) {
    const worker = stubWorker({ reply: observed("unowned", false) });
    const { popup, shown } = popupOver(worker);
    await popup.refresh();
    assert.equal(shown.controls.title, book.title, label);

    // The same tab now shows another book, as after a move within the page or a redraw of its product.
    worker.tab.active = { tabId: 1, url: `${productUrl}?variant`, product: other };
    worker.sent.length = 0;
    await act(popup);
    assert.equal(worker.saves.length, 0, label);
    assert.deepEqual(worker.sent, ["inspect"], label);
    assert.equal(shown.said.at(-1), statusLabel(pageChanged, true), label);
    assert.equal(shown.controls.title, other.title, label);
  }
});

void test("an action on the book the popup shows still runs", async () => {
  const worker = stubWorker({ reply: observed("unowned", false) });
  const { popup, shown } = popupOver(worker);
  await popup.refresh();
  await popup.act("purchase");
  assert.equal(worker.saves.length, 1);
  assert.equal(shown.said.at(-1), statusLabel({ kind: "saved" }, true));

  worker.sent.length = 0;
  await popup.act("open");
  assert.deepEqual(worker.sent.slice(0, 1), ["open"]);
});

void test("a wish the Vault already holds is shown as wanted, not as saved", async () => {
  const worker = stubWorker({
    reply: observed("unowned", false),
    changed: observed("unowned", true),
  });
  const { popup, shown } = popupOver(worker);
  await popup.refresh();
  await popup.toggleWish();
  assert.equal(worker.saves.length, 1);
  assert.equal(shown.said.at(-1), "欲しいに登録済み");
});

void test("another active tab, or a page name that is missing or malformed, counts as a changed page", async () => {
  const worker = stubWorker({ reply: observed("unowned", false) });
  const shownKey = await worker.key();
  // Another tab showing the very same book is still another page.
  worker.tab.active = { ...worker.tab.active, tabId: 2 };
  assert.deepEqual(await worker.operations.change("purchase", shownKey), pageChanged);
  assert.deepEqual(await worker.operations.open(shownKey), pageChanged);
  assert.deepEqual(await worker.operations.change("setWish", undefined), pageChanged);
  assert.equal(worker.saves.length, 0);
  assert.deepEqual(worker.sent, []);

  assert.equal(isPageKey(shownKey), true);
  for (const malformed of [undefined, "", "page", shownKey.toUpperCase(), `${shownKey}0`, 1])
    assert.equal(isPageKey(malformed), false);
});
