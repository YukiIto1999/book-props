import { extractProduct } from "@book-props/book-products";
import { product } from "@book-props/vault-contract";
import type { PageChanges, ProductPage } from "../extension/page-watch.ts";

// Parts of supported product pages that are redrawn when the shown book changes.
const productParts =
  '#productTitle,#bylineInfo, #detailBullets_feature_div, [id^="rpi-attribute-book_details"], h1[itemprop="name"], .productInfo, .productInformation__title';

/** The document the content script runs in. */
export const productPage: ProductPage = {
  url: () => location.href,
  // Only schema-valid evidence leaves the page; anything else counts as an unidentified book.
  product() {
    const parsed = product.safeParse(extractProduct(document));
    return parsed.success ? parsed.data : undefined;
  },
};

/** Calls `changed` when the page navigates within itself or redraws its product details, until stopped. */
export const watchProductPage: PageChanges = (changed) => {
  let lastUrl = "";
  const watch = new MutationObserver((events) => {
    const changedProduct = events.some(
      (event) => event.target instanceof Element && event.target.closest(productParts),
    );
    if (location.href !== lastUrl || changedProduct) {
      lastUrl = location.href;
      changed();
    }
  });
  watch.observe(document.body, { childList: true, characterData: true, subtree: true });
  window.addEventListener("popstate", changed);
  window.addEventListener("pageshow", changed);
  return () => {
    watch.disconnect();
    window.removeEventListener("popstate", changed);
    window.removeEventListener("pageshow", changed);
  };
};
