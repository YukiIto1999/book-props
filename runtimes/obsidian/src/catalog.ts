import type { Product as WireProduct } from "@book-props/vault-contract";
import { createBookNote, writeBookUpdate, type BookRecord } from "./book-note.ts";
import { manageBooks, type Management, type ManagementResult } from "./book-management.ts";
import {
  bookUpdate,
  CatalogRules,
  newBookRecord,
  type Commit,
  type Stamp,
} from "./catalog-core.ts";
import { importNotes, pruneReceipts, type ImportResult } from "./catalog-maintenance.ts";
import {
  assertUnchanged,
  CatalogChanged,
  confirmedWrite,
  hasPendingMove,
  inputHash,
  Refuse,
  type Write,
  type WriteProgress,
} from "./catalog-purchase.ts";
import { readCatalog, readEntries, readEntry, readFailure, readStable } from "./catalog-read.ts";
import { missingMoveCopies, settledShelf, type MoveCopies } from "./edition-recovery.ts";
import { optionalField } from "./optional-field.ts";
import { PortableLibrary } from "./portable-library.ts";
import type { Action, CatalogCore, IsbnList, Outcome } from "./wasm.ts";

export type { Action, Outcome } from "./wasm.ts";

/** 拡張から届く書誌と同じ形に、登録画面で扱う購入の記録を加えたもの。 */
export type Product = Readonly<
  WireProduct & {
    purchasedOn?: string;
    purchasedFrom?: string;
  }
>;
export type PurchaseKey = Readonly<{ clientId: string; requestId: string; issuedAt: number }>;
export type Selection = Readonly<{ bookId: string; editionId?: string }>;
export type Operation = Readonly<{
  action: Action;
  product: Product;
  purchase?: PurchaseKey;
  selection?: Selection;
}>;
export type StoredBook = Readonly<{ path: string; book: BookRecord }>;
export type Result =
  | { kind: "observed"; outcome: Outcome; path?: string | undefined }
  | { kind: "needsInput"; outcome: Outcome }
  | { kind: "saved"; bookId: string; editionId?: string }
  | { kind: "replayed"; bookId: string; editionId: string }
  | { kind: "unreadable"; path: string; reason: string }
  | { kind: "unknown" | "unavailable" | "conflict" | "notSaved" };
export interface BookFiles {
  readonly moveCopies: MoveCopies;
  versions(): ReadonlyMap<string, string>;
  read(path: string): Promise<string>;
  process(path: string, update: (raw: string, currentPath: string) => string): Promise<string>;
  create(bookId: string, raw: string): Promise<string>;
  canUpdate(path: string, latest: string): boolean;
}
type Request = Pick<Write, "operation" | "signal" | "hash">;

export class Catalog {
  private tail: Promise<unknown> = Promise.resolve();
  private accepting = true;

  private readonly files: BookFiles;
  private readonly rules: CatalogRules;
  private readonly portable: PortableLibrary;

  constructor(files: BookFiles, core: CatalogCore) {
    this.files = files;
    this.rules = new CatalogRules(core);
    this.portable = new PortableLibrary(core);
  }

  async entries(): Promise<StoredBook[]> {
    return (await readCatalog(this.files)).value;
  }
  moveCopiesMissingFrom(entries: readonly StoredBook[]) {
    return missingMoveCopies(this.rules, this.files.moveCopies, entries);
  }
  shelf(): Promise<{ entries: StoredBook[]; moving: boolean }> {
    return this.serial(async () => {
      if (!this.accepting) throw new Refuse("unavailable");
      const versions = this.files.versions();
      const entries = await readEntries(this.files, versions.keys());
      assertUnchanged(versions, this.files.versions());
      return settledShelf(this.rules, entries);
    });
  }

  async preview(operation: Operation): Promise<Result> {
    try {
      const entries = await this.entries();
      if (!this.accepting || hasPendingMove(entries)) return { kind: "unavailable" };
      return { kind: "observed", outcome: this.rules.inspect(operation, entries) };
    } catch (error: unknown) {
      return readFailure(error) ?? { kind: "unavailable" };
    }
  }

  normalizeIsbns(isbns: readonly string[]): IsbnList {
    return this.rules.normalizeIsbns(isbns);
  }

  /** 人が書いた実在する日付をYYYY-MM-DDにする。実在しない日付なら`undefined`。 */
  calendarDate(value: string): string | undefined {
    return this.rules.calendarDate(value);
  }

  async reconcile(operation: Operation, signal?: AbortSignal): Promise<Result> {
    const { purchase } = operation;
    if (
      this.halted(signal) ||
      operation.action !== "purchase" ||
      !purchase ||
      !this.rules.admits(operation)
    )
      return { kind: "unknown" };
    try {
      const { value: entries } = await readCatalog(this.files, signal);
      const hash = await inputHash(operation);
      if (this.halted(signal)) return { kind: "unknown" };
      return this.rules.reconcile(purchase, hash, entries);
    } catch {
      return { kind: "unknown" };
    }
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.tail.then(work);
    this.tail = next.catch(() => undefined);
    return next;
  }

  manage(command: Management): Promise<ManagementResult> {
    return this.serial(() => manageBooks(this.managementContext, command));
  }

  private get managementContext() {
    return { files: this.files, rules: this.rules, active: () => this.accepting };
  }

  exportLibrary(): Promise<string> {
    return this.serial(async () => {
      if (!this.accepting) throw new Refuse("unavailable");
      const { value: markdown } = await readStable(this.files, async (versions) => {
        const entries = await readEntries(this.files, versions.keys());
        if (hasPendingMove(entries)) throw new Refuse("conflict");
        return Promise.all(entries.map(({ path }) => this.files.read(path)));
      });
      return this.portable.encode(markdown);
    });
  }

  importLibrary(json: string): Promise<ImportResult> {
    const desired = this.portable.decode(json);
    return this.serial(() => importNotes(this.managementContext, desired));
  }

  maintain(): Promise<void> {
    return this.serial(async () => {
      if (!this.accepting) return;
      try {
        const initial = await this.entries();
        for (const { book } of initial) {
          if (book.pendingMove) {
            await manageBooks(this.managementContext, { action: "recoverMove", bookId: book.id });
          }
        }
        const entries = hasPendingMove(initial) ? await this.entries() : initial;
        const now = Date.now();
        if (!hasPendingMove(entries))
          await pruneReceipts(this.managementContext, entries, (receipts) =>
            this.rules.expired(receipts, now),
          );
      } catch {
        return;
      }
    });
  }

  stop(): Promise<unknown> {
    this.accepting = false;
    return this.tail;
  }

  execute(operation: Operation, signal?: AbortSignal): Promise<Result> {
    if (operation.action === "inspect") return this.run(operation, signal);
    return this.serial(() => this.run(operation, signal));
  }

  private halted(signal: AbortSignal | undefined): boolean {
    return !this.accepting || signal?.aborted === true;
  }

  private async run(operation: Operation, signal?: AbortSignal): Promise<Result> {
    const progress: WriteProgress = { started: false };
    try {
      if (this.halted(signal) || !this.rules.admits(operation)) return { kind: "notSaved" };
      const hash = operation.purchase && (await inputHash(operation));
      const step = await this.prepare({ operation, signal, hash });
      if (step.kind !== "write") return step;
      return await this.commitWrite(step, progress);
    } catch (error: unknown) {
      if (progress.started) return { kind: "unknown" };
      if (this.halted(signal)) return { kind: "notSaved" };
      return readFailure(error) ?? { kind: error instanceof Refuse ? error.kind : "unavailable" };
    }
  }

  private async commitWrite(step: Write, progress: WriteProgress): Promise<Result> {
    let plan = step;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const path = await this.write(plan, progress);
        return await confirmedWrite(this.files, path, plan, progress.change);
      } catch (error: unknown) {
        if (!(error instanceof CatalogChanged) || progress.started) throw error;
        if (attempt !== 0) return { kind: "conflict" };
        const refreshed = await this.refreshPlan(plan, plan.commit);
        if (refreshed.kind !== "write") return refreshed;
        plan = refreshed;
      }
    }
    return { kind: "conflict" };
  }

  /** 判定を二度読み、変わっていなければ書き込む内容を決める。書き込まない場合は結果を返す。 */
  private async prepare(request: Request): Promise<Result | Write> {
    const { operation, signal, hash } = request;
    const { value: entries } = await readCatalog(this.files, signal);
    if (this.halted(signal)) return { kind: "notSaved" };
    const stamp: Stamp = {
      now: Date.now(),
      newBookId: crypto.randomUUID(),
      newEditionId: crypto.randomUUID(),
    };
    const plan = this.rules.plan(operation, entries, hash, stamp);
    if (plan.kind === "observed" && operation.action === "inspect") {
      const path = entries.find(({ book }) => book.id === plan.outcome.bookId)?.path;
      return { ...plan, path };
    }
    if (plan.kind !== "write") return plan;
    return this.refreshPlan(request, { ...stamp, expected: plan.revision });
  }

  /** 読み直した目録で、最初の判定と同じ計画になるときだけ書き込む内容を決める。 */
  private async refreshPlan(
    { operation, signal, hash }: Request,
    planned: Commit,
  ): Promise<Result | Write> {
    if (this.halted(signal)) return { kind: "notSaved" };
    const { value: fresh, versions } = await readCatalog(this.files, signal);
    const commit = { ...planned, now: Date.now() };
    const plan = this.rules.plan(operation, fresh, hash, commit);
    if (plan.kind !== "write") return plan;
    if (this.halted(signal)) return { kind: "notSaved" };
    const target = plan.newBook ? undefined : fresh.find(({ book }) => book.id === plan.bookId);
    return {
      kind: "write",
      operation,
      signal,
      hash,
      commit,
      fresh,
      versions,
      plan,
      ...optionalField("target", target),
    };
  }

  private async write(step: Write, progress: WriteProgress): Promise<string> {
    if (this.halted(step.signal)) throw new Refuse("notSaved");
    const { target, plan } = step;
    assertUnchanged(step.versions, this.files.versions(), target?.path, target?.path);
    if (plan.newBook) {
      const raw = createBookNote(newBookRecord(plan.newBook));
      progress.change = plan.change;
      progress.started = true;
      return this.files.create(plan.bookId, raw);
    }
    if (!target) throw new Refuse("conflict");
    return this.files.process(target.path, (raw, currentPath) =>
      this.applyUpdate(step, progress, raw, currentPath),
    );
  }

  /** 本ページの最新の内容で計画し直し、変わっていなければ購入希望・版・購入の記録を書き換える。 */
  private applyUpdate(
    step: Write,
    progress: WriteProgress,
    raw: string,
    currentPath: string,
  ): string {
    const { bookId } = step.plan;
    if (this.halted(step.signal)) throw new Refuse("notSaved");
    if (!this.files.canUpdate(currentPath, raw)) throw new Refuse("unavailable");
    const latest = readEntry(currentPath, raw);
    if (latest?.id !== bookId) throw new Refuse("conflict");
    const updated = step.fresh.map((entry) =>
      entry.book.id === bookId ? { path: currentPath, book: latest } : entry,
    );
    const verified = this.rules.plan(step.operation, updated, step.hash, step.commit);
    if (verified.kind !== "write" || verified.newBook) throw new Refuse("conflict");
    assertUnchanged(step.versions, this.files.versions(), step.target?.path, currentPath);
    const written = writeBookUpdate(raw, bookUpdate(verified.change));
    progress.change = verified.change;
    progress.started = true;
    return written;
  }
}
