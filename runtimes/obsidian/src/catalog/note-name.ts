/**
 * 本ページのファイル名の決め方。書名に本IDから作る短い符号を括弧で添え、「書名 (7b91b5a8).md」とする。
 * 符号はどの端末でも本IDだけで決まるので、同期の前に別の端末が同じ書名の本を登録しても、8桁の符号が一致しない限り（約43億分の1）名前は重ならない。
 * 本はYAMLの本IDで識別するので、ファイル名は読みやすさのためにあり、利用者が変えてもよい。
 */
import { sha256Hex } from "../shared/sha256.ts";
import type { BookContext } from "./book-change.ts";
import type { NoteFileName } from "./ports.ts";
import { Refuse } from "./purchase.ts";

/** WindowsとmacOSのファイル名、またはObsidianのリンクで使えない文字と、置き換える全角の文字。 */
const replacements: Readonly<Record<string, string>> = {
  "\\": "＼",
  "/": "／",
  ":": "：",
  "*": "＊",
  "?": "？",
  '"': "＂",
  "<": "＜",
  ">": "＞",
  "|": "｜",
  "#": "＃",
  "^": "＾",
  "[": "［",
  "]": "］",
};
const forbidden = /[\\/:*?"<>|#^[\]]/gu;
/** 最初の`.`より前が、空白を除いて装置名になる名前。Windowsは拡張子が付いても装置として扱う。 */
const reserved = /^(?:con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]) *(?:\.|$)/iu;
/** `crypto.randomUUID()`が作るUUIDv4。先頭の12桁が乱数なので、そのまま符号に使える。 */
const randomUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
/**
 * 書名の部分の上限。UTF-8で数えるファイルシステムでも、本IDそのものを括弧で添えた
 * 「 (」36文字「).md」の42バイトを足して、ファイル名の上限の255バイトに収まる。
 */
const maxGraphemes = 80;
const maxBytes = 255 - 42;
const untitled = "無題の本";
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const utf8 = new TextEncoder();

function trimEnds(name: string): string {
  return name.replace(/^[\s.]+/u, "").replace(/[\s.]+$/u, "");
}

/** 文字の途中や結合した絵文字の途中で切らずに、上限までの書名を残す。 */
function truncate(name: string): string {
  let kept = "";
  let count = 0;
  let bytes = 0;
  for (const { segment } of graphemes.segment(name)) {
    count++;
    bytes += utf8.encode(segment).length;
    if (count > maxGraphemes || bytes > maxBytes) break;
    kept += segment;
  }
  return kept;
}

/** 書名を、どのOSとObsidianのリンクでも使えるファイル名の部分にする。 */
export function titleStem(title: string): string {
  const cleaned = title
    .normalize("NFC")
    .replace(/[\s\p{Cc}]+/gu, (run) => (/\s/u.test(run) ? " " : ""))
    // The stored subtitle separator 「 : 」 reads as one full-width colon in a file name, without the spaces around it.
    .replace(/ *: */gu, "：")
    .replace(forbidden, (character) => replacements[character] ?? character);
  const stem = trimEnds(truncate(trimEnds(cleaned))) || untitled;
  return reserved.test(stem) ? `_${stem}` : stem;
}

/** 短い順の符号。UUIDv4は先頭の桁を、それ以外のIDはSHA-256の先頭の桁を使い、最後は本IDそのもの。 */
export async function bookCodes(bookId: string): Promise<readonly string[]> {
  const hex = randomUuid.test(bookId) ? bookId.replaceAll("-", "") : await sha256Hex(bookId);
  return [hex.slice(0, 8), hex.slice(0, 12), bookId];
}

/** WindowsとmacOSのファイルシステムと同じく、大文字と小文字を区別せずに名前を比べる。 */
function nameKey(name: string): string {
  return name.normalize("NFC").toLowerCase();
}

/** 短い符号から順に、`taken`にない名前を選ぶ。どの符号でも重なれば`undefined`。 */
function freeName(stem: string, codes: readonly string[], taken: ReadonlySet<string>) {
  return codes.map((code) => `${stem} (${code}).md`).find((name) => !taken.has(nameKey(name)));
}

/**
 * フォルダにある名前と重ならない、本ページのファイル名。重なるときだけ長い符号を使う。
 * @param codes - `bookCodes`が返した、短い順の符号
 * @param existing - 同じフォルダにあるファイルとフォルダの名前
 */
export function noteFileName(
  title: string,
  codes: readonly string[],
  existing: Iterable<string>,
): string {
  const name = freeName(titleStem(title), codes, new Set(Array.from(existing, nameKey)));
  if (name === undefined) throw new Error("本ページと同じ名前のファイルがあります。");
  return name;
}

/** 本の書名と本IDから、フォルダにある名前を受け取ってファイル名を決める関数を作る。 */
export async function noteNaming(title: string, bookId: string): Promise<NoteFileName> {
  const codes = await bookCodes(bookId);
  return (existing) => noteFileName(title, codes, existing);
}

/** 名前を確かめる本ページ。`codes`は`bookCodes`が返した符号。 */
export type NamedNote = Readonly<{
  path: string;
  bookId: string;
  title: string;
  codes: readonly string[];
}>;

/** 本ページ一冊の、いまの名前`from`と新しい名前`to`。`bookId`と`title`は一覧を作ったときの値。 */
export type NoteRename = Readonly<{
  path: string;
  bookId: string;
  title: string;
  from: string;
  to: string;
}>;

export type RenameResult = Readonly<{ renamed: number; skipped: number; failed: number }>;

/**
 * 名前がいまの書名と本IDから決まる名前でない本ページと、それぞれの新しい名前。重なりを避けて
 * 長い符号を使った名前は、そのままにする。新しい名前は、パスの順に前の本ページを変えた後の
 * フォルダで、大文字と小文字を区別せずに重ならないように決める。
 * @param folders - フォルダごとの、その直下にあるファイルとフォルダの名前
 */
export function renameCandidates(
  notes: readonly NamedNote[],
  folders: ReadonlyMap<string, readonly string[]>,
): NoteRename[] {
  const taken = new Map<string, Set<string>>();
  const renames: NoteRename[] = [];
  for (const { path, bookId, title, codes } of [...notes].sort((a, b) =>
    a.path < b.path ? -1 : 1,
  )) {
    const slash = path.lastIndexOf("/");
    const folder = path.slice(0, slash);
    const from = path.slice(slash + 1);
    const stem = titleStem(title);
    if (codes.some((code) => `${stem} (${code}).md` === from.normalize("NFC"))) continue;
    const names = taken.get(folder) ?? new Set(Array.from(folders.get(folder) ?? [], nameKey));
    taken.set(folder, names);
    names.delete(nameKey(from));
    const to = freeName(stem, codes, names);
    names.add(nameKey(to ?? from));
    if (to !== undefined) renames.push({ path, bookId, title, from, to });
  }
  return renames;
}

/** 書籍の保存範囲の本ページを読み、名前を変える本ページを選ぶ。本でないページと読めない本ページは扱わない。 */
export async function proposeNoteRenames({ files, notes }: BookContext): Promise<NoteRename[]> {
  const named: NamedNote[] = [];
  for (const path of files.versions().keys()) {
    let book;
    try {
      book = notes.readScoped(await files.read(path));
    } catch {
      continue;
    }
    if (book)
      named.push({ path, bookId: book.id, title: book.title, codes: await bookCodes(book.id) });
  }
  const folders = new Map<string, readonly string[]>();
  for (const { path } of named) {
    const folder = path.slice(0, path.lastIndexOf("/"));
    if (!folders.has(folder)) folders.set(folder, files.names(folder));
  }
  return renameCandidates(named, folders);
}

/** 一冊の本ページを、一覧を作ったときと同じ本と書名で、新しい名前が空いているときだけ変える。 */
async function renameOne({ files, notes }: BookContext, rename: NoteRename): Promise<void> {
  if (!files.versions().has(rename.path)) throw new Refuse("conflict");
  const book = notes.readScoped(await files.read(rename.path));
  if (book?.id !== rename.bookId || book.title !== rename.title) throw new Refuse("conflict");
  await files.rename(rename.path, (existing) => {
    if (Array.from(existing, nameKey).includes(nameKey(rename.to))) throw new Refuse("conflict");
    return rename.to;
  });
}

/** 選んだ本ページの名前を順に変える。一覧を作った後に変わった本ページと、新しい名前が埋まった本ページは飛ばす。 */
export async function applyNoteRenames(
  context: BookContext,
  chosen: readonly NoteRename[],
): Promise<RenameResult> {
  let renamed = 0;
  let skipped = 0;
  let failed = 0;
  for (const rename of chosen) {
    if (!context.active()) break;
    try {
      await renameOne(context, rename);
      renamed++;
    } catch (error: unknown) {
      if (error instanceof Refuse && error.kind === "conflict") skipped++;
      else failed++;
    }
  }
  return { renamed, skipped, failed };
}
