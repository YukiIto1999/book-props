/**
 * 本ページのファイル名の決め方。書名に本IDから作る短い符号を括弧で添え、「書名 (7b91b5a8).md」とする。
 * 符号はどの端末でも本IDだけで決まるので、同期の前に別の端末が同じ書名の本を登録しても、8桁の符号が一致しない限り（約43億分の1）名前は重ならない。
 * 本はYAMLの本IDで識別するので、ファイル名は読みやすさのためにあり、利用者が変えてもよい。
 */
import { sha256Hex } from "../shared/sha256.ts";
import type { StoredBook } from "./catalog.ts";
import type { BookFiles, NoteFileName } from "./ports.ts";

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
  const taken = new Set(Array.from(existing, nameKey));
  const stem = titleStem(title);
  for (const code of codes) {
    const name = `${stem} (${code}).md`;
    if (!taken.has(nameKey(name))) return name;
  }
  throw new Error("本ページと同じ名前のファイルがあります。");
}

/** 本の書名と本IDから、フォルダにある名前を受け取ってファイル名を決める関数を作る。 */
export async function noteNaming(title: string, bookId: string): Promise<NoteFileName> {
  const codes = await bookCodes(bookId);
  return (existing) => noteFileName(title, codes, existing);
}

/** ファイル名が本IDに`.md`を付けただけの本ページか。以前の版はこの名前で作っていた。 */
function namedAfterId({ path, book }: StoredBook): boolean {
  return path.slice(path.lastIndexOf("/") + 1) === `${book.id}.md`;
}

export type RenameResult = Readonly<{ renamed: number; failed: number }>;

/** ファイル名が本IDのままの本ページだけを、書名の名前に変える。ほかの本ページには触れない。 */
export async function renameIdNamed(
  files: Pick<BookFiles, "rename">,
  entries: readonly StoredBook[],
  active: () => boolean,
): Promise<RenameResult> {
  let renamed = 0;
  let failed = 0;
  for (const entry of entries.filter(namedAfterId)) {
    if (!active()) break;
    try {
      await files.rename(entry.path, await noteNaming(entry.book.title, entry.book.id));
      renamed++;
    } catch {
      failed++;
    }
  }
  return { renamed, failed };
}
