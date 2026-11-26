import { siteOf } from "@book-props/book-products";

const checkMenuId = "book-props-check";

/** Offers a manual re-check from the page's context menu on product pages. */
export function offerRecheck(recheck: (tabId: number, pageUrl: string) => Promise<void>): void {
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
    void recheck(tabId, pageUrl).catch(() => undefined);
  });
}
