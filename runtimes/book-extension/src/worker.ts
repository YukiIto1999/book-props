import { product, type Product } from "@book-props/vault-contract";
import { siteOf } from "@book-props/book-products";
import { messageField, type PageState } from "./messages.ts";
import { VaultClient, unavailable, type BookChange } from "./vault-client.ts";
import { exchange } from "./vault-transport.ts";

const {
  changeBook,
  connectionStatus,
  disconnect,
  forgetPending,
  hasPending,
  pair,
  reconcilePending,
  send,
} = new VaultClient(exchange);

type PageAnswer = { product?: Product; url?: string };
const checkMenuId = "book-props-check";

function decodePageAnswer(answer: unknown): PageAnswer {
  const extracted = product.safeParse(messageField(answer, "product"));
  const url = messageField(answer, "url");
  return {
    product: extracted.success ? extracted.data : undefined,
    url: typeof url === "string" && siteOf(url) ? url : undefined,
  };
}

async function activePage(): Promise<PageAnswer> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return {};
  try {
    const answer: unknown = await chrome.tabs.sendMessage(
      tab.id,
      { kind: "product" },
      { frameId: 0 },
    );
    return decodePageAnswer(answer);
  } catch {
    return {};
  }
}

async function inspectPage(page: PageAnswer): Promise<PageState> {
  const pending = await hasPending();
  const reply = page.product
    ? await send({ action: "inspect", product: page.product })
    : unavailable;
  return { supported: Boolean(page.url), hasBook: Boolean(page.product), pending, reply };
}

function isBookChange(kind: string): kind is BookChange {
  return kind === "purchase" || kind === "setWish" || kind === "clearWish";
}

async function popupRequest(kind: string): Promise<unknown> {
  if (kind === "reconcile") return reconcilePending();
  if (kind === "forget") return forgetPending();
  const page = await activePage();
  if (kind === "inspect") return inspectPage(page);
  if (kind === "open") return send({ action: "open", product: page.product ?? {} });
  if (!page.product || !isBookChange(kind)) return unavailable;
  return changeBook(kind, page.product);
}

async function optionsRequest(kind: string, message: unknown): Promise<unknown> {
  if (kind === "status") return connectionStatus();
  if (kind === "pair") return pair(messageField(message, "pairing"));
  if (kind === "disconnect") return disconnect();
  return unavailable;
}

async function productPageRequest(kind: string, message: unknown): Promise<unknown> {
  if (kind !== "check") return unavailable;
  const book = product.safeParse(messageField(message, "product"));
  return book.success ? send({ action: "inspect", product: book.data }) : unavailable;
}

function isProductPage(sender: chrome.runtime.MessageSender): boolean {
  return Boolean(sender.tab && sender.url && siteOf(sender.url) && sender.frameId === 0);
}

async function receive(message: unknown, sender: chrome.runtime.MessageSender): Promise<unknown> {
  const kind = messageField(message, "kind");
  if (sender.id !== chrome.runtime.id || typeof kind !== "string") return unavailable;
  if (isProductPage(sender)) return productPageRequest(kind, message);
  if (sender.url === chrome.runtime.getURL("options.html")) return optionsRequest(kind, message);
  if (sender.url === chrome.runtime.getURL("popup.html")) return popupRequest(kind);
  return unavailable;
}

async function recheckPage(tabId: number, pageUrl: string): Promise<void> {
  const answer: unknown = await chrome.tabs.sendMessage(tabId, { kind: "product" }, { frameId: 0 });
  const page = decodePageAnswer(answer);
  if (page.url !== pageUrl) return;
  const reply = page.product
    ? await send({ action: "inspect", product: page.product })
    : unavailable;
  await chrome.tabs.sendMessage(tabId, { kind: "show", url: pageUrl, reply }, { frameId: 0 });
}

chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
  void receive(message, sender).then(respond, () => respond(unavailable));
  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: checkMenuId,
    title: "Book Props: 所有と購入希望を再確認",
    contexts: ["page"],
    documentUrlPatterns: [
      "https://www.amazon.co.jp/*dp/*",
      "https://www.amazon.co.jp/*gp/product/*",
      "https://books.rakuten.co.jp/rb/*",
      "https://www.valuebooks.jp/*/bp/*",
      "https://shopping.bookoff.co.jp/used/*",
      "https://shopping.bookoff.co.jp/new/*",
    ],
  });
});

chrome.contextMenus.onClicked.addListener((clicked, tab) => {
  const tabId = tab?.id;
  const { pageUrl } = clicked;
  if (clicked.menuItemId !== checkMenuId || !tabId || !pageUrl || !siteOf(pageUrl)) return;
  void recheckPage(tabId, pageUrl).catch(() => undefined);
});
