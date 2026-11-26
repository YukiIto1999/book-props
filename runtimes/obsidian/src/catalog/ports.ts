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

/** 書籍の保存範囲の本ページ。 */
export interface BookFiles {
  readonly moveCopies: MoveCopies;
  versions(): ReadonlyMap<string, string>;
  read(path: string): Promise<string>;
  process(path: string, update: (raw: string, currentPath: string) => string): Promise<string>;
  create(bookId: string, raw: string): Promise<string>;
  canUpdate(path: string, latest: string): boolean;
}
