import { change, Stop, type BookContext, type Scope } from "./book-change.ts";
import { BookNoteError } from "./book-note-error.ts";
import {
  editEdition,
  readScopedNote,
  setArchivedAt,
  updateCustomField,
  writeBookUpdate,
  type CustomField,
  type EditionRecord,
} from "./book-note.ts";
import { decodeCustomField } from "./book-note-values.ts";
import { recordEdition } from "./catalog-core.ts";
import { readCatalog } from "./catalog-read.ts";
import { runMove } from "./edition-move.ts";
import { restoreMoveCopy } from "./edition-recovery.ts";
import type { BookStep } from "./wasm.ts";

export type Management =
  | { action: "editEdition"; bookId: string; baseline: EditionRecord; value: EditionRecord }
  | { action: "addEdition"; bookId: string; value: EditionRecord }
  | { action: "updateCustomField"; bookId: string; baseline?: CustomField; value?: CustomField }
  | { action: "archive" | "restore"; bookId: string; editionId?: string }
  | { action: "move"; bookId: string; editionId: string; destinationId: string }
  | { action: "restoreMoveCopy"; bookId: string; editionId: string }
  | { action: "recoverMove" | "cancelMove"; bookId: string };
export type ManagementResult = "saved" | "conflict" | "unavailable" | "pending";
type Step<K extends BookStep["kind"]> = Extract<BookStep, { kind: K }>;

async function addEdition({ context, source }: Scope, step: Step<"addEdition">) {
  const value = recordEdition(step.edition);
  const path = await change(context, source, step, (raw, book) =>
    writeBookUpdate(raw, { wanted: book.wanted, edition: value }),
  );
  const saved = readScopedNote(await context.files.read(path));
  return saved?.editions.some(({ id }) => id === value.id) ? "saved" : "pending";
}

async function reviseEdition({ context, source }: Scope, step: Step<"editEdition">) {
  const value = recordEdition(step.edition);
  const path = await change(context, source, step, (raw) => editEdition(raw, value));
  const saved = readScopedNote(await context.files.read(path));
  const actual = saved?.editions.find(({ id }) => id === value.id);
  return actual && actual.owned === value.owned && actual.publisher === value.publisher
    ? "saved"
    : "pending";
}

async function changeCustomField({ context, source }: Scope, step: Step<"updateCustomField">) {
  const { baseline, value } = step;
  const path = await change(context, source, step, (raw) =>
    updateCustomField(raw, baseline, value),
  );
  const book = readScopedNote(await context.files.read(path));
  if (book?.id !== source.book.id) return "pending";
  const field = book.customFields?.find(({ name }) => name === (value?.name ?? baseline?.name));
  const expected = value && decodeCustomField(value);
  return JSON.stringify(field) === JSON.stringify(expected) ? "saved" : "pending";
}

/** 本または版をアーカイブ、または元に戻す。記録は消さず、アーカイブした時刻だけを書き換える。 */
async function setArchive({ context, source }: Scope, step: Step<"setArchivedAt">) {
  const { editionId, archivedAt } = step;
  const path = await change(context, source, step, (raw) =>
    setArchivedAt(raw, editionId, archivedAt ?? null),
  );
  const saved = readScopedNote(await context.files.read(path));
  const target =
    saved?.id !== source.book.id
      ? undefined
      : editionId
        ? saved.editions.find(({ id }) => id === editionId)
        : saved;
  return target && target.archivedAt === archivedAt ? "saved" : "pending";
}

/** coreが決めた一つの変更を、操作の対象の本に書く。 */
async function write(scope: Scope, step: BookStep): Promise<ManagementResult> {
  switch (step.kind) {
    case "addEdition":
      return addEdition(scope, step);
    case "editEdition":
      return reviseEdition(scope, step);
    case "updateCustomField":
      return changeCustomField(scope, step);
    case "setArchivedAt":
      return setArchive(scope, step);
    default:
      throw new Error(`操作の計画に、書けない変更があります: ${step.kind}`);
  }
}

async function dispatch(scope: Scope, command: Management): Promise<ManagementResult> {
  if (command.action === "restoreMoveCopy") return restoreMoveCopy(scope, command.editionId);
  const plan = scope.context.rules.manage(command, scope.entries);
  switch (plan.kind) {
    case "conflict":
    case "pending":
      return plan.kind;
    case "write":
      return write(scope, plan.step);
    case "move":
      return runMove(scope, command, plan.stages);
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
    const { value: entries, versions } = await readCatalog(context.files);
    const source = entries.find(({ book }) => book.id === command.bookId);
    if (!source) return "conflict";
    return await dispatch({ context, source, entries, versions, progress }, command);
  } catch (error: unknown) {
    return progress.moveStarted ? "pending" : failureOf(error);
  }
}
