import {
  change,
  editionCollision,
  hasEdition,
  heldElsewhere,
  Stop,
  type BookContext,
  type Scope,
} from "./book-change.ts";
import type { ManagementResult } from "./book-management.ts";
import {
  captureEdition,
  insertTransferredEdition,
  markEditionMove,
  readScopedNote,
  removeEdition,
  type Capture,
  type EditionRecord,
  type PendingMove,
} from "./book-note.ts";
import { readEditionBackup } from "./book-note-parse.ts";
import { assertUnchanged } from "./catalog-purchase.ts";
import { readCatalog } from "./catalog-read.ts";
import type { StoredBook } from "./catalog.ts";
import type { MoveCopy } from "./edition-recovery.ts";

async function signatureOf(value: string): Promise<string> {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

type Verified = Readonly<{ path: string; version: string; raw: string }>;

function stillVerified({ files }: BookContext, { path, version, raw }: Verified): boolean {
  return files.versions().get(path) === version && files.canUpdate(path, raw);
}

async function verifyDestination(
  context: BookContext,
  path: string,
  marker: PendingMove,
  captured: Capture,
): Promise<Verified | undefined> {
  const version = context.files.versions().get(path);
  if (version === undefined) return undefined;
  const raw = await context.files.read(path);
  const book = readScopedNote(raw);
  const verified = { path, version, raw };
  if (
    book?.id !== marker.destinationId ||
    book.archivedAt ||
    book.pendingMove ||
    captureEdition(raw, marker.editionId)?.signature !== captured.signature ||
    !stillVerified(context, verified)
  )
    return undefined;
  return verified;
}

function sameMove({ pendingMove }: StoredBook["book"], marker: PendingMove): boolean {
  return (
    pendingMove?.editionId === marker.editionId &&
    pendingMove.destinationId === marker.destinationId &&
    pendingMove.digest === marker.digest &&
    pendingMove.backup === marker.backup
  );
}

function moveCopy(source: StoredBook, marker: PendingMove, captured: Capture): MoveCopy {
  return {
    editionId: marker.editionId,
    sourceId: source.book.id,
    destinationId: marker.destinationId,
    snapshot: captured.signature,
  };
}

async function copyToDestination(
  context: BookContext,
  destination: StoredBook,
  edition: EditionRecord,
  captured: Capture,
): Promise<string> {
  return change(context, destination, (raw, book) => {
    if (book.archivedAt || book.pendingMove || editionCollision(book, edition))
      throw new Stop("conflict");
    const existing = captureEdition(raw, edition.id);
    if (!existing) return insertTransferredEdition(raw, captured);
    if (existing.signature !== captured.signature) throw new Stop("conflict");
    return raw;
  });
}

async function finishSource(
  context: BookContext,
  source: StoredBook,
  marker: PendingMove,
  captured: Capture,
  destination: Verified,
): Promise<ManagementResult> {
  const backup = { ...marker, backup: captured.signature };
  let sourcePath = source.path;
  if (!marker.backup) {
    sourcePath = await change(context, source, (raw, book) => {
      if (
        !sameMove(book, marker) ||
        !stillVerified(context, destination) ||
        captureEdition(raw, marker.editionId)?.signature !== captured.signature
      )
        throw new Stop("conflict");
      return markEditionMove(removeEdition(raw, marker.editionId), backup);
    });
  }
  const verified = await verifyDestination(context, destination.path, marker, captured);
  if (!verified) return "pending";
  sourcePath = await change(context, { ...source, path: sourcePath }, (raw, book) => {
    if (
      !sameMove(book, backup) ||
      hasEdition(book, marker.editionId) ||
      !stillVerified(context, verified)
    )
      throw new Stop("conflict");
    return markEditionMove(raw, null);
  });
  const finished = readScopedNote(await context.files.read(sourcePath));
  if (
    finished?.id !== source.book.id ||
    finished.pendingMove ||
    hasEdition(finished, marker.editionId)
  )
    return "pending";
  return (await verifyDestination(context, verified.path, marker, captured)) ? "saved" : "pending";
}

/** 移動記録のある版を移動先へ写し、写せたことを確かめてから移動元から取り除く。 */
async function finish(
  context: BookContext,
  source: StoredBook,
  marker: PendingMove,
  retained?: Capture,
): Promise<ManagementResult> {
  const destination = (await context.entries()).find(
    ({ book }) => book.id === marker.destinationId,
  );
  if (
    !destination ||
    destination.book.archivedAt ||
    destination.book.pendingMove ||
    source.book.archivedAt
  ) {
    return "pending";
  }
  const sourceRaw = await context.files.read(source.path);
  const latest = readScopedNote(sourceRaw);
  if (
    latest?.id !== source.book.id ||
    latest.archivedAt ||
    !sameMove(latest, marker) ||
    !context.files.canUpdate(source.path, sourceRaw)
  )
    return "pending";
  const saved = latest.editions.find(({ id }) => id === marker.editionId);
  const backup = marker.backup && readEditionBackup(marker.backup);
  if (saved && backup) return "pending";
  const edition = backup ? backup.edition : saved;
  const captured = backup || captureEdition(sourceRaw, marker.editionId);
  if (!captured || !edition || edition.archivedAt) return "pending";
  if ((await signatureOf(captured.signature)) !== marker.digest) return "pending";
  if (saved) removeEdition(sourceRaw, marker.editionId);
  if (retained?.signature !== captured.signature)
    await context.files.moveCopies.keep(moveCopy(source, marker, captured));
  const destinationPath = await copyToDestination(context, destination, edition, captured);
  const copied = await verifyDestination(context, destinationPath, marker, captured);
  return copied ? finishSource(context, source, marker, captured, copied) : "pending";
}

export async function recoverMove({ context, source, progress }: Scope): Promise<ManagementResult> {
  const marker = source.book.pendingMove;
  if (!marker) return "conflict";
  progress.moveStarted = true;
  return finish(context, source, marker);
}

export async function cancelMove({ context, source, progress }: Scope): Promise<ManagementResult> {
  const marker = source.book.pendingMove;
  if (!marker) return "conflict";
  const { value: entries, versions } = await readCatalog(context.files);
  if (heldElsewhere(entries, source, marker.editionId)) return "pending";
  const backup = marker.backup && readEditionBackup(marker.backup);
  if (backup && (await signatureOf(backup.signature)) !== marker.digest) return "pending";
  if (backup) await context.files.moveCopies.keep(moveCopy(source, marker, backup));
  const path = await change(context, source, (raw, book) => {
    const hasSource = hasEdition(book, marker.editionId);
    if (!sameMove(book, marker) || (!hasSource && !backup) || (hasSource && backup))
      throw new Stop("conflict");
    assertUnchanged(versions, context.files.versions(), source.path, source.path);
    if (backup && editionCollision(book, backup.edition)) throw new Stop("conflict");
    const updated = markEditionMove(backup ? insertTransferredEdition(raw, backup) : raw, null);
    progress.moveStarted = true;
    return updated;
  });
  const finished = readScopedNote(await context.files.read(path));
  return finished?.id === source.book.id &&
    !finished.pendingMove &&
    hasEdition(finished, marker.editionId)
    ? "saved"
    : "pending";
}

function canMove(
  { source, entries }: Scope,
  destination: StoredBook,
  edition: EditionRecord,
): boolean {
  return (
    source.book.id !== destination.book.id &&
    !source.book.archivedAt &&
    !edition.archivedAt &&
    !destination.book.archivedAt &&
    !editionCollision(destination.book, edition) &&
    !heldElsewhere(entries, source, edition.id)
  );
}

/** 移動元に移動記録を書いてから、版を移動先へ移す。途中で止まった移動は記録から再開できる。 */
export async function moveEdition(
  scope: Scope,
  { editionId, destinationId }: Readonly<{ editionId: string; destinationId: string }>,
): Promise<ManagementResult> {
  const { context, source, entries, progress } = scope;
  const destination = entries.find(({ book }) => book.id === destinationId);
  const edition = source.book.editions.find(({ id }) => id === editionId);
  if (!destination || !edition || !canMove(scope, destination, edition)) return "conflict";
  const [sourceRaw, destinationRaw] = await Promise.all([
    context.files.read(source.path),
    context.files.read(destination.path),
  ]);
  const writable =
    context.files.canUpdate(source.path, sourceRaw) &&
    context.files.canUpdate(destination.path, destinationRaw);
  if (!writable) return "unavailable";
  const captured = captureEdition(sourceRaw, edition.id);
  if (!captured) return "conflict";
  const digest = await signatureOf(captured.signature);
  const marker = { editionId: edition.id, destinationId: destination.book.id, digest };
  await context.files.moveCopies.keep(moveCopy(source, marker, captured));
  const path = await change(context, source, (raw, book) => {
    if (
      book.archivedAt ||
      book.pendingMove ||
      captureEdition(raw, edition.id)?.signature !== captured.signature
    ) {
      throw new Stop("conflict");
    }
    const updated = markEditionMove(raw, marker);
    removeEdition(updated, edition.id);
    progress.moveStarted = true;
    return updated;
  });
  const staged = readScopedNote(await context.files.read(path));
  if (staged?.id !== source.book.id || staged.pendingMove?.digest !== marker.digest)
    return "pending";
  return finish(context, { path, book: staged }, marker, captured);
}

export function settledShelf(books: StoredBook[]): { entries: StoredBook[]; moving: boolean } {
  const copies = new Map<string, Set<string>>();
  for (const { book } of books) {
    const { pendingMove } = book;
    if (!pendingMove) continue;
    const { destinationId, editionId } = pendingMove;
    const ids = copies.get(destinationId);
    if (ids) ids.add(editionId);
    else copies.set(destinationId, new Set([editionId]));
  }
  if (!copies.size) return { entries: books, moving: false };
  const entries = books.map(({ path, book }) => {
    const ids = copies.get(book.id);
    const marker = book.pendingMove;
    if (!ids && !marker?.backup) return { path, book };
    const editions = book.editions.filter(({ id }) => !ids?.has(id));
    if (marker?.backup && !hasEdition(book, marker.editionId))
      editions.push(readEditionBackup(marker.backup).edition);
    return { path, book: { ...book, editions } };
  });
  return { entries, moving: true };
}
