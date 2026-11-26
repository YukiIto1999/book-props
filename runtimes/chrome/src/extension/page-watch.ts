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
/** Starts calling `changed` whenever the page may show another book, and returns how to stop. */
export type PageChanges = (changed: () => void) => () => void;
/** Asks whether the user consents now; throws when the worker cannot be reached. */
export type ConsentQuery = () => Promise<boolean>;

// Product pages redraw in bursts; one check covers the whole burst.
const settleDelay = 375;

/** Checks the book on a product page once its details settle, and shows the answer as a toast; reads nothing until the user consents. */
export class PageWatch {
  private readonly page: ProductPage;
  private readonly check: BookCheck;
  private readonly toast: Toast;
  private readonly changes: PageChanges;
  private readonly ask: ConsentQuery;
  private last = "";
  private scheduled = false;
  private reading = false;
  private asked = 0;
  private stopWatching: () => void = () => undefined;

  constructor(
    page: ProductPage,
    check: BookCheck,
    toast: Toast,
    changes: PageChanges,
    ask: ConsentQuery,
  ) {
    this.page = page;
    this.check = check;
    this.toast = toast;
    this.changes = changes;
    this.ask = ask;
  }

  /**
   * Asks again whether the user consents, at start and after each change, and follows only the newest answer:
   * an older answer that a withdrawal overtook must not restart reading. An unreachable worker counts as no consent.
   */
  refresh = async (): Promise<void> => {
    const ticket = ++this.asked;
    const given = await this.ask().catch(() => false);
    if (ticket === this.asked) this.follow(given);
  };

  private follow(given: boolean): void {
    if (given === this.reading) return;
    this.reading = given;
    if (given) {
      this.stopWatching = this.changes(this.schedule);
      this.schedule();
      return;
    }
    this.stopWatching();
    this.last = "";
    this.toast.clear();
  }

  schedule = (): void => {
    if (!this.reading || this.scheduled) return;
    this.scheduled = true;
    setTimeout(() => {
      this.scheduled = false;
      if (this.reading) void this.lookup();
    }, settleDelay);
  };

  describe = (): PageAnswer => {
    if (!this.reading) return {};
    const url = this.page.url();
    const book = this.page.product();
    return { ...(siteOf(url) ? { url } : {}), ...(book ? { product: book } : {}) };
  };

  /** Shows a re-check the user asked for, unless the tab has moved on to another page. */
  showRecheck = (url: string, reply: Reply): void => {
    if (this.reading && url === this.page.url()) this.show(reply, true);
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
