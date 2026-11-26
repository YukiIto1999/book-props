import { change, Stop, type BookContext, type Scope } from "./book-change.ts";
import type { Management, ManagementResult } from "./book-management.ts";
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
import { catalogEdition, catalogMarker } from "./catalog-core.ts";
import { assertUnchanged } from "./catalog-purchase.ts";
import { readCatalog } from "./catalog-read.ts";
import type { StoredBook } from "./catalog.ts";
import type { MoveCopy } from "./edition-recovery.ts";
import type { MoveStage } from "./wasm.ts";

async function signatureOf(value: string): Promise<string> {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

type Verified = Readonly<{ path: string; version: string; raw: string }>;

/** coreが決めた段階を順に進めるあいだに分かった、移動の状態。 */
type Move = {
  source: StoredBook;
  marker?: PendingMove;
  captured?: Capture | undefined;
  edition?: EditionRecord;
  destination?: StoredBook;
  verified?: Verified | undefined;
  /** Vaultの外に控えた版の内容の署名。 */
  retained?: string;
};

function held<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("版の移動の段階が、必要な値を得る前に来ました。");
  return value;
}

function stillVerified({ files }: BookContext, { path, version, raw }: Verified): boolean {
  return files.versions().get(path) === version && files.canUpdate(path, raw);
}

/** 移動先に、移動する版が控えと同じ内容で書かれ、まだ変わっていないか。 */
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

function moveCopy(source: StoredBook, marker: PendingMove, captured: Capture): MoveCopy {
  return {
    editionId: marker.editionId,
    sourceId: source.book.id,
    destinationId: marker.destinationId,
    snapshot: captured.signature,
  };
}

/** 移動元に記録された移動を、coreが本ページから決めた段階で続ける。 */
async function resume(scope: Scope, move: Move): Promise<ManagementResult> {
  const { context, progress } = scope;
  progress.moveStarted = true;
  const { value: entries } = await readCatalog(context.files);
  const { path, book } = move.source;
  const sourceRaw = await context.files.read(path);
  const latest = readScopedNote(sourceRaw);
  if (latest?.id !== book.id || !context.files.canUpdate(path, sourceRaw)) return "pending";
  const plan = context.rules.resume(entries, book, latest);
  const marker = book.pendingMove;
  if (plan.kind === "pending" || !marker) return "pending";
  const backup =
    plan.from === "backup" && marker.backup ? readEditionBackup(marker.backup) : undefined;
  const captured = backup ?? captureEdition(sourceRaw, marker.editionId);
  const edition = backup?.edition ?? latest.editions.find(({ id }) => id === marker.editionId);
  const destination = entries.find(({ book: { id } }) => id === marker.destinationId);
  if (!captured || !edition || !destination) return "pending";
  if ((await signatureOf(captured.signature)) !== marker.digest) return "pending";
  if (!backup) removeEdition(sourceRaw, marker.editionId);
  Object.assign(move, { marker, captured, edition, destination });
  return run(scope, move, plan.stages);
}

async function copyEdition({ context }: Scope, move: Move): Promise<ManagementResult | undefined> {
  const [marker, captured, edition] = [held(move.marker), held(move.captured), held(move.edition)];
  const step = { kind: "copyEdition", edition: catalogEdition(edition) } as const;
  const path = await change(context, held(move.destination), step, (raw) => {
    const existing = captureEdition(raw, edition.id);
    if (!existing) return insertTransferredEdition(raw, captured);
    if (existing.signature !== captured.signature) throw new Stop("conflict");
    return raw;
  });
  move.verified = await verifyDestination(context, path, marker, captured);
  return move.verified ? undefined : "pending";
}

async function recordBackup({ context }: Scope, move: Move): Promise<undefined> {
  const [marker, captured, verified] = [
    held(move.marker),
    held(move.captured),
    held(move.verified),
  ];
  const backup = { ...marker, backup: captured.signature };
  const step = { kind: "recordBackup", marker: catalogMarker(marker) } as const;
  const path = await change(context, move.source, step, (raw) => {
    if (
      !stillVerified(context, verified) ||
      captureEdition(raw, marker.editionId)?.signature !== captured.signature
    )
      throw new Stop("conflict");
    return markEditionMove(removeEdition(raw, marker.editionId), backup);
  });
  move.source = { ...move.source, path };
  move.marker = backup;
  return undefined;
}

/** 移動先を確かめ直してから移動記録を消し、移動元に版がなく移動先にあることを確かめる。 */
async function clearMove({ context }: Scope, move: Move): Promise<ManagementResult> {
  const [marker, captured] = [held(move.marker), held(move.captured)];
  const verified = await verifyDestination(context, held(move.verified).path, marker, captured);
  if (!verified) return "pending";
  const step = { kind: "clearMove", marker: catalogMarker(marker) } as const;
  const path = await change(context, move.source, step, (raw) => {
    if (!stillVerified(context, verified)) throw new Stop("conflict");
    return markEditionMove(raw, null);
  });
  const finished = readScopedNote(await context.files.read(path));
  if (
    finished?.id !== move.source.book.id ||
    finished.pendingMove ||
    finished.editions.some(({ id }) => id === marker.editionId)
  )
    return "pending";
  return (await verifyDestination(context, verified.path, marker, captured)) ? "saved" : "pending";
}

/** 移動記録を消して版を移動元に残す。移動元が版を手放していれば、記録した控えから戻す。 */
async function cancelMove(scope: Scope, move: Move): Promise<ManagementResult> {
  const { context, source, versions, progress } = scope;
  const marker = held(move.marker);
  const backup = marker.backup ? held(move.captured) : undefined;
  const step = { kind: "cancelMove", marker: catalogMarker(marker) } as const;
  const path = await change(context, move.source, step, (raw) => {
    assertUnchanged(versions, context.files.versions(), source.path, source.path);
    const updated = markEditionMove(backup ? insertTransferredEdition(raw, backup) : raw, null);
    progress.moveStarted = true;
    return updated;
  });
  const finished = readScopedNote(await context.files.read(path));
  return finished?.id === source.book.id &&
    !finished.pendingMove &&
    finished.editions.some(({ id }) => id === marker.editionId)
    ? "saved"
    : "pending";
}

/** 移動元に移動記録を書く。版はまだ移動元に残し、取り除けることだけを確かめる。 */
async function markMove(
  { context, progress }: Scope,
  move: Move,
): Promise<ManagementResult | undefined> {
  const [marker, captured] = [held(move.marker), held(move.captured)];
  const path = await change(context, move.source, { kind: "markMove" }, (raw) => {
    if (captureEdition(raw, marker.editionId)?.signature !== captured.signature)
      throw new Stop("conflict");
    const updated = markEditionMove(raw, marker);
    removeEdition(updated, marker.editionId);
    progress.moveStarted = true;
    return updated;
  });
  const staged = readScopedNote(await context.files.read(path));
  if (staged?.id !== move.source.book.id || staged.pendingMove?.digest !== marker.digest)
    return "pending";
  move.source = { path, book: staged };
  return undefined;
}

async function keepCopy({ context }: Scope, move: Move): Promise<undefined> {
  const captured = held(move.captured);
  if (move.retained !== captured.signature)
    await context.files.moveCopies.keep(moveCopy(move.source, held(move.marker), captured));
  move.retained = captured.signature;
  return undefined;
}

function runStage(scope: Scope, move: Move, stage: MoveStage) {
  switch (stage) {
    case "keepCopy":
      return keepCopy(scope, move);
    case "markMove":
      return markMove(scope, move);
    case "resume":
      return resume(scope, move);
    case "copyEdition":
      return copyEdition(scope, move);
    case "recordBackup":
      return recordBackup(scope, move);
    case "clearMove":
      return clearMove(scope, move);
    case "cancelMove":
      return cancelMove(scope, move);
  }
}

/** coreが決めた順に段階を進める。結果を返した段階で止まる。 */
async function run(
  scope: Scope,
  move: Move,
  stages: readonly MoveStage[],
): Promise<ManagementResult> {
  for (const stage of stages) {
    const settled = await runStage(scope, move, stage);
    if (settled) return settled;
  }
  return "pending";
}

/** 移動を始める前に、両方の本ページを書き換えられることと、移動する版の内容を確かめる。 */
async function prepareStart(
  { context, source, entries }: Scope,
  { editionId, destinationId }: Readonly<{ editionId: string; destinationId: string }>,
): Promise<Move | ManagementResult> {
  const destination = entries.find(({ book }) => book.id === destinationId);
  if (!destination) return "conflict";
  const [sourceRaw, destinationRaw] = await Promise.all([
    context.files.read(source.path),
    context.files.read(destination.path),
  ]);
  const writable =
    context.files.canUpdate(source.path, sourceRaw) &&
    context.files.canUpdate(destination.path, destinationRaw);
  if (!writable) return "unavailable";
  const captured = captureEdition(sourceRaw, editionId);
  if (!captured) return "conflict";
  const digest = await signatureOf(captured.signature);
  return { source, marker: { editionId, destinationId, digest }, captured };
}

/** 取り消しで戻す控えが、移動を始めたときの内容と同じかを確かめる。 */
async function prepareCancel({ source }: Scope): Promise<Move | ManagementResult> {
  const marker = source.book.pendingMove;
  if (!marker) return "conflict";
  const captured = marker.backup ? readEditionBackup(marker.backup) : undefined;
  if (captured && (await signatureOf(captured.signature)) !== marker.digest) return "pending";
  return { source, marker, captured };
}

/**
 * 版の移動を、coreが決めた段階で進める。移動元に移動記録を書いてから版を移動先へ写し、
 * 写せたことを確かめてから移動元から取り除く。途中で止まった移動は記録から再開できる。
 */
export async function runMove(
  scope: Scope,
  command: Management,
  stages: readonly MoveStage[],
): Promise<ManagementResult> {
  let move: Move | ManagementResult = { source: scope.source };
  if (command.action === "move") move = await prepareStart(scope, command);
  else if (command.action === "cancelMove") move = await prepareCancel(scope);
  return typeof move === "string" ? move : run(scope, move, stages);
}
