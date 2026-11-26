import type { PageTabs } from "../extension/worker-operations.ts";
import { decodePageAnswer, type TabMessage } from "./wire.ts";

// Only the content script in a tab's top frame speaks for its page.
const topFrame = { frameId: 0 };

async function askTab(tabId: number): Promise<unknown> {
  const answer: unknown = await chrome.tabs.sendMessage(
    tabId,
    { kind: "product" } satisfies TabMessage,
    topFrame,
  );
  return answer;
}

/** Reaches product page content scripts from the worker. */
export const pageTabs: PageTabs = {
  async active() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return {};
    try {
      return decodePageAnswer(await askTab(tab.id));
    } catch {
      return {};
    }
  },
  async inTab(tabId) {
    return decodePageAnswer(await askTab(tabId));
  },
  async show(tabId, url, reply) {
    await chrome.tabs.sendMessage(
      tabId,
      { kind: "show", url, reply } satisfies TabMessage,
      topFrame,
    );
  },
  // Tabs without a content script reject the message, which only means there is nobody to tell.
  async consentChanged() {
    const tabs = await chrome.tabs.query({});
    await Promise.allSettled(
      tabs.flatMap(({ id }) =>
        id ? [chrome.tabs.sendMessage(id, { kind: "consent" } satisfies TabMessage, topFrame)] : [],
      ),
    );
  },
};
