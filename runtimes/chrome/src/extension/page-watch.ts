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
/** The worker as a product page reaches it; each call throws when the worker cannot be reached. */
export type PageWorker = {
  /** Whether the user consents now. */
  consented(): Promise<boolean>;
  /** Asks about a book, and has the tab's toolbar icon marked with the answer. */
  check(book: Product): Promise<Reply>;
  /** Removes the tab's mark, because the page no longer shows the book it checked. */
  unmark(): Promise<void>;
};
export type Toast = { show(text: string, duration: number): void; clear(): void };
/** Starts calling `changed` whenever the page may show another book, and returns how to stop. */
export type PageChanges = (changed: () => void) => () => void;

// Product pages redraw in bursts; one check covers the whole burst.
const settleDelay = 375;

/** Checks the book on a product page once its details settle, and shows the answer as a toast; reads nothing until the user consents. */
export class PageWatch {
  private readonly page: ProductPage;
  private readonly worker: PageWorker;
  private readonly toast: Toast;
  private readonly changes: PageChanges;
  private last = "";
  // Whether the tab may carry a mark for a book this page checked.
  private marked = false;
  private scheduled = false;
  private reading = false;
  private asked = 0;
  private stopWatching: () => void = () => undefined;

  constructor(page: ProductPage, worker: PageWorker, toast: Toast, changes: PageChanges) {
    this.page = page;
    this.worker = worker;
    this.toast = toast;
    this.changes = changes;
  }

  /**
   * Asks again whether the user consents, at start and after each change, and follows only the newest answer:
   * an older answer that a withdrawal overtook must not restart reading. An unreachable worker counts as no consent.
   */
  refresh = async (): Promise<void> => {
    const ticket = ++this.asked;
    const given = await this.worker.consented().catch(() => false);
    if (ticket === this.asked) this.follow(given);
  };

  /** Stops reading while the page is hidden, and drops any answer still on its way, until `refresh` asks again. */
  suspend = (): void => {
    this.asked++;
    this.follow(false);
  };

  // When reading stops, the worker clears the marks itself: on withdrawal for every tab, and on leaving for this one.
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
    this.marked = false;
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
    const book = siteOf(url) ? this.page.product() : undefined;
    const key = book ? JSON.stringify([url, book]) : "";
    if (key === this.last) return;
    this.last = key;
    this.toast.clear();
    if (!book) {
      // The page moved within itself away from the book it checked, so its mark no longer applies.
      if (this.marked) void this.worker.unmark().catch(() => undefined);
      this.marked = false;
      return;
    }
    this.marked = true;
    const reply = await this.worker.check(book).catch((): Reply => unavailable);
    if (this.last === key && this.page.url() === url) this.show(reply, false);
  }
}
