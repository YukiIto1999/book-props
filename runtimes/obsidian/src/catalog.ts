import { writeBookUpdate, type BookRecord } from "./book-note.ts";
import { manageBooks, type Management, type ManagementResult } from "./book-management.ts";
import { catalogInput, decodeOutcome, type Decision, type Ownership } from "./catalog-core.ts";
import { importNotes, pruneReceipts, type ImportResult } from "./catalog-maintenance.ts";
import {
  assertUnchanged,
  CatalogChanged,
  confirmedWrite,
  hasPendingMove,
  inputHash,
  newBookNote,
  planWrite,
  Refuse,
  replayOf,
  revision,
  updatedEdition,
  validKey,
  type Write,
  type WriteProgress,
} from "./catalog-purchase.ts";
import { readCatalog, readEntries, readEntry, readFailure, readStable } from "./catalog-read.ts";
import { settledShelf } from "./edition-move.ts";
import { missingMoveCopies, type MoveCopies } from "./edition-recovery.ts";
import { decodePortableLibrary, encodePortableLibrary } from "./portable-library.ts";

export type Product = Readonly<{
  title?: string;
  authors?: readonly string[];
  isbns?: readonly string[];
  label?: string;
  publisher?: string;
  publishedOn?: string;
  cover?: string;
  purchasedOn?: string;
  purchasedFrom?: string;
}>;
export type Action =
  | "inspect"
  | "purchase"
  | "recordOwnership"
  | "setWish"
  | "clearWish"
  | "cancelOwnership";
export type Outcome = Readonly<{
  ownership: Ownership;
  wanted: boolean;
  bookId: string | null;
  editionId: string | null;
  decision: Decision;
  isbns: string[];
}>;
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

export class Catalog {
  private tail: Promise<unknown> = Promise.resolve();
  private accepting = true;

  private readonly files: BookFiles;
  private readonly evaluate: (json: string) => string;

  constructor(files: BookFiles, evaluate: (json: string) => string) {
    this.files = files;
    this.evaluate = evaluate;
  }

  async entries(): Promise<StoredBook[]> {
    return (await readCatalog(this.files)).value;
  }
  moveCopiesMissingFrom(entries: readonly StoredBook[]) {
    return missingMoveCopies(this.files.moveCopies, entries);
  }
  shelf(): Promise<{ entries: StoredBook[]; moving: boolean }> {
    return this.serial(async () => {
      if (!this.accepting) throw new Refuse("unavailable");
      const versions = this.files.versions();
      const entries = await readEntries(this.files, versions.keys());
      assertUnchanged(versions, this.files.versions());
      return settledShelf(entries);
    });
  }

  private report(operation: Operation, entries: readonly StoredBook[]): Outcome {
    return decodeOutcome(this.evaluate(catalogInput(operation, entries)));
  }

  async preview(operation: Operation): Promise<Result> {
    try {
      const entries = await this.entries();
      if (!this.accepting || hasPendingMove(entries)) return { kind: "unavailable" };
      return { kind: "observed", outcome: this.report(operation, entries) };
    } catch (error: unknown) {
      return readFailure(error) ?? { kind: "unavailable" };
    }
  }

  normalizeIsbns(isbns: readonly string[]): { values: string[] } | { invalid: string } {
    if (!isbns.length) return { values: [] };
    const { decision, isbns: values } = this.report({ action: "inspect", product: { isbns } }, []);
    return decision.kind === "invalidIsbn" ? { invalid: decision.input } : { values };
  }

  async reconcile(operation: Operation, signal?: AbortSignal): Promise<Result> {
    const { purchase } = operation;
    if (this.halted(signal) || operation.action !== "purchase" || !purchase || !validKey(purchase))
      return { kind: "unknown" };
    try {
      const { value: entries } = await readCatalog(this.files, signal);
      const hash = await inputHash(operation);
      if (this.halted(signal)) return { kind: "unknown" };
      return replayOf(entries, purchase, hash) ?? { kind: "unknown" };
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
    return { files: this.files, entries: () => this.entries(), active: () => this.accepting };
  }

  exportLibrary(): Promise<string> {
    return this.serial(async () => {
      if (!this.accepting) throw new Refuse("unavailable");
      const { value: markdown } = await readStable(this.files, async (versions) => {
        const entries = await readEntries(this.files, versions.keys());
        if (hasPendingMove(entries)) throw new Refuse("conflict");
        return Promise.all(entries.map(({ path }) => this.files.read(path)));
      });
      return encodePortableLibrary(markdown);
    });
  }

  importLibrary(json: string): Promise<ImportResult> {
    const desired = decodePortableLibrary(json);
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
        if (!hasPendingMove(entries)) await pruneReceipts(this.managementContext, entries);
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
      if (this.halted(signal)) return { kind: "notSaved" };
      const { action, purchase } = operation;
      if (action === "purchase" && (!purchase || !validKey(purchase))) return { kind: "notSaved" };
      const hash = purchase && (await inputHash(operation));
      const step = await this.prepare(operation, signal, hash);
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
        const refreshed = await this.refreshPlan(plan);
        if (refreshed.kind !== "write") return refreshed;
        plan = refreshed;
      }
    }
    return { kind: "conflict" };
  }

  /** 判定を二度読み、変わっていなければ書き込む内容を決める。書き込まない場合は結果を返す。 */
  private async prepare(
    operation: Operation,
    signal: AbortSignal | undefined,
    hash: string | undefined,
  ): Promise<Result | Write> {
    const { action, purchase } = operation;
    const { value: entries } = await readCatalog(this.files, signal);
    if (this.halted(signal)) return { kind: "notSaved" };
    const replay = replayOf(entries, purchase, hash);
    if (replay) return replay;
    if (hasPendingMove(entries)) return { kind: "unavailable" };
    const original = this.report(operation, entries);
    const { kind } = original.decision;
    if (action === "inspect") {
      const path = entries.find(({ book }) => book.id === original.bookId)?.path;
      return { kind: "observed", outcome: original, path };
    }
    if (kind === "none") return { kind: "observed", outcome: original };
    if (kind !== "createBook" && kind !== "addEdition" && kind !== "update")
      return { kind: "needsInput", outcome: original };
    return this.refreshPlan({ operation, signal, hash, expected: revision(action, original) });
  }

  private async refreshPlan({
    operation,
    signal,
    hash,
    expected,
  }: Pick<Write, "operation" | "signal" | "hash" | "expected">): Promise<Result | Write> {
    if (this.halted(signal)) return { kind: "notSaved" };
    const { value: fresh, versions } = await readCatalog(this.files, signal);
    if (hasPendingMove(fresh)) return { kind: "unavailable" };
    const outcome = this.report(operation, fresh);
    const freshReplay = replayOf(fresh, operation.purchase, hash);
    if (freshReplay) return freshReplay;
    if (revision(operation.action, outcome) !== expected) return { kind: "conflict" };
    if (this.halted(signal)) return { kind: "notSaved" };
    return planWrite({ operation, signal, hash, expected, fresh, versions, outcome });
  }

  private async write(step: Write, progress: WriteProgress): Promise<string> {
    if (this.halted(step.signal)) throw new Refuse("notSaved");
    const { target, outcome } = step;
    const { decision } = outcome;
    assertUnchanged(step.versions, this.files.versions(), target?.path, target?.path);
    if (decision.kind === "createBook") {
      const raw = newBookNote(step, decision.wanted);
      progress.change = { wanted: decision.wanted, edition: step.newRecord, receipt: step.receipt };
      progress.started = true;
      return this.files.create(step.bookId, raw);
    }
    if (!target || (decision.kind !== "addEdition" && decision.kind !== "update"))
      throw new Refuse("conflict");
    return this.files.process(target.path, (raw, currentPath) =>
      this.applyUpdate(step, progress, raw, currentPath),
    );
  }

  /** 本ページの最新の内容で判定し直し、変わっていなければ購入希望・版・購入の記録を書き換える。 */
  private applyUpdate(
    step: Write,
    progress: WriteProgress,
    raw: string,
    currentPath: string,
  ): string {
    const { operation, bookId } = step;
    if (this.halted(step.signal)) throw new Refuse("notSaved");
    if (!this.files.canUpdate(currentPath, raw)) throw new Refuse("unavailable");
    const latest = readEntry(currentPath, raw);
    if (latest?.id !== bookId || latest.pendingMove) throw new Refuse("conflict");
    const updated = step.fresh.map((entry) =>
      entry.book.id === bookId ? { path: currentPath, book: latest } : entry,
    );
    if (replayOf(updated, operation.purchase, step.hash)) throw new Refuse("conflict");
    const verified = this.report(operation, updated);
    if (revision(operation.action, verified) !== step.expected) throw new Refuse("conflict");
    const plan = verified.decision;
    if (plan.kind !== "addEdition" && plan.kind !== "update") throw new Refuse("conflict");
    assertUnchanged(step.versions, this.files.versions(), step.target?.path, currentPath);
    const change = {
      wanted: plan.wantedAfter,
      edition: updatedEdition(step, plan, latest),
      receipt: step.receipt,
    };
    const written = writeBookUpdate(raw, change);
    progress.change = change;
    progress.started = true;
    return written;
  }
}
