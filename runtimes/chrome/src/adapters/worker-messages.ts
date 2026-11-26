import { siteOf } from "@book-props/book-products";
import { product } from "@book-props/vault-contract";
import { unavailable, type BookChange } from "../extension/outcomes.ts";
import type { WorkerOperations } from "../extension/worker-operations.ts";
import { messageField } from "./wire.ts";

function isBookChange(kind: string): kind is BookChange {
  return kind === "purchase" || kind === "setWish" || kind === "clearWish";
}

// Content scripts are trusted only in the top frame of a supported product page.
function isProductPage(sender: chrome.runtime.MessageSender): boolean {
  return Boolean(sender.tab && sender.url && siteOf(sender.url) && sender.frameId === 0);
}

async function productPageRequest(
  operations: WorkerOperations,
  kind: string,
  message: unknown,
): Promise<unknown> {
  if (kind !== "check") return unavailable;
  const book = product.safeParse(messageField(message, "product"));
  return book.success ? operations.check(book.data) : unavailable;
}

async function optionsRequest(
  operations: WorkerOperations,
  kind: string,
  message: unknown,
): Promise<unknown> {
  if (kind === "status") return operations.status();
  if (kind === "disconnect") return operations.disconnect();
  if (kind !== "pair") return unavailable;
  const grantId = messageField(message, "grantId");
  return typeof grantId === "string" ? operations.pair(grantId) : { kind: "invalidRequest" };
}

async function popupRequest(operations: WorkerOperations, kind: string): Promise<unknown> {
  if (kind === "reconcile") return operations.reconcile();
  if (kind === "forget") return operations.forget();
  if (kind === "inspect") return operations.inspect();
  if (kind === "open") return operations.open();
  return isBookChange(kind) ? operations.change(kind) : unavailable;
}

// The sender decides which operations a message may reach; the payload's own claims never do.
async function receive(
  operations: WorkerOperations,
  message: unknown,
  sender: chrome.runtime.MessageSender,
): Promise<unknown> {
  const kind = messageField(message, "kind");
  if (sender.id !== chrome.runtime.id || typeof kind !== "string") return unavailable;
  // A content script asks before it reads anything, even on a page that may navigate within itself to a product.
  if (kind === "consent" && sender.tab && sender.frameId === 0)
    return { given: await operations.consented() };
  if (isProductPage(sender)) return productPageRequest(operations, kind, message);
  if (sender.url === chrome.runtime.getURL("options.html"))
    return optionsRequest(operations, kind, message);
  if (sender.url === chrome.runtime.getURL("popup.html")) return popupRequest(operations, kind);
  return unavailable;
}

/** Answers the extension's pages and content scripts in the worker. */
export function answerPages(operations: WorkerOperations): void {
  chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
    void receive(operations, message, sender).then(respond, () => respond(unavailable));
    return true;
  });
}
