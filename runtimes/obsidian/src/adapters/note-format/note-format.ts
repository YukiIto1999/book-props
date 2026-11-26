import { isMap, parseDocument, stringify } from "yaml";
import type {
  AppliedPurchase,
  BookRecord,
  BookUpdate,
  Capture,
  CustomField,
  EditionRecord,
  PendingMove,
} from "./book-record.ts";
import {
  appendRows,
  dropEditionRow,
  fieldEdits,
  spliceNote,
  storeEdition,
  storePurchase,
  type Plain,
} from "./edit.ts";
import { BookNoteError, unreadable } from "./error.ts";
import { map, parseNote, readEditionBackup, type NoteRules, type ParsedNote } from "./parse.ts";
import { confirmsUpdate, updateEdits } from "./update.ts";
import { customFieldEdits, decodeCustomField, plainMap } from "./values.ts";

/**
 * 開始の`---`だけが消えた本ページか。先頭から最初の`---`の行まで(なければ全文)が
 * 正しいYAMLのマップで、`book-props`に`book-id`か`schema`があるときだけ本ページとみなす。
 */
function lostOpening(raw: string): boolean {
  const text = raw.replace(/^\uFEFF/, "");
  const close = /^---[ \t]*\r?$/m.exec(text);
  const source = close ? text.slice(0, close.index) : text;
  if (!/^(?:book-props|["']book-props["']):/m.test(source)) return false;
  const doc = parseDocument(source, { uniqueKeys: true, strict: true });
  if (doc.errors.length || !isMap(doc.contents)) return false;
  const managed = doc.contents.get("book-props", true);
  return isMap(managed) && (managed.has("book-id") || managed.has("schema"));
}

function editionAt(book: BookRecord, editionId: string): { index: number; edition: EditionRecord } {
  const index = book.editions.findIndex(({ id }) => id === editionId);
  const edition = book.editions[index];
  if (!edition) throw new BookNoteError("conflict", "対象の版がありません。");
  return { index, edition };
}

/**
 * 本ページの書式。本ページのYAMLを読み、書き換える。保存済みのISBNの検査はcoreの規則で行うので、
 * 起動したcoreを受け取って作る。
 */
export class NoteFormat {
  private readonly rules: NoteRules;

  constructor(rules: NoteRules) {
    this.rules = rules;
  }

  private parse(raw: string): ParsedNote {
    return parseNote(raw, this.rules);
  }

  create(book: BookRecord): string {
    const source = stringify(
      {
        "book-title": book.title,
        "book-authors": book.authors.length ? book.authors : undefined,
        "book-wanted": book.wanted,
        "book-reading-status": book.readingStatus,
        "book-finished-on": book.finishedOn,
        tags: book.tags?.length ? book.tags : undefined,
        "book-props": {
          schema: 1,
          "book-id": book.id,
          "archived-at": book.archivedAt,
          editions: book.editions.map(storeEdition),
          "applied-purchases": book.appliedPurchases.map(storePurchase),
        },
      },
      { lineWidth: 0 },
    );
    const raw = `---\n${source}---\n`;
    this.parse(raw);
    return raw;
  }

  /** 書籍の保存範囲のファイルを読む。本ページでなければ`undefined`、壊れた本ページなら例外。 */
  readScoped(raw: string): BookRecord | undefined {
    const start = /^\uFEFF?---[ \t]*\r?\n/.exec(raw);
    if (!start) {
      return lostOpening(raw) ? unreadable("本ページの先頭の --- がありません。") : undefined;
    }
    const close = /^---[ \t]*(?:\r?\n|$)/m.exec(raw.slice(start[0].length));
    const source = raw.slice(start[0].length, close ? start[0].length + close.index : undefined);
    const doc = parseDocument(source, { uniqueKeys: true, strict: true });
    const declared =
      (isMap(doc.contents) && doc.contents.has("book-props")) ||
      /^(?:book-props|["']book-props["']):/m.test(source);
    if (declared) return this.parse(raw).book;
    if (doc.errors.length) return unreadable("書籍フォルダのYAMLを読み取れません。");
    return undefined;
  }

  read(raw: string): Readonly<{ book: BookRecord }> {
    const { book } = this.parse(raw);
    return { book };
  }

  /** 移動中の版の控えを、版とその署名として読む。 */
  readEditionBackup(signature: string): Capture & { edition: EditionRecord } {
    return readEditionBackup(signature, this.rules);
  }

  /** 購入希望、版、適用済み購入だけを書き換える。他の行と本文は一文字も変えない。 */
  writeUpdate(raw: string, input: BookUpdate): string {
    const note = this.parse(raw);
    const saved = spliceNote(raw, note.header, updateEdits(note, input));
    if (!confirmsUpdate(this.parse(saved).book, input)) {
      return unreadable("YAMLへの更新を確認できません。");
    }
    return saved;
  }

  /**
   * 選んだ適用済み購入の記録だけを取り除く。他の行と本文は一文字も変えない。
   * @param remove - 本ページにある購入の記録ごとに、取り除くかを返す判定
   */
  removePurchases(
    raw: string,
    remove: (purchases: readonly AppliedPurchase[]) => readonly boolean[],
  ): string {
    const { header, managed, book } = this.parse(raw);
    const removed = remove(book.appliedPurchases);
    const keep = book.appliedPurchases.filter((_, index) => removed[index] !== true);
    if (keep.length === book.appliedPurchases.length) return raw;
    const rows = keep.map(storePurchase);
    const saved = spliceNote(
      raw,
      header,
      fieldEdits(header, managed, { "applied-purchases": rows }),
    );
    const confirmed = this.parse(saved).book.appliedPurchases;
    const kept =
      keep.length === confirmed.length &&
      keep.every(
        (entry, index) =>
          entry.requestId === confirmed[index]?.requestId &&
          entry.clientId === confirmed[index]?.clientId &&
          entry.inputHash === confirmed[index]?.inputHash,
      );
    if (!kept) return unreadable("古い購入の再確認記録だけを取り除けません。");
    return saved;
  }

  captureEdition(raw: string, editionId: string): Capture | undefined {
    const { book, editions } = this.parse(raw);
    const index = book.editions.findIndex(({ id }) => id === editionId);
    if (index < 0) return undefined;
    const content = plainMap(map(editions.items[index], "版"));
    return { content, signature: JSON.stringify(content) };
  }

  markEditionMove(raw: string, move: PendingMove | null): string {
    const { header, managed } = this.parse(raw);
    const pending = move ? JSON.stringify(move) : null;
    const saved = spliceNote(raw, header, fieldEdits(header, managed, { "pending-move": pending }));
    const actual = this.parse(saved).book.pendingMove;
    if (
      actual?.editionId !== move?.editionId ||
      actual?.destinationId !== move?.destinationId ||
      actual?.digest !== move?.digest ||
      actual?.backup !== move?.backup
    ) {
      return unreadable("版の移動記録を確定できません。");
    }
    return saved;
  }

  insertTransferredEdition(raw: string, edition: Capture): string {
    const { header, editions, book } = this.parse(raw);
    const editionId = edition.content.id;
    if (typeof editionId !== "string" || book.editions.some(({ id }) => id === editionId)) {
      throw new BookNoteError("conflict", "移動先に対象の版があります。");
    }
    const saved = spliceNote(raw, header, [
      appendRows(header, editions, "editions", [edition.content]),
    ]);
    if (this.captureEdition(saved, editionId)?.signature !== edition.signature) {
      return unreadable("移動する版の項目を保持できません。");
    }
    return saved;
  }

  removeEdition(raw: string, editionId: string): string {
    const { header, editions, book } = this.parse(raw);
    const saved = spliceNote(raw, header, [
      dropEditionRow(header, editions, editionAt(book, editionId).index),
    ]);
    const confirmed = this.parse(saved).book;
    const removed =
      confirmed.editions.length === book.editions.length - 1 &&
      !confirmed.editions.some(({ id }) => id === editionId);
    if (!removed) return unreadable("指定した版だけを取り除けません。");
    return saved;
  }

  setArchivedAt(raw: string, editionId: string | undefined, at: string | null): string {
    const { header, managed, editions, book } = this.parse(raw);
    const index = editionId ? editionAt(book, editionId).index : -1;
    const node = editionId ? map(editions.items[index], "版") : managed;
    const saved = spliceNote(raw, header, fieldEdits(header, node, { "archived-at": at }));
    const confirmed = this.parse(saved).book;
    const archivedAt = editionId ? confirmed.editions[index]?.archivedAt : confirmed.archivedAt;
    if (archivedAt !== (at ?? undefined)) return unreadable("アーカイブを確定できません。");
    return saved;
  }

  editEdition(raw: string, input: EditionRecord): string {
    const { header, editions, book } = this.parse(raw);
    const { index, edition } = editionAt(book, input.id);
    const previous = storeEdition(edition);
    const fields: Record<string, Plain> = {};
    for (const [key, value] of Object.entries(storeEdition(input))) {
      if (key === "id" || key === "archived-at") continue;
      if (JSON.stringify(previous[key]) !== JSON.stringify(value)) fields[key] = value ?? null;
    }
    const saved = spliceNote(
      raw,
      header,
      fieldEdits(header, map(editions.items[index], "版"), fields),
    );
    const actual = this.parse(saved).book.editions[index];
    if (!actual || JSON.stringify(storeEdition(actual)) !== JSON.stringify(storeEdition(input))) {
      return unreadable("版の変更を確定できません。");
    }
    return saved;
  }

  /** 独自項目を一つ足す、変える、または取り除く。変えてよいかはcoreが本ページの最新の内容で決める。 */
  updateCustomField(
    raw: string,
    baseline: CustomField | undefined,
    input: CustomField | undefined,
  ): string {
    const { header, managed, book } = this.parse(raw);
    const fields = [...(book.customFields ?? [])];
    const index = fields.findIndex(({ name }) => name === baseline?.name);
    const field = input ? decodeCustomField(input) : undefined;
    if (index >= 0) fields.splice(index, 1, ...(field ? [field] : []));
    else if (field) fields.push(field);
    const saved = spliceNote(raw, header, customFieldEdits(header, managed, index, field));
    if (JSON.stringify(this.parse(saved).book.customFields) !== JSON.stringify(fields)) {
      return unreadable("独自項目を保存できません。");
    }
    return saved;
  }
}
