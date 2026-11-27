import type { CatalogueRecord } from "../core/catalog-core.ts";

/**
 * 目録の操作が使う外部の口。Vaultのファイルと、Vaultの外に控えた版の置き場所と、
 * 国立国会図書館サーチの書誌を、adaptersがこの形で実装する。
 */

/**
 * 国立国会図書館サーチで、ISBN一つにつき一件の書誌を探す。国立国会図書館の書誌がなければ
 * `undefined`、問い合わせられなければ例外。
 */
export interface BibliographyLookup {
  record(isbn: string, signal: AbortSignal): Promise<CatalogueRecord | undefined>;
}

/** 版を移動するあいだVaultの外に控えた版。`snapshot`は版の内容の署名。 */
export type MoveCopy = Readonly<{
  editionId: string;
  sourceId: string;
  destinationId: string;
  snapshot: string;
}>;

export interface MoveCopies {
  keep(copy: MoveCopy): Promise<void>;
  list(): Promise<readonly MoveCopy[]>;
}

/** 同じフォルダにあるファイルとフォルダの名前を受け取り、本ページのファイル名を決める。 */
export type NoteFileName = (existing: Iterable<string>) => string;

/** 書籍の保存範囲の本ページ。 */
export interface BookFiles {
  readonly moveCopies: MoveCopies;
  versions(): ReadonlyMap<string, string>;
  read(path: string): Promise<string>;
  process(path: string, update: (raw: string, currentPath: string) => string): Promise<string>;
  /** 書籍フォルダかその中のフォルダの、直下にあるファイルとフォルダの名前。 */
  names(folder: string): readonly string[];
  /** 書籍フォルダの直下に本ページを作り、そのパスを返す。 */
  create(fileName: NoteFileName, raw: string): Promise<string>;
  /** 本ページを同じフォルダの中で改名し、リンクも直す。改名後のパスを返す。 */
  rename(path: string, fileName: NoteFileName): Promise<string>;
  canUpdate(path: string, latest: string): boolean;
}
