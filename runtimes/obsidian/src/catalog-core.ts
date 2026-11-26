import type { EditionRecord } from "./book-note.ts";
import type { Operation, Outcome, StoredBook } from "./catalog.ts";
import { isJsonObject } from "./json-object.ts";
import { optionalField } from "./optional-field.ts";

export type Ownership =
  | "sameEdition"
  | "otherEdition"
  | "unknownEdition"
  | "unowned"
  | "undetermined";
type EditionPatch = Partial<Omit<EditionRecord, "id" | "owned" | "archivedAt">>;
/** 目録が判定した、利用者に確かめる内容または書き込む内容。 */
export type Decision =
  | { kind: "none" | "insufficientEvidence" | "conflictingEvidence" }
  | { kind: "invalidIsbn"; input: string }
  | { kind: "chooseBook"; bookIds: string[] }
  | { kind: "chooseEdition"; editionIds: string[] }
  | { kind: "createBook"; wanted: boolean; recordEdition: boolean }
  | { kind: "addEdition"; wantedBefore: boolean; wantedAfter: boolean }
  | {
      kind: "update";
      wantedBefore: boolean;
      wantedAfter: boolean;
      ownedBefore?: boolean;
      ownedAfter?: boolean;
      editionPatch?: EditionPatch;
    };

const ownerships: Readonly<Record<Ownership, true>> = {
  sameEdition: true,
  otherEdition: true,
  unknownEdition: true,
  unowned: true,
  undetermined: true,
};

function catalogEdition({ id, isbns, label, owned, archivedAt, ...details }: EditionRecord) {
  return { id, isbns, label, owned, archivedAt, details };
}

/** 目録の判定に渡すJSONを、操作と書籍の保存範囲にある本から作る。 */
export function catalogInput(operation: Operation, entries: readonly StoredBook[]): string {
  const { action, product, selection } = operation;
  const { title, authors, isbns, label, ...details } = product;
  const books = entries.map(({ book }) => ({
    id: book.id,
    title: book.title,
    authors: book.authors,
    wanted: book.wanted,
    archivedAt: book.archivedAt,
    editions: book.editions.map(catalogEdition),
  }));
  return JSON.stringify({
    action,
    product: { title, authors, isbns, label, details },
    selection,
    books,
  });
}

function invalid(): never {
  throw new Error("目録の判定結果を読み取れません。");
}

function isOwnership(value: unknown): value is Ownership {
  return typeof value === "string" && Object.hasOwn(ownerships, value);
}

function isTextList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function flag(value: unknown): boolean {
  return typeof value === "boolean" ? value : invalid();
}

function text(value: unknown): string {
  return typeof value === "string" ? value : invalid();
}

function optionalText(value: unknown): string | undefined {
  return value === undefined ? undefined : text(value);
}

function texts(value: unknown): string[] {
  return isTextList(value) ? value : invalid();
}

function decodePatch(value: unknown): EditionPatch | undefined {
  if (value === undefined) return undefined;
  if (!isJsonObject(value)) return invalid();
  return {
    ...optionalField("isbns", value.isbns === undefined ? undefined : texts(value.isbns)),
    ...optionalField("label", optionalText(value.label)),
    ...optionalField("publisher", optionalText(value.publisher)),
    ...optionalField("publishedOn", optionalText(value.publishedOn)),
    ...optionalField("cover", optionalText(value.cover)),
    ...optionalField("purchasedOn", optionalText(value.purchasedOn)),
    ...optionalField("purchasedFrom", optionalText(value.purchasedFrom)),
  };
}

function decodeDecision(value: unknown): Decision {
  if (!isJsonObject(value)) return invalid();
  const { kind } = value;
  switch (kind) {
    case "none":
    case "insufficientEvidence":
    case "conflictingEvidence":
      return { kind };
    case "invalidIsbn":
      return { kind, input: text(value.input) };
    case "chooseBook":
      return { kind, bookIds: texts(value.bookIds) };
    case "chooseEdition":
      return { kind, editionIds: texts(value.editionIds) };
    case "createBook":
      return { kind, wanted: flag(value.wanted), recordEdition: flag(value.recordEdition) };
    case "addEdition":
      return { kind, wantedBefore: flag(value.wantedBefore), wantedAfter: flag(value.wantedAfter) };
    case "update":
      return {
        kind,
        wantedBefore: flag(value.wantedBefore),
        wantedAfter: flag(value.wantedAfter),
        ...optionalField(
          "ownedBefore",
          value.ownedBefore === undefined ? undefined : flag(value.ownedBefore),
        ),
        ...optionalField(
          "ownedAfter",
          value.ownedAfter === undefined ? undefined : flag(value.ownedAfter),
        ),
        ...optionalField("editionPatch", decodePatch(value.editionPatch)),
      };
    default:
      return invalid();
  }
}

/** 目録の判定結果のJSONを、想定した形であることを確かめながら読み取る。 */
export function decodeOutcome(json: string): Outcome {
  const value: unknown = JSON.parse(json);
  if (!isJsonObject(value)) return invalid();
  const { ownership, bookId, editionId } = value;
  if (!isOwnership(ownership)) return invalid();
  return {
    ownership,
    wanted: flag(value.wanted),
    bookId: bookId === null ? null : text(bookId),
    editionId: editionId === null ? null : text(editionId),
    decision: decodeDecision(value.decision),
    isbns: texts(value.isbns),
  };
}
