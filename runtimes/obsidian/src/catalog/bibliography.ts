import type { BookRecord } from "../adapters/note-format/book-record.ts";
import type { BibliographyRevision, LookupAnswer } from "../core/catalog-core.ts";
import { optionalField } from "../shared/optional-field.ts";
import type { BookContext, Serial } from "./book-change.ts";
import type { StoredBook } from "./catalog.ts";
import type { BibliographyLookup } from "./ports.ts";
import { Refuse } from "./purchase.ts";
import { readCatalog, readEntry } from "./read.ts";

/** 表記をそろえる案の一冊分。`raw`は案を作ったときの本ページの全文。 */
export type Proposal = Readonly<{
  path: string;
  raw: string;
  book: BookRecord;
  revision: BibliographyRevision;
}>;

/** 表記をそろえる案と、国立国会図書館サーチに問い合わせられなかったISBNの数。 */
export type Proposals = Readonly<{ proposals: Proposal[]; failedLookups: number }>;

export type RevisionResult = Readonly<{ applied: number; changed: number; failed: number }>;

function changes(revision: BibliographyRevision): boolean {
  return (
    revision.title !== undefined ||
    revision.authors !== undefined ||
    revision.classification !== undefined ||
    revision.editions.length > 0 ||
    revision.endsLookups === true
  );
}

async function answer(
  lookup: BibliographyLookup,
  isbn: string,
  signal: AbortSignal,
): Promise<LookupAnswer> {
  return { isbn, ...optionalField("record", await lookup.record(isbn, signal)) };
}

/**
 * 日本十進分類法の番号と要目・細目の名前が合わない本ページの名前を、番号に合わせる。番号を手で書き換えた
 * 本のためにある。合っている本ページは書き換えず、書き換えられない本ページは次の機会に回す。
 */
export async function followClassifications(
  context: BookContext,
  paths: Iterable<string>,
): Promise<void> {
  const { files, notes } = context;
  for (const path of paths) {
    if (!context.active()) break;
    try {
      const raw = await files.read(path);
      if (!notes.readScoped(raw) || notes.followClassification(raw) === raw) continue;
      await files.process(path, (latest, currentPath) => {
        const current = notes.readScoped(latest);
        if (
          !context.active() ||
          !files.canUpdate(currentPath, latest) ||
          !current ||
          current.pendingMove
        )
          throw new Refuse("unavailable");
        return notes.followClassification(latest);
      });
    } catch {
      continue;
    }
  }
}

/**
 * 照会を待つ本の書誌を、国立国会図書館サーチの書誌で書き換える。問い合わせは本の書き込みと
 * 切り離して一件ずつ行い、問い合わせに失敗したら、その回はそこでやめて次の機会に回す。
 * 書き換える内容は、本ページの最新の内容でcoreが決め直す。表記をそろえる案と、手で書き換えた
 * 分類の番号に要目の名前を合わせることも受け持つ。
 */
export class LibraryLookups {
  private running: Promise<void> | undefined;
  private again = false;
  private readonly stopped = new AbortController();
  private readonly context: BookContext;
  private readonly lookup: BibliographyLookup;
  private readonly serial: Serial;

  constructor(context: BookContext, lookup: BibliographyLookup, serial: Serial) {
    this.context = context;
    this.lookup = lookup;
    this.serial = serial;
  }

  /** 照会を待つ本を探して書き換える。実行中なら、終わった後にもう一度探す。 */
  request(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = this.drain().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  stop(): void {
    this.stopped.abort();
  }

  /** 本ごとに表記をそろえる案を作る。書誌の問い合わせは時間がかかるので、目録の操作を止めない。 */
  propose(
    library: boolean,
    signal: AbortSignal,
    progress: (done: number, total: number) => void,
  ): Promise<Proposals> {
    return proposeRevisions(this.context, this.lookup, { library, signal, progress });
  }

  /** 選んだ案を、案を作った後に変わっていない本ページにだけ書く。 */
  apply(chosen: readonly Proposal[]): Promise<RevisionResult> {
    return this.serial(() => applyRevisions(this.context, chosen));
  }

  /** 変わった本ページの分類の名前を、日本十進分類法の番号に合わせる。目録の操作と順に行う。 */
  followClassification(path: string): Promise<void> {
    return this.serial(() => followClassifications(this.context, [path]));
  }

  private async drain(): Promise<void> {
    do {
      this.again = false;
      try {
        await this.pass();
      } catch {
        return;
      }
    } while (this.again && this.context.active());
  }

  private async pass(): Promise<void> {
    const entries = await this.serial(async () => (await readCatalog(this.context)).value);
    for (const entry of entries) {
      if (!this.context.active()) return;
      if (entry.book.pendingLookup === undefined || entry.book.pendingMove) continue;
      const plan = this.context.rules.enrichment(entry.book, []);
      const isbns = plan.kind === "lookup" ? plan.isbns : [];
      const answers: LookupAnswer[] = [];
      for (const isbn of isbns) answers.push(await answer(this.lookup, isbn, this.stopped.signal));
      await this.serial(() => this.write(entry, answers)).catch(() => undefined);
    }
  }

  private write({ path, book }: StoredBook, answers: readonly LookupAnswer[]): Promise<string> {
    const { files, notes, rules } = this.context;
    return files.process(path, (raw, currentPath) => {
      if (!this.context.active() || !files.canUpdate(currentPath, raw))
        throw new Refuse("unavailable");
      const latest = notes.readScoped(raw);
      if (latest?.id !== book.id || latest.pendingMove) throw new Refuse("conflict");
      const plan = rules.enrichment(latest, answers);
      if (plan.kind !== "write") throw new Refuse("conflict");
      return notes.reviseBibliography(raw, plan.revision);
    });
  }
}

/** 本の版のISBNを、重ねずに版の順に並べる。 */
function isbnsOf(book: BookRecord): string[] {
  return [...new Set(book.editions.flatMap(({ isbns }) => isbns))];
}

/**
 * 書籍の保存範囲の本ごとに、表記をそろえる案を作る。`library`が真なら、本のISBNごとに
 * 国立国会図書館サーチの書誌を一件ずつ問い合わせ、書誌を優先する。読めない本ページは飛ばす。
 */
async function proposeRevisions(
  context: BookContext,
  lookup: BibliographyLookup,
  options: Readonly<{
    library: boolean;
    signal: AbortSignal;
    progress: (done: number, total: number) => void;
  }>,
): Promise<Proposals> {
  const { files, notes, rules } = context;
  const { library, signal, progress } = options;
  const paths = [...files.versions().keys()].sort();
  const proposals: Proposal[] = [];
  let failedLookups = 0;
  for (const [index, path] of paths.entries()) {
    signal.throwIfAborted();
    const raw = await files.read(path);
    let book: BookRecord | undefined;
    try {
      book = readEntry(notes, path, raw);
    } catch {
      book = undefined;
    }
    const answers: LookupAnswer[] = [];
    for (const isbn of library && book ? isbnsOf(book) : []) {
      try {
        answers.push(await answer(lookup, isbn, signal));
      } catch {
        signal.throwIfAborted();
        failedLookups++;
      }
    }
    const revision = book && rules.review(book, answers);
    if (book && revision && changes(revision)) proposals.push({ path, raw, book, revision });
    progress(index + 1, paths.length);
  }
  return { proposals, failedLookups };
}

/**
 * 選んだ案を本ページに書く。案を作った後に変わった本ページと、利用者が編集中の本ページは書かない。
 * 名前は変えない。
 */
async function applyRevisions(
  context: BookContext,
  chosen: readonly Proposal[],
): Promise<RevisionResult> {
  const { files, notes } = context;
  let applied = 0;
  let changed = 0;
  let failed = 0;
  for (const { path, raw, book, revision } of chosen) {
    try {
      await files.process(path, (latest, currentPath) => {
        if (!context.active() || !files.canUpdate(currentPath, latest))
          throw new Refuse("unavailable");
        if (latest !== raw || notes.readScoped(latest)?.id !== book.id)
          throw new Refuse("conflict");
        return notes.reviseBibliography(latest, revision);
      });
      applied++;
    } catch (error: unknown) {
      if (error instanceof Refuse && error.kind === "conflict") changed++;
      else failed++;
    }
  }
  return { applied, changed, failed };
}
