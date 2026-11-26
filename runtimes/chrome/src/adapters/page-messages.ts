import { unavailable, type PageAnswer, type Reply } from "../extension/outcomes.ts";
import type { PageWorker } from "../extension/page-watch.ts";
import { decodeConsent, decodeResponse, messageField, type PageMessage } from "./wire.ts";

/** Reaches the worker from a product page's content script. */
export const pageWorker: PageWorker = {
  async consented() {
    const answer: unknown = await chrome.runtime.sendMessage({
      kind: "consent",
    } satisfies PageMessage);
    return decodeConsent(answer);
  },
  async check(book) {
    const reply: unknown = await chrome.runtime.sendMessage({
      kind: "check",
      product: book,
    } satisfies PageMessage);
    return decodeResponse(reply, unavailable);
  },
  async unmark() {
    await chrome.runtime.sendMessage({ kind: "unmark" } satisfies PageMessage);
  },
};

/** Answers the worker's messages to this tab: which book it shows, a re-check result to show, and that consent changed. */
export function answerWorker(page: {
  describe(): PageAnswer;
  showRecheck(url: string, reply: Reply): void;
  refresh(): Promise<void>;
}): void {
  chrome.runtime.onMessage.addListener((message: unknown, sender, reply) => {
    if (sender.id !== chrome.runtime.id) return;
    const kind = messageField(message, "kind");
    const url = messageField(message, "url");
    if (kind === "product") reply(page.describe());
    else if (kind === "consent") void page.refresh();
    else if (kind === "show" && typeof url === "string")
      page.showRecheck(url, decodeResponse(messageField(message, "reply"), unavailable));
  });
}
