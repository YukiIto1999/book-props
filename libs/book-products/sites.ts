// Evidence read from a store page. Callers validate it against their own wire schema.
type ProductEvidence = {
  title?: string;
  label?: string;
  authors?: string[];
  isbns?: string[];
  publisher?: string;
  publishedOn?: string;
  cover?: string;
};
type SchemaSite = "bookoff" | "valuebooks";

export const sites = [
  { name: "Amazon", url: "https://www.amazon.co.jp/" },
  { name: "楽天ブックス", url: "https://books.rakuten.co.jp/" },
  { name: "バリューブックス", url: "https://www.valuebooks.jp/" },
  { name: "BOOKOFF", url: "https://shopping.bookoff.co.jp/" },
] as const;

type Site = "amazon" | "rakuten" | "valuebooks" | "bookoff";
export function siteOf(url: string): Site | undefined {
  try {
    const { protocol, hostname, pathname, port, username, password } = new URL(url);
    if (protocol !== "https:" || port || username || password) return undefined;
    if (
      hostname === "www.amazon.co.jp" &&
      /\/(?:dp|gp\/product)\/[A-Z0-9]{10}(?:\/|$)/.test(pathname)
    )
      return "amazon";
    if (hostname === "books.rakuten.co.jp" && /^\/rb\/[0-9]+\/?$/.test(pathname)) return "rakuten";
    if (hostname === "www.valuebooks.jp" && /\/bp\/VS[0-9]+\/?$/.test(pathname))
      return "valuebooks";
    if (hostname === "shopping.bookoff.co.jp" && /^\/(?:used|new)\/[0-9]+\/?$/.test(pathname))
      return "bookoff";
  } catch {
    return undefined;
  }
}

function clean(text?: string | null): string | undefined {
  return (
    text
      ?.replace(/[\u200e\u200f]/g, "")
      .replace(/\s+/g, " ")
      .trim() || undefined
  );
}

function direct(element: Element | null): string | undefined {
  return clean(
    element &&
      [...element.childNodes]
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent)
        .join(" "),
  );
}

// Reads one field of parsed JSON-LD without trusting its shape.
function property(source: unknown, key: string): unknown {
  return typeof source === "object" && source !== null ? Reflect.get(source, key) : undefined;
}

function personName(item: unknown): string | undefined {
  if (typeof item === "string") return item;
  const name = property(item, "name");
  return typeof name === "string" ? name : undefined;
}

function names(source: unknown): string[] {
  return (Array.isArray(source) ? source : [source]).flatMap((item: unknown) => {
    const name = clean(personName(item))?.replace(
      /\s*(?:\((?:著|著者|Author)\)|（(?:著|著者)）| 著)$/u,
      "",
    );
    return name ? [name] : [];
  });
}

function isbnFields(...values: unknown[]): string[] {
  return [
    ...new Set(
      values
        .flat()
        .flatMap((value) =>
          typeof value === "string"
            ? (
                clean(value)?.match(/\b(?:97[89][\d\s-]{10,20}\d|\d[\d\s-]{8,14}[\dXx])\b/g) ?? []
              ).map((isbn) => isbn.replace(/[\s-]/g, ""))
            : [],
        ),
    ),
  ];
}

function httpsImage(value: unknown, base: string): string | undefined {
  const source = Array.isArray(value) ? value[0] : value;
  if (typeof source !== "string" || !source) return undefined;
  try {
    const url = new URL(source, base);
    return url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function date(value?: string): string | undefined {
  if (!value) return undefined;
  const numeric = /^(\d{4})[年/.-](\d{1,2})[月/.-](\d{1,2})(?:日|$)/.exec(value);
  if (numeric) return `${numeric[1]}-${numeric[2].padStart(2, "0")}-${numeric[3].padStart(2, "0")}`;
  const english = /^[A-Za-z]+ \d{1,2}, \d{4}$/.test(value) ? new Date(value + " UTC") : undefined;
  return english && Number.isFinite(english.getTime())
    ? english.toISOString().slice(0, 10)
    : undefined;
}

function titleEvidence(input: string): { title: string; label?: string } {
  const token = "改訂新版|増補改訂版|改訂版|増補版|新版|初版|第[０-９0-9]+版";
  // \s also matches the ideographic space U+3000
  const leading = new RegExp(`^(${token})\\s+`, "u").exec(input);
  const trailing = new RegExp(`(?:\\s+|[（(])(${token})[）)]?$`, "u").exec(input);
  const label = leading?.[1] ?? trailing?.[1];
  return {
    title: leading
      ? input.slice(leading[0].length).trim()
      : trailing
        ? input.slice(0, trailing.index).trim()
        : input,
    label,
  };
}

function amazon(doc: Document, url: string): ProductEvidence | undefined {
  const title = clean(doc.querySelector("#productTitle")?.textContent);
  if (!title) return undefined;
  const authors = names(
    [...doc.querySelectorAll("#bylineInfo .author")].map((element) =>
      clean(element.querySelector("a")?.textContent ?? element.textContent),
    ),
  );
  const field = (name: string) =>
    clean(
      doc.querySelector(`#rpi-attribute-book_details-${name} .a-size-base.a-color-base`)
        ?.textContent,
    ) ??
    clean(doc.querySelector(`#rpi-attribute-book_details-${name}`)?.textContent)?.replace(
      /^(?:ISBN-1[03]|Publisher|出版(?:社|日)|Publication date|発売日)\s*[:：]?\s*/i,
      "",
    );
  const isbns = isbnFields(
    field("isbn13"),
    field("isbn10"),
    ...[...doc.querySelectorAll("#detailBullets_feature_div li")].map((row) => {
      const label = clean(row.querySelector("span.a-text-bold")?.textContent);
      return label?.startsWith("ISBN-")
        ? clean(row.querySelector("span.a-text-bold + span")?.textContent)
        : undefined;
    }),
  );
  if (!isbns.length && !authors.length && !doc.querySelector('[id^="rpi-attribute-book_details"]'))
    return undefined;
  return {
    ...titleEvidence(title),
    authors,
    isbns,
    publisher: field("publisher"),
    publishedOn: date(field("publication_date")),
    cover: httpsImage(doc.querySelector("#imgBlkFront,#landingImage")?.getAttribute("src"), url),
  };
}

function rakuten(doc: Document, url: string): ProductEvidence | undefined {
  const heading = doc.querySelector('h1[itemprop="name"]');
  const title = direct(heading);
  if (!title || !heading) return undefined;
  const fields = new Map(
    [...doc.querySelectorAll("li.productInfo")].map((row) => [
      clean(row.querySelector(".category")?.textContent),
      clean(row.querySelector(".categoryValue")?.textContent),
    ]),
  );
  const isbns = isbnFields(fields.get("ISBN"));
  const authors = names(
    [...heading.querySelectorAll(".authorLink a")].map((a) => clean(a.textContent)),
  );
  if (!isbns.length && !authors.length) return undefined;
  return {
    ...titleEvidence(title),
    isbns,
    authors,
    // 楽天は出版社を「発行元」と表示する商品がある。「発売元」は販売を担う別の会社なので使わない。
    publisher: fields.get("出版社") ?? fields.get("発行元"),
    publishedOn: date(fields.get("発売日")),
    cover: httpsImage(doc.querySelector('meta[property="og:image"]')?.getAttribute("content"), url),
  };
}

function parseJson(text: string | null): unknown {
  try {
    return JSON.parse(text ?? "null");
  } catch {
    return undefined;
  }
}

function isSchemaBook(item: unknown, site: SchemaSite): boolean {
  if ([property(item, "@type")].flat().includes("Book")) return true;
  const examples = property(item, "workExample");
  return (
    site === "bookoff" &&
    Array.isArray(examples) &&
    examples.some((example: unknown) => property(example, "@type") === "Book")
  );
}

function releaseText(doc: Document, site: SchemaSite): string | undefined {
  if (site === "bookoff") {
    const row = [...doc.querySelectorAll(".productDetail__table tr")].find(
      (candidate) => clean(candidate.querySelector("th")?.textContent) === "発売年月日",
    );
    return direct(row?.querySelector("td") ?? null);
  }
  const row = [...doc.querySelectorAll("li")].find((candidate) =>
    /^出版日[：:]/.test(clean(candidate.textContent) ?? ""),
  );
  return direct(row ?? null)
    ?.replace(/^出版日[：:]\s*/, "")
    .split(" ")[0];
}

function bookFromSchema(
  item: unknown,
  doc: Document,
  site: SchemaSite,
  url: string,
): ProductEvidence | undefined {
  if (!isSchemaBook(item, site)) return undefined;
  const name = property(item, "name");
  const title = typeof name === "string" ? clean(name) : undefined;
  if (!title) return undefined;
  return {
    ...titleEvidence(title),
    authors: names(property(item, "author")),
    isbns: isbnFields(property(item, "isbn"), property(item, "gtin13")),
    publisher: names(property(item, "publisher") ?? property(item, "brand"))[0],
    publishedOn: date(releaseText(doc, site)),
    cover: httpsImage(property(item, "image"), url),
  };
}

function schemaBook(doc: Document, site: SchemaSite, url: string): ProductEvidence | undefined {
  for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
    const book = bookFromSchema(parseJson(script.textContent), doc, site, url);
    if (book) return book;
  }
  return undefined;
}

// Returns unvalidated evidence; consumers must decode it with their wire schema before use.
export function extractProduct(doc: Document, url = doc.URL): ProductEvidence | undefined {
  const site = siteOf(url);
  if (site === "amazon") return amazon(doc, url);
  if (site === "rakuten") return rakuten(doc, url);
  return site ? schemaBook(doc, site, url) : undefined;
}
