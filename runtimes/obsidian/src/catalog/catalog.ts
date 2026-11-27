import type { Product as WireProduct } from "@book-props/vault-contract";
import type { BookRecord } from "../adapters/note-format/book-record.ts";
import type { NoteFormat } from "../adapters/note-format/note-format.ts";
import type { Action, BookOptions, CatalogCore, IsbnList, Outcome } from "../core/catalog-core.ts";
import { optionalField } from "../shared/optional-field.ts";
import { LibraryLookups } from "./bibliography.ts";
import type { BookContext } from "./book-change.ts";
import { missingMoveCopies, settledShelf, type MissingCopy } from "./edition-recovery.ts";
import { importNotes, maintainBooks, type ImportResult } from "./maintenance.ts";
import { manageBooks, type Management, type ManagementResult } from "./management.ts";
import {
  applyNoteRenames,
  noteNaming,
  proposeNoteRenames,
  type NoteRename,
  type RenameResult,
} from "./note-name.ts";
import type { BibliographyLookup, BookFiles } from "./ports.ts";
import { PortableLibrary } from "./portable-library.ts";
import {
  assertUnchanged,
  CatalogChanged,
  confirmedWrite,
  hasPendingMove,
  inputHash,
  Refuse,
  type Write,
  type WriteProgress,
} from "./purchase.ts";
import { readCatalog, readEntries, readEntry, readFailure, readStable } from "./read.ts";
import { bookUpdate, CatalogRules, newBookRecord, type Commit, type Stamp } from "./rules.ts";
import { ShelfQuery } from "./shelf-query.ts";

/** 拡張から届く書誌と同じ形に、登録画面で扱う購入の記録と、書誌が示すシリーズを加えたもの。 */
export type Product = Readonly<
  WireProduct & {
    purchasedOn?: string;
    purchasedFrom?: string;
    series?: string;
  }
>;
export type PurchaseKey = Readonly<{ clientId: string; requestId: string; issuedAt: number }>;
export type Selection = Readonly<{ bookId: string; editionId?: string }>;
/** `lookup`が真なら、書いた書誌を後で国立国会図書館サーチの書誌で書き換える。 */
export type Operation = Readonly<{
  action: Action;
  product: Product;
  purchase?: PurchaseKey;
  selection?: Selection;
  lookup?: boolean;
}>;
export type StoredBook = Readonly<{ path: string; book: BookRecord }>;
export type Result =
  | { kind: "observed"; outcome: Outcome; path?: string | undefined }
  | { kind: "needsInput"; outcome: Outcome }
  | { kind: "saved"; bookId: string; editionId?: string }
  | { kind: "replayed"; bookId: string; editionId: string }
  | { kind: "unreadable"; path: string; reason: string }
  | { kind: "unknown" | "unavailable" | "conflict" | "notSaved" };
type Request = Pick<Write, "operation" | "signal" | "hash">;

/**
 * 書籍の保存範囲の本と版の操作を、一つずつ順に受け付ける。本ページを読み、coreに判定させ、
 * 判定どおりに書く。書く直前に読み直して、判定が変わっていれば書かない。
 */
export class Catalog {
  private tail: Promise<unknown> = Promise.resolve();
  private accepting = true;

  private readonly core: CatalogCore;
  private readonly context: BookContext;
  private readonly portable: PortableLibrary;
  /** 国立国会図書館サーチでの照会と、表記をそろえる案。 */
  readonly bibliography: LibraryLookups;

  constructor(files: BookFiles, core: CatalogCore, notes: NoteFormat, library: BibliographyLookup) {
    this.core = core;
    const rules = new CatalogRules(core, notes);
    this.context = { files, notes, rules, active: () => this.accepting };
    this.portable = new PortableLibrary(core, notes);
    this.bibliography = new LibraryLookups(this.context, library, (work) => this.serial(work));
  }

  private get files(): BookFiles {
    return this.context.files;
  }

  private get rules(): CatalogRules {
    return this.context.rules;
  }

  async entries(): Promise<StoredBook[]> {
    return (await readCatalog(this.context)).value;
  }
  /** Vaultの外に控えた版のうち、どの本にも見当たらないものと、それぞれを戻してよい本。 */
  moveCopiesMissingFrom(entries: readonly StoredBook[]): Promise<MissingCopy[]> {
    return missingMoveCopies(this.context, entries);
  }
  /** 一冊の本に、どの管理の操作を勧めるか。 */
  bookOptions(entries: readonly StoredBook[], bookId: string): BookOptions {
    return this.rules.options(entries, bookId);
  }
  shelf(): Promise<{ entries: StoredBook[]; moving: boolean }> {
    return this.serial(async () => {
      if (!this.accepting) throw new Refuse("unavailable");
      const versions = this.files.versions();
      const entries = await readEntries(this.context, versions.keys());
      assertUnchanged(versions, this.files.versions());
      return settledShelf(this.context, entries);
    });
  }
  /** 本棚を開く。閉じるときは`query.close()`を呼ぶ。 */
  async openShelf(): Promise<{ query: ShelfQuery<StoredBook>; moving: boolean }> {
    const { entries, moving } = await this.shelf();
    return { query: ShelfQuery.open(this.core, entries), moving };
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
      const { value: entries } = await readCatalog(this.context, signal);
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
    return this.serial(() => manageBooks(this.context, command));
  }

  exportLibrary(): Promise<string> {
    return this.serial(async () => {
      if (!this.accepting) throw new Refuse("unavailable");
      const { value: markdown } = await readStable(this.files, async (versions) => {
        const entries = await readEntries(this.context, versions.keys());
        if (hasPendingMove(entries)) throw new Refuse("conflict");
        return Promise.all(entries.map(({ path }) => this.files.read(path)));
      });
      return this.portable.encode(markdown);
    });
  }

  importLibrary(json: string): Promise<ImportResult> {
    const desired = this.portable.decode(json);
    return this.serial(() => importNotes(this.context, desired));
  }

  /** 名前がいまの書名と本IDから決まる名前でない本ページと、それぞれの新しい名前。 */
  proposeNoteNames(): Promise<NoteRename[]> {
    return this.serial(() => proposeNoteRenames(this.context));
  }

  /** 選んだ本ページの名前を、一覧を作った後に変わっていなければ変える。 */
  renameNotes(chosen: readonly NoteRename[]): Promise<RenameResult> {
    return this.serial(() => applyNoteRenames(this.context, chosen));
  }

  maintain(): Promise<void> {
    const maintained = this.serial(() => maintainBooks(this.context));
    return maintained.then(() => this.bibliography.request());
  }

  stop(): Promise<unknown> {
    this.accepting = false;
    this.bibliography.stop();
    return this.tail;
  }

  /** 購入などを順に処理する。書誌の照会を求める操作は、保存した後で照会を始め、その終わりは待たない。 */
  execute(operation: Operation, signal?: AbortSignal): Promise<Result> {
    if (operation.action === "inspect") return this.run(operation, signal);
    const done = this.serial(() => this.run(operation, signal));
    if (operation.lookup)
      void done.then(({ kind }) => (kind === "saved" ? this.bibliography.request() : undefined));
    return done;
  }

  /** この端末の登録画面から保存する。購入には、この端末で作った再確認の要求IDを付ける。 */
  save(operation: Operation, clientId: string, signal?: AbortSignal): Promise<Result> {
    const purchase =
      operation.action === "purchase"
        ? { clientId, requestId: crypto.randomUUID(), issuedAt: Date.now() }
        : undefined;
    return this.execute({ ...operation, ...optionalField("purchase", purchase) }, signal);
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
        return await confirmedWrite(this.context, path, plan, progress.change);
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
    const { value: entries } = await readCatalog(this.context, signal);
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
    const { value: fresh, versions } = await readCatalog(this.context, signal);
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
    const fileName = plan.newBook && (await noteNaming(plan.newBook.title, plan.bookId));
    assertUnchanged(step.versions, this.files.versions(), target?.path, target?.path);
    if (plan.newBook && fileName) {
      const raw = this.context.notes.create(newBookRecord(plan.newBook, plan.pendingLookup));
      progress.change = plan.change;
      progress.started = true;
      return this.files.create(fileName, raw);
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
    const latest = readEntry(this.context.notes, currentPath, raw);
    if (latest?.id !== bookId) throw new Refuse("conflict");
    const updated = step.fresh.map((entry) =>
      entry.book.id === bookId ? { path: currentPath, book: latest } : entry,
    );
    const verified = this.rules.plan(step.operation, updated, step.hash, step.commit);
    if (verified.kind !== "write" || verified.newBook) throw new Refuse("conflict");
    assertUnchanged(step.versions, this.files.versions(), step.target?.path, currentPath);
    const written = this.context.notes.writeUpdate(
      raw,
      bookUpdate(verified.change, verified.pendingLookup),
    );
    progress.change = verified.change;
    progress.started = true;
    return written;
  }
}
