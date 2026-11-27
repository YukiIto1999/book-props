import { get } from "node:https";
import { extractProduct, siteOf } from "@book-props/book-products";
import { product, type Product } from "@book-props/vault-contract";
import type { BibliographyLookup } from "../catalog/ports.ts";
import type { CatalogCore, CatalogueRecord } from "../core/catalog-core.ts";
import { optionalField } from "../shared/optional-field.ts";
import { readNdlItems, type NdlItem } from "./ndl-records.ts";
import { Busy, Pacer, retryAfter } from "./ndl-pacer.ts";

const api = "https://ndlsearch.ndl.go.jp/api/opensearch";

/** 書誌の候補。国立国会図書館サーチの書誌には、そのISBNのシリーズと日本十進分類法の番号を添える。 */
type FoundProduct = Product & { series?: string; classification?: string };

/** 書誌の取得先。ISBNと書名は国立国会図書館サーチ、商品URLは対応サイトの商品ページ。 */
export type BibliographySources = Readonly<{
  search(mode: "isbn" | "title", query: string, signal: AbortSignal): Promise<FoundProduct[]>;
  productPage(url: URL, signal: AbortSignal): Promise<Product | undefined>;
}>;

/** 書誌を保存する表記にし、ISBNを比べるcoreの規則。 */
type SourceRules = Pick<CatalogCore, "describeRecord" | "normalizeIsbns">;

/** 問い合わせの目的。画面から探すときは短く待ち、登録後の照会は国立国会図書館サーチの遅さに合わせて待つ。 */
type Purpose = Readonly<{ timeout: number; agent: string }>;
const interactive: Purpose = {
  timeout: 9000,
  agent: "Book Props/0.1 (interactive bibliographic lookup)",
};
const background: Purpose = {
  timeout: 30_000,
  agent: "Book Props/0.1 (bibliographic lookup by ISBN after registration)",
};

function publicText(url: URL, accept: string, signal: AbortSignal, purpose: Purpose) {
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  const request = get(
    url,
    {
      signal: AbortSignal.any([signal, AbortSignal.timeout(purpose.timeout)]),
      headers: { Accept: accept, "User-Agent": purpose.agent },
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
      const chunks: Buffer[] = [];
      let length = 0;
      response.on("data", (chunk: Buffer) => {
        length += chunk.length;
        if (length <= 5 * 1024 * 1024) chunks.push(chunk);
        else response.destroy(new Error("書誌の応答が大きすぎます。"));
      });
      response.once("error", reject);
      response.once("end", () => resolve(Buffer.concat(chunks, length).toString("utf8")));
    },
  );
  request.once("error", reject);
  return promise;
}

/** 国立国会図書館の蔵書だけを、指定した件数まで探す。 */
async function ndlItems(
  query: Readonly<Record<string, string>>,
  count: number,
  signal: AbortSignal,
  purpose: Purpose,
): Promise<NdlItem[]> {
  const url = new URL(api);
  url.searchParams.set("dpid", "iss-ndl-opac");
  url.searchParams.set("cnt", String(count));
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  const accept = "application/rss+xml,application/xml,text/xml";
  return readNdlItems(await publicText(url, accept, signal, purpose));
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
  const html = await publicText(url, "text/html", signal, interactive);
  const parsed = product.safeParse(
    extractProduct(new DOMParser().parseFromString(html, "text/html"), url.href),
  );
  return parsed.success ? parsed.data : undefined;
}

/**
 * 書誌の取得先。画面からの検索と商品ページの取得に加え、登録後の照会と表記をそろえる案で使う、
 * ISBN一つにつき一件の国立国会図書館サーチへの問い合わせを持つ。この問い合わせは`pacer`で
 * 間をあけて一つずつ行い、混み合っていれば待って問い直す。
 */
export function bibliographySources(rules: SourceRules): BibliographySources & BibliographyLookup {
  const pacer = new Pacer();
  return {
    async search(mode, query, signal) {
      const items = await ndlItems({ [mode]: query }, 12, signal, interactive);
      return items.filter(({ book }) => book).flatMap((item) => candidate(rules, item));
    },
    productPage: lookupProduct,
    async record(isbn, signal) {
      const items = await pacer.ask(() => ndlItems({ isbn }, 5, signal, background), signal);
      return chooseRecord(items, isbn, rules);
    },
  };
}
