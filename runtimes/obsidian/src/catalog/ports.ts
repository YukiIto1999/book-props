/**
 * 目録の操作が使う外部の口。Vaultのファイルと、Vaultの外に控えた版の置き場所を、
 * adaptersがこの形で実装する。
 */

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
  /** 書籍フォルダの直下に本ページを作り、そのパスを返す。 */
  create(fileName: NoteFileName, raw: string): Promise<string>;
  /** 本ページを同じフォルダの中で改名し、リンクも直す。改名後のパスを返す。 */
  rename(path: string, fileName: NoteFileName): Promise<string>;
  canUpdate(path: string, latest: string): boolean;
}
