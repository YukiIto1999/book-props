import { product, type Product } from "@book-props/vault-contract";
import { extractProduct, siteOf } from "@book-props/book-products";
import { decodeResponse, messageField } from "./messages.ts";
import { statusLabel } from "./status.ts";

let last = "";
let toast: HTMLElement | undefined;
let auto: number | undefined;
// Important :host rules outrank the page's own CSS, and page selectors cannot reach into the shadow tree.
const toastStyle = new CSSStyleSheet();
toastStyle.replaceSync(
  ":host{all:initial!important;position:fixed!important;top:16px!important;right:16px!important;z-index:2147483647!important;max-width:calc(100vw - 32px)!important;pointer-events:none!important}" +
    "[role=status]{font:600 14px/1.45 system-ui,sans-serif;color:white;background:#23262d;padding:10px 14px;border-radius:8px;box-shadow:0 2px 12px #0005}",
);

function show(reply: unknown, manual: boolean): void {
  const text = statusLabel(decodeResponse(reply, { kind: "unavailable" }), manual);
  if (!text) return;
  toast?.remove();
  const host = document.createElement("div");
  const root = host.attachShadow({ mode: "open" });
  root.adoptedStyleSheets = [toastStyle];
  const body = root.appendChild(document.createElement("div"));
  body.setAttribute("role", "status");
  body.textContent = text;
  document.body.append(host);
  toast = host;
  window.setTimeout(() => host.remove(), manual ? 6500 : 4500);
}

// Only schema-valid evidence leaves the page; anything else counts as an unidentified book.
function pageProduct(): Product | undefined {
  const parsed = product.safeParse(extractProduct(document));
  return parsed.success ? parsed.data : undefined;
}

async function lookup(): Promise<void> {
  const url = location.href;
  if (!siteOf(url)) {
    toast?.remove();
    last = "";
    return;
  }
  const book = pageProduct();
  const key = JSON.stringify([url, book]);
  if (key === last) return;
  last = key;
  toast?.remove();
  if (!book) return;
  try {
    const reply: unknown = await chrome.runtime.sendMessage({ kind: "check", product: book });
    if (last === key && location.href === url) show(reply, false);
  } catch {
    if (last === key && location.href === url) show({ kind: "unavailable" }, false);
  }
}

function schedule(): void {
  if (auto !== undefined) return;
  auto = window.setTimeout(() => {
    auto = undefined;
    void lookup();
  }, 375);
}

chrome.runtime.onMessage.addListener((message: unknown, sender, reply) => {
  if (sender.id !== chrome.runtime.id) return;
  const kind = messageField(message, "kind");
  if (kind === "product")
    reply({ url: siteOf(location.href) ? location.href : undefined, product: pageProduct() });
  else if (kind === "show" && messageField(message, "url") === location.href)
    show(messageField(message, "reply"), true);
});

let lastMutationCheck = "";
const watch = new MutationObserver((events) => {
  const changedProduct = events.some(
    (event) =>
      event.target instanceof Element &&
      event.target.closest(
        '#productTitle,#bylineInfo, #detailBullets_feature_div, [id^="rpi-attribute-book_details"], h1[itemprop="name"], .productInfo, .productInformation__title',
      ),
  );
  if (location.href !== lastMutationCheck || changedProduct) {
    lastMutationCheck = location.href;
    schedule();
  }
});
watch.observe(document.body, { childList: true, characterData: true, subtree: true });
window.addEventListener("popstate", schedule);
window.addEventListener("pageshow", schedule);
schedule();
