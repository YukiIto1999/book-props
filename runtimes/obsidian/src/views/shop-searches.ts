export type ShopSearch = Readonly<{ name: string; url: string }>;

const bookoffSearch = "https://shopping.bookoff.co.jp/search/keyword/";

function searchUrl(base: string, parameter: string, query: string): string {
  const url = new URL(base);
  url.searchParams.set(parameter, query);
  return url.href;
}

/** 本棚の検索語で、登録していない本を書店で探すリンク。 */
export function shopSearches(text: string): ShopSearch[] {
  const query = text.trim().replace(/\s+/g, " ");
  if (!query) return [];
  const searches: ShopSearch[] = [
    { name: "Amazon", url: searchUrl("https://www.amazon.co.jp/s", "k", query) },
    { name: "楽天ブックス", url: searchUrl("https://books.rakuten.co.jp/search", "sitem", query) },
    {
      name: "バリューブックス",
      url: searchUrl("https://www.valuebooks.jp/search", "keyword", query),
    },
  ];
  const bookoff = new URL(bookoffSearch + encodeURIComponent(query)).href;
  if (
    bookoff.startsWith(bookoffSearch) &&
    decodeURIComponent(bookoff.slice(bookoffSearch.length)) === query
  )
    searches.push({ name: "BOOKOFF", url: bookoff });
  return searches;
}
