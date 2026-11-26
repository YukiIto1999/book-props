import { get } from "node:https";
import { extractProduct, siteOf } from "@book-props/book-products";
import { product, type Product } from "@book-props/vault-contract";
import { optionalField } from "../shared/optional-field.ts";

const api = "https://ndlsearch.ndl.go.jp/api/opensearch";
const dc = "http://purl.org/dc/elements/1.1/";
const dcTerms = "http://purl.org/dc/terms/";
const ndl = "http://ndl.go.jp/dcndl/terms/";
const xsi = "http://www.w3.org/2001/XMLSchema-instance";

/** 書誌の取得先。ISBNと書名は国立国会図書館サーチ、商品URLは対応サイトの商品ページ。 */
export type BibliographySources = Readonly<{
  search(mode: "isbn" | "title", query: string, signal: AbortSignal): Promise<Product[]>;
  productPage(url: URL, signal: AbortSignal): Promise<Product | undefined>;
}>;

function publicText(url: URL, accept: string, signal: AbortSignal): Promise<string> {
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  const request = get(
    url,
    {
      signal: AbortSignal.any([signal, AbortSignal.timeout(9000)]),
      headers: {
        Accept: accept,
        "User-Agent": "Book Props/0.1 (interactive bibliographic lookup)",
      },
    },
    (response) => {
      if (response.statusCode !== 200) {
        response.destroy();
        reject(new Error("書誌の取得先が応答しませんでした。"));
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

async function searchNdl(
  mode: "isbn" | "title",
  query: string,
  signal: AbortSignal,
): Promise<Product[]> {
  const url = new URL(api);
  url.searchParams.set("dpid", "iss-ndl-opac");
  url.searchParams.set("cnt", "12");
  url.searchParams.set(mode, query);
  const xml = new DOMParser().parseFromString(
    await publicText(url, "application/rss+xml,application/xml,text/xml", signal),
    "text/xml",
  );
  if (xml.documentElement.localName !== "rss")
    throw new Error("NDLサーチの書誌を読み取れませんでした。");
  return [...xml.querySelectorAll("channel > item")].flatMap((item) => {
    if (
      ![...item.getElementsByTagName("category")].some((category) =>
        /図書|電子書籍/.test(category.textContent ?? ""),
      )
    )
      return [];
    const attr = (ns: string, name: string) =>
      item.getElementsByTagNameNS(ns, name)[0]?.textContent?.trim() || undefined;
    // NDL writes a creator as `藤本, ひとみ, 1951-`; the life dates are authority data, not part of the name.
    const authors = [...item.getElementsByTagNameNS(dc, "creator")].flatMap((node) => {
      const name = node.textContent
        ?.split(",")
        .map((part) => part.trim())
        .filter((part) => !/^\d{3,4}\??-(?:\d{3,4}\??)?$/.test(part))
        .join(" ")
        .trim();
      return name ? [name] : [];
    });
    const isbns = [...item.getElementsByTagNameNS(dc, "identifier")].flatMap((node) => {
      const value = node.textContent?.trim();
      return value && node.getAttributeNS(xsi, "type") === "dcndl:ISBN" ? [value] : [];
    });
    const [, year, month = "", day = ""] =
      /^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/.exec(attr(dcTerms, "issued") ?? "") ?? [];
    const candidate = product.safeParse({
      ...optionalField("title", attr(dc, "title")),
      authors,
      isbns,
      ...optionalField("label", attr(ndl, "edition")),
      ...optionalField("publisher", attr(dc, "publisher")),
      ...optionalField(
        "publishedOn",
        year === undefined
          ? undefined
          : `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`,
      ),
    });
    return candidate.success && candidate.data.title ? [candidate.data] : [];
  });
}

async function lookupProduct(url: URL, signal: AbortSignal): Promise<Product | undefined> {
  if (!siteOf(url.href)) return undefined;
  url.search = "";
  url.hash = "";
  const html = await publicText(url, "text/html", signal);
  const parsed = product.safeParse(
    extractProduct(new DOMParser().parseFromString(html, "text/html"), url.href),
  );
  return parsed.success ? parsed.data : undefined;
}

export const bibliographySources: BibliographySources = {
  search: searchNdl,
  productPage: lookupProduct,
};
