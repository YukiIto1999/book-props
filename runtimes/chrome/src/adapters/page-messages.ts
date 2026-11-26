import type { Product } from "@book-props/vault-contract";
import { unavailable, type PageAnswer, type Reply } from "../extension/outcomes.ts";
import { decodeResponse, messageField, type PageMessage } from "./wire.ts";

/** Asks the worker about the book on this page. */
export async function checkWithWorker(book: Product): Promise<Reply> {
  const reply: unknown = await chrome.runtime.sendMessage({
    kind: "check",
    product: book,
  } satisfies PageMessage);
  return decodeResponse(reply, unavailable);
}

/** Answers the worker's questions to this tab: which book it shows, and a re-check result to show. */
export function answerWorker(page: {
  describe(): PageAnswer;
  showRecheck(url: string, reply: Reply): void;
}): void {
  chrome.runtime.onMessage.addListener((message: unknown, sender, reply) => {
    if (sender.id !== chrome.runtime.id) return;
    const kind = messageField(message, "kind");
    const url = messageField(message, "url");
    if (kind === "product") reply(page.describe());
    else if (kind === "show" && typeof url === "string")
      page.showRecheck(url, decodeResponse(messageField(message, "reply"), unavailable));
  });
}
