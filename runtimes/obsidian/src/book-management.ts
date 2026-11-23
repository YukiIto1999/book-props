import {
  change,
  editionCollision,
  hasEdition,
  Stop,
  type BookContext,
  type Scope,
} from "./book-change.ts";
import { BookNoteError } from "./book-note-error.ts";
import {
  editEdition,
  readScopedNote,
  setArchivedAt,
  updateCustomField,
  writeBookUpdate,
  type BookRecord,
  type CustomField,
  type EditionRecord,
} from "./book-note.ts";
import { cancelMove, moveEdition, recoverMove } from "./edition-move.ts";
import { restoreMoveCopy } from "./edition-recovery.ts";

export type Management =
  | { action: "editEdition"; bookId: string; baseline: EditionRecord; value: EditionRecord }
  | { action: "addEdition"; bookId: string; value: EditionRecord }
  | { action: "updateCustomField"; bookId: string; baseline?: CustomField; value?: CustomField }
  | { action: "archive" | "restore"; bookId: string; editionId?: string }
  | { action: "move"; bookId: string; editionId: string; destinationId: string }
  | { action: "restoreMoveCopy"; bookId: string; editionId: string }
  | { action: "recoverMove" | "cancelMove"; bookId: string };
export type ManagementResult = "saved" | "conflict" | "unavailable" | "pending";
type Command<A extends Management["action"]> = Extract<Management, { action: A }>;
type BookChange = Exclude<Management, { action: "recoverMove" | "cancelMove" }>;

async function addEdition(
  { context, source, entries }: Scope,
  { value }: Command<"addEdition">,
): Promise<ManagementResult> {
  const clashes = (book: BookRecord) => editionCollision(book, value) || hasEdition(book, value.id);
  if (source.book.archivedAt || value.archivedAt || entries.some(({ book }) => clashes(book))) {
    return "conflict";
  }
  const path = await change(context, source, (raw, book) => {
    if (book.archivedAt || book.pendingMove || clashes(book)) throw new Stop("conflict");
    return writeBookUpdate(raw, { wanted: book.wanted, edition: value });
  });
  const saved = readScopedNote(await context.files.read(path));
  return saved && hasEdition(saved, value.id) ? "saved" : "pending";
}

async function reviseEdition(
  { context, source, entries }: Scope,
  { baseline, value }: Command<"editEdition">,
): Promise<ManagementResult> {
  const invalid =
    source.book.archivedAt ||
    baseline.id !== value.id ||
    baseline.archivedAt !== value.archivedAt ||
    entries.some(({ book }) => editionCollision(book, value));
  if (invalid) return "conflict";
  const path = await change(context, source, (raw, book) => {
    const old = book.editions.find(({ id }) => id === value.id);
    if (book.archivedAt || book.pendingMove || JSON.stringify(old) !== JSON.stringify(baseline)) {
      throw new Stop("conflict");
    }
    return editEdition(raw, value);
  });
  const saved = readScopedNote(await context.files.read(path));
  const actual = saved?.editions.find(({ id }) => id === value.id);
  return actual && actual.owned === value.owned && actual.publisher === value.publisher
    ? "saved"
    : "pending";
}

async function changeCustomField(
  { context, source }: Scope,
  { baseline, value }: Command<"updateCustomField">,
): Promise<ManagementResult> {
  if (source.book.archivedAt || (!baseline && !value)) return "conflict";
  const path = await change(context, source, (raw, book) => {
    if (book.archivedAt || book.pendingMove) throw new Stop("conflict");
    return updateCustomField(raw, baseline, value);
  });
  const book = readScopedNote(await context.files.read(path));
  if (book?.id !== source.book.id) return "pending";
  const field = book.customFields?.find(({ name }) => name === (value?.name ?? baseline?.name));
  return JSON.stringify(field) === JSON.stringify(value) ? "saved" : "pending";
}

function archiveTarget(
  book: BookRecord,
  editionId: string | undefined,
): Readonly<{ archivedAt?: string }> | undefined {
  return editionId ? book.editions.find(({ id }) => id === editionId) : book;
}

/** 本または版をアーカイブ、または元に戻す。記録は消さず、アーカイブした時刻だけを書き換える。 */
async function setArchive(
  { context, source }: Scope,
  command: Command<"archive" | "restore">,
): Promise<ManagementResult> {
  const { editionId } = command;
  const old = archiveTarget(source.book, editionId);
  if (!old || (editionId && source.book.archivedAt)) return "conflict";
  const at = command.action === "archive" ? (old.archivedAt ?? new Date().toISOString()) : null;
  const path = await change(context, source, (raw, book) => {
    const current = archiveTarget(book, editionId);
    if (
      !current ||
      current.archivedAt !== old.archivedAt ||
      book.pendingMove ||
      (editionId && book.archivedAt)
    ) {
      throw new Stop("conflict");
    }
    return setArchivedAt(raw, editionId, at);
  });
  const saved = readScopedNote(await context.files.read(path));
  const target = saved?.id === source.book.id ? archiveTarget(saved, editionId) : undefined;
  return target && target.archivedAt === (at ?? undefined) ? "saved" : "pending";
}

async function applyChange(scope: Scope, command: BookChange): Promise<ManagementResult> {
  if (scope.entries.some(({ book }) => book.pendingMove)) return "pending";
  switch (command.action) {
    case "move":
      return moveEdition(scope, command);
    case "restoreMoveCopy":
      return restoreMoveCopy(scope, command.editionId);
    case "addEdition":
      return addEdition(scope, command);
    case "editEdition":
      return reviseEdition(scope, command);
    case "updateCustomField":
      return changeCustomField(scope, command);
    case "archive":
    case "restore":
      return setArchive(scope, command);
  }
}

function dispatch(scope: Scope, command: Management): Promise<ManagementResult> {
  switch (command.action) {
    case "recoverMove":
      return recoverMove(scope);
    case "cancelMove":
      return cancelMove(scope);
    default:
      return applyChange(scope, command);
  }
}

function failureOf(error: unknown): ManagementResult {
  if (error instanceof Stop) return error.reason;
  return error instanceof BookNoteError && error.code === "conflict" ? "conflict" : "unavailable";
}

export async function manageBooks(
  context: BookContext,
  command: Management,
): Promise<ManagementResult> {
  const progress = { moveStarted: false };
  try {
    if (!context.active()) return "unavailable";
    const entries = await context.entries();
    const source = entries.find(({ book }) => book.id === command.bookId);
    if (!source) return "conflict";
    return await dispatch({ context, source, entries, progress }, command);
  } catch (error: unknown) {
    return progress.moveStarted ? "pending" : failureOf(error);
  }
}
