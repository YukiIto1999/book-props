import type { IncomingMessage } from "node:http";
import { get } from "node:https";
import { pipeline, type Readable, type Transform } from "node:stream";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import { extractProduct, siteOf } from "@book-props/book-products";
import { product, type Product } from "@book-props/vault-contract";
import type { BibliographyLookup } from "../catalog/ports.ts";
import type { CatalogCore, CatalogueRecord } from "../core/catalog-core.ts";
import { optionalField } from "../shared/optional-field.ts";
import { readNdlItems, type NdlItem } from "./ndl-records.ts";
import { Busy, Pacer, retryAfter, type Priority } from "./ndl-pacer.ts";

const api = "https://ndlsearch.ndl.go.jp/api/opensearch";

/** 書誌の候補。国立国会図書館サーチの書誌には、そのISBNのシリーズと日本十進分類法の番号を添える。 */
type FoundProduct = Product & { series?: string; classification?: string };

/**
 * 画面からの検索の進み具合。`asking`は国立国会図書館サーチに問い合わせを送ったこと、`busy`は
 * 混み合っていると断られ、待ってから問い直すこと。知らせる前は、前の問い合わせが終わるのを待っている。
 */
export type SearchProgress = "asking" | "busy";

/** 画面からの検索の結果。問い直しても混み合っていると断られたら`busy`。 */
type SearchOutcome =
  | Readonly<{ kind: "found"; candidates: FoundProduct[] }>
  | Readonly<{ kind: "busy" }>;

/** 書誌の取得先。ISBNと書名は国立国会図書館サーチ、商品URLは対応サイトの商品ページ。 */
export type BibliographySources = Readonly<{
  search(
    mode: "isbn" | "title",
    query: string,
    signal: AbortSignal,
    progress?: (state: SearchProgress) => void,
  ): Promise<SearchOutcome>;
  productPage(url: URL, signal: AbortSignal): Promise<Product | undefined>;
}>;

/** 書誌を保存する表記にし、ISBNを比べるcoreの規則。 */
type SourceRules = Pick<CatalogCore, "describeRecord" | "normalizeIsbns">;

/**
 * 応答を待つ上限。国立国会図書館サーチは、キャッシュにない問い合わせに答えるまで2秒から45秒かかり
 * (2026-11-29に測定)、一度答えた問い合わせには直後から即座に答える。上限が短いと、初めて調べる本だけが
 * 取得できず、問い直すと取得できる。画面からの検索も登録後の照会も、この遅さに合わせて待つ。
 */
const deadline = 60_000;

/** 取得先に伝える問い合わせの目的。画面からの検索か、登録後の照会か。 */
const agents: Readonly<Record<Priority, string>> = {
  interactive: "Book Props/0.1 (interactive bibliographic lookup)",
  background: "Book Props/0.1 (bibliographic lookup by ISBN after registration)",
};

/** 応答の圧縮のうち、読める方式。問い合わせではこれだけを受け付けると伝える。 */
const decoders: Readonly<Record<string, (() => Transform) | undefined>> = {
  identity: undefined,
  gzip: createGunzip,
  "x-gzip": createGunzip,
  deflate: createInflate,
  br: createBrotliDecompress,
};
const acceptEncoding = "gzip, deflate, br";
/** 展開した後の応答本文の上限。圧縮された小さな応答が大きく膨らんでも、ここで読むのをやめる。 */
const bodyLimit = 5 * 1024 * 1024;

/**
 * 応答本文を`Content-Encoding`に従って展開し、UTF-8の文字列にする。
 * Amazonは`Accept-Encoding`のない問い合わせにもgzipで応えるので、圧縮を外さずに読むと商品ページにならない。
 *
 * 文字列には`Buffer#toString`ではなく大域の`TextDecoder`を使う。Nodeが`Buffer`から作る約1 MB以上の文字列は
 * V8の外部文字列になり、Obsidian 1.15.1(Electron 43)のレンダラーはそれを`DOMParser`に渡すと異常終了する。
 * レンダラーの大域の`TextDecoder`はChromiumのもので、V8の通常の文字列を返す。
 */
export async function responseText(response: IncomingMessage): Promise<string> {
  const encoding = (response.headers["content-encoding"] ?? "identity").trim().toLowerCase();
  if (!Object.hasOwn(decoders, encoding)) {
    response.destroy();
    throw new Error("書誌の応答を読めませんでした。");
  }
  const decoder = decoders[encoding];
  const body: Readable = decoder ? pipeline(response, decoder(), () => undefined) : response;
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of body) {
    if (!Buffer.isBuffer(chunk)) throw new Error("書誌の応答を読めませんでした。");
    length += chunk.length;
    if (length > bodyLimit) throw new Error("書誌の応答が大きすぎます。");
    chunks.push(chunk);
  }
  return new TextDecoder().decode(Buffer.concat(chunks, length));
}

function publicText(url: URL, accept: string, signal: AbortSignal, priority: Priority) {
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  const request = get(
    url,
    {
      signal: AbortSignal.any([signal, AbortSignal.timeout(deadline)]),
      headers: {
        Accept: accept,
        "Accept-Encoding": acceptEncoding,
        "User-Agent": agents[priority],
      },
    },
    (response) => {
      if (response.statusCode !== 200) {
        response.destroy();
        const header = response.headers["retry-after"];
        reject(
          response.statusCode === 429
            ? new Busy(retryAfter(header, Date.now()))
            : new Error("書誌の取得先が応答しませんでした。"),
        );
        return;
      }
      responseText(response).then(resolve, reject);
    },
  );
  request.once("error", reject);
  return promise;
}

/** 国立国会図書館サーチが同時アクセス数の上限を知らせる本文。状態コード200で返ることもある。 */
const tooManyRequests = /^\s*(?:<\?xml[^>]*>\s*)?<error>\s*<code>429<\/code>/;

/** 国立国会図書館の蔵書だけを、指定した件数まで探す。 */
async function ndlItems(
  query: Readonly<Record<string, string>>,
  count: number,
  signal: AbortSignal,
  priority: Priority,
): Promise<NdlItem[]> {
  const url = new URL(api);
  url.searchParams.set("dpid", "iss-ndl-opac");
  url.searchParams.set("cnt", String(count));
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  const accept = "application/rss+xml,application/xml,text/xml";
  const text = await publicText(url, accept, signal, priority);
  if (tooManyRequests.test(text)) throw new Busy();
  return readNdlItems(text);
}

function publishedOn(issued: string | undefined): string | undefined {
  const [, year, month = "", day = ""] =
    /^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/.exec(issued ?? "") ?? [];
  return year === undefined
    ? undefined
    : `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

/** 国立国会図書館サーチの書誌を、保存する表記の登録画面の候補にする。 */
function candidate(rules: SourceRules, item: NdlItem): FoundProduct[] {
  const described = rules.describeRecord(JSON.stringify(item.record));
  const parsed = product.safeParse({
    title: described.title,
    authors: described.authors,
    isbns: item.isbns,
    ...optionalField("label", described.label),
    ...optionalField("publisher", described.publisher),
    ...optionalField("publishedOn", publishedOn(item.issued)),
  });
  if (!parsed.success || !parsed.data.title) return [];
  return [
    {
      ...parsed.data,
      ...optionalField("series", described.series),
      ...optionalField("classification", described.classification),
    },
  ];
}

/**
 * 一つのISBNの書誌として、国立国会図書館の蔵書の書誌のうち、そのISBNを持つ最初の図書を選ぶ。
 * 他の機関の書誌は、同じISBNでも句読点や書名の表記が違うので使わない。
 */
export function chooseRecord(
  items: readonly NdlItem[],
  isbn: string,
  rules: Pick<CatalogCore, "normalizeIsbns">,
): CatalogueRecord | undefined {
  const holds = (value: string) => {
    const normalized = rules.normalizeIsbns([value]);
    return normalized.kind === "valid" && normalized.values.includes(isbn);
  };
  return items.find((item) => item.ndl && item.book && item.isbns.some(holds))?.record;
}

async function lookupProduct(url: URL, signal: AbortSignal): Promise<Product | undefined> {
  if (!siteOf(url.href)) return undefined;
  url.search = "";
  url.hash = "";
  const html = await publicText(url, "text/html", signal, "interactive");
  const parsed = product.safeParse(
    extractProduct(new DOMParser().parseFromString(html, "text/html"), url.href),
  );
  return parsed.success ? parsed.data : undefined;
}

/**
 * 書誌の取得先。画面からの検索と商品ページの取得に加え、登録後の照会と表記をそろえる案で使う、
 * ISBN一つにつき一件の国立国会図書館サーチへの問い合わせを持つ。国立国会図書館サーチへの問い合わせは
 * どれも`pacer`で間をあけて一つずつ行い、画面からの検索を先に送り、混み合っていれば待って問い直す。
 */
export function bibliographySources(rules: SourceRules): BibliographySources & BibliographyLookup {
  const pacer = new Pacer();
  return {
    async search(mode, query, signal, progress) {
      try {
        const items = await pacer.ask(
          () => {
            progress?.("asking");
            return ndlItems({ [mode]: query }, 12, signal, "interactive");
          },
          signal,
          { priority: "interactive", onBusy: () => progress?.("busy") },
        );
        const candidates = items
          .filter(({ book }) => book)
          .flatMap((item) => candidate(rules, item));
        return { kind: "found", candidates };
      } catch (error: unknown) {
        if (error instanceof Busy) return { kind: "busy" };
        throw error;
      }
    },
    productPage: lookupProduct,
    async record(isbn, signal) {
      const items = await pacer.ask(() => ndlItems({ isbn }, 5, signal, "background"), signal);
      return chooseRecord(items, isbn, rules);
    },
  };
}
