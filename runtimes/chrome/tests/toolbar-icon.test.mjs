import assert from "node:assert/strict";
import test from "node:test";
import { toolbarIcon } from "../src/adapters/toolbar-icon.ts";

const noTab = (tabId) => `No tab with id: ${tabId}.`;

/**
 * Stands in for chrome.action as Chrome 157 behaves for a tab that no longer exists: setIcon's promise resolves
 * and the failure is only logged as an unchecked runtime.lastError, while its callback can read and so consume
 * the failure; setTitle's promise rejects. `failure` decides each call's error, if any.
 */
function withChromeAction(failure, run) {
  const unchecked = [];
  const runtime = { lastError: undefined };
  const settle = (message, callback) => {
    if (!callback) {
      if (message) unchecked.push(`Unchecked runtime.lastError: ${message}`);
      return Promise.resolve();
    }
    // Chrome sets lastError only while the callback runs, and logs it unless the callback read it.
    let read = false;
    queueMicrotask(() => {
      Object.defineProperty(runtime, "lastError", {
        configurable: true,
        get() {
          read = true;
          return message ? { message } : undefined;
        },
      });
      callback();
      Object.defineProperty(runtime, "lastError", { configurable: true, value: undefined });
      if (message && !read) unchecked.push(`Unchecked runtime.lastError: ${message}`);
    });
  };
  globalThis.chrome = {
    runtime,
    action: {
      setIcon: (details, callback) => settle(failure("setIcon", details.tabId), callback),
      async setTitle(details) {
        const message = failure("setTitle", details.tabId);
        if (message) throw new Error(message);
      },
    },
  };
  return run(unchecked).finally(() => delete globalThis.chrome);
}

void test("a tab that closed before its icon is drawn is passed over without an unchecked runtime.lastError", async () => {
  await withChromeAction(
    (_call, tabId) => noTab(tabId),
    async (unchecked) => {
      await toolbarIcon(() => new Uint8ClampedArray()).show(98649397, undefined);
      assert.deepEqual(unchecked, []);
    },
  );
});

void test("drawing a tab's icon fails on any other error", async () => {
  await withChromeAction(
    (call) => (call === "setIcon" ? "Icon invalid." : undefined),
    async (unchecked) => {
      await assert.rejects(toolbarIcon(() => new Uint8ClampedArray()).show(7, undefined), {
        message: "Icon invalid.",
      });
      assert.deepEqual(unchecked, []);
    },
  );
  await withChromeAction(
    (call) => (call === "setTitle" ? "Title invalid." : undefined),
    async () => {
      await assert.rejects(toolbarIcon(() => new Uint8ClampedArray()).show(7, undefined), {
        message: "Title invalid.",
      });
    },
  );
});
