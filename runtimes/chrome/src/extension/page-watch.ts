import { siteOf } from "@book-props/book-products";
import type { Product } from "@book-props/vault-contract";
import { unavailable, type PageAnswer, type Reply } from "./outcomes.ts";
import { statusLabel } from "./status.ts";

/** The page the content script runs in. */
export type ProductPage = {
  url(): string;
  /** The schema-valid book the page shows, if any. */
  product(): Product | undefined;
};
/** Asks the worker about a book; throws when the worker cannot be reached. */
export type BookCheck = (book: Product) => Promise<Reply>;
export type Toast = { show(text: string, duration: number): void; clear(): void };

// Product pages redraw in bursts; one check covers the whole burst.
const settleDelay = 375;

/** Checks the book on a product page once its details settle, and shows the answer as a toast. */
export class PageWatch {
  private readonly page: ProductPage;
  private readonly check: BookCheck;
  private readonly toast: Toast;
  private last = "";
  private scheduled = false;

  constructor(page: ProductPage, check: BookCheck, toast: Toast) {
    this.page = page;
    this.check = check;
    this.toast = toast;
  }

  schedule = (): void => {
    if (this.scheduled) return;
    this.scheduled = true;
    setTimeout(() => {
      this.scheduled = false;
      void this.lookup();
    }, settleDelay);
  };

  describe = (): PageAnswer => {
    const url = this.page.url();
    const book = this.page.product();
    return { ...(siteOf(url) ? { url } : {}), ...(book ? { product: book } : {}) };
  };

  /** Shows a re-check the user asked for, unless the tab has moved on to another page. */
  showRecheck = (url: string, reply: Reply): void => {
    if (url === this.page.url()) this.show(reply, true);
  };

  private show(reply: Reply, manual: boolean): void {
    const text = statusLabel(reply, manual);
    if (text) this.toast.show(text, manual ? 6500 : 4500);
  }

  private async lookup(): Promise<void> {
    const url = this.page.url();
    if (!siteOf(url)) {
      this.toast.clear();
      this.last = "";
      return;
    }
    const book = this.page.product();
    const key = JSON.stringify([url, book]);
    if (key === this.last) return;
    this.last = key;
    this.toast.clear();
    if (!book) return;
    const reply = await this.check(book).catch((): Reply => unavailable);
    if (this.last === key && this.page.url() === url) this.show(reply, false);
  }
}
