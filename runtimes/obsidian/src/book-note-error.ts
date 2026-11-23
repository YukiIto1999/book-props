/** 本ページを読めない、未対応の形式である、または利用者の変更と衝突したことを表す。 */
export class BookNoteError extends Error {
  readonly code: "unreadable" | "unsupported-format" | "conflict";

  constructor(code: BookNoteError["code"], detail: string) {
    super(detail);
    this.name = "BookNoteError";
    this.code = code;
  }
}

export function unreadable(detail: string): never {
  throw new BookNoteError("unreadable", detail);
}
