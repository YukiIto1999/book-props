import type { CatalogueRecord } from "../core/catalog-core.ts";
import { optionalField } from "../shared/optional-field.ts";

const dc = "http://purl.org/dc/elements/1.1/";
const dcTerms = "http://purl.org/dc/terms/";
const dcndl = "http://ndl.go.jp/dcndl/terms/";
const xsi = "http://www.w3.org/2001/XMLSchema-instance";
/** 国立国会図書館の蔵書の書誌。国立国会図書館サーチは、他の機関の書誌も同じ形で返す。 */
const ndlCatalogue = "https://ndlsearch.ndl.go.jp/books/R100000002-";

/** OpenSearchの一件。`record`はcoreに渡す書誌、残りは版の照合と表示に使う値。 */
export type NdlItem = Readonly<{
  record: CatalogueRecord;
  isbns: readonly string[];
  issued?: string;
  /** 国立国会図書館の蔵書の書誌か。 */
  ndl: boolean;
  /** 図書か電子書籍か。 */
  book: boolean;
}>;

/** 要素の属性と、復号する前の中身。 */
type Element = Readonly<{ attributes: string; inner: string }>;

const entities: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function decode(text: string): string {
  const cdata = /^<!\[CDATA\[([\s\S]*)\]\]>$/.exec(text.trim());
  if (cdata) return cdata[1] ?? "";
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name.startsWith("#x") || name.startsWith("#X"))
      return String.fromCodePoint(Number.parseInt(name.slice(2), 16));
    if (name.startsWith("#")) return String.fromCodePoint(Number.parseInt(name.slice(1), 10));
    return entities[name] ?? whole;
  });
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 国立国会図書館サーチのOpenSearchの応答を読む。名前空間の接頭辞は応答の先頭の宣言から引くので、
 * 接頭辞が変わっても同じ要素を読む。
 */
class Feed {
  private readonly prefixes = new Map<string, string>();

  constructor(xml: string) {
    const root = /<rss\b([^>]*)>/.exec(xml);
    if (!root) throw new Error("NDLサーチの書誌を読み取れませんでした。");
    for (const [, prefix = "", uri = ""] of (root[1] ?? "").matchAll(/xmlns:([\w-]+)="([^"]*)"/g))
      this.prefixes.set(uri, prefix);
  }

  private name(namespace: string | undefined, local: string): string {
    if (namespace === undefined) return local;
    const prefix = this.prefixes.get(namespace);
    return prefix === undefined ? `\u0000${local}` : `${prefix}:${local}`;
  }

  elements(source: string, namespace: string | undefined, local: string): Element[] {
    const tag = escape(this.name(namespace, local));
    const pattern = new RegExp(`<${tag}(\\s[^>]*)?(?:/>|>([\\s\\S]*?)</${tag}>)`, "g");
    return [...source.matchAll(pattern)].map(([, attributes = "", inner = ""]) => ({
      attributes,
      inner,
    }));
  }

  texts(source: string, namespace: string | undefined, local: string): string[] {
    return this.elements(source, namespace, local)
      .map(({ inner }) => decode(inner).trim())
      .filter(Boolean);
  }

  typed({ attributes }: Element, type: string): boolean {
    const name = escape(this.name(xsi, "type"));
    return new RegExp(`${name}="${escape(type)}"`).test(attributes);
  }

  /**
   * 件名のうち日本十進分類法の番号を、従う版(`dcndl:NDC10`なら10)とともに応答の順に読む。
   * 版を示さない`dcndl:NDC`の番号は、版なしとして読む。どの番号をとるかはcoreが決める。
   */
  ndcNumbers(source: string): NonNullable<CatalogueRecord["ndc"]> {
    const type = new RegExp(`${escape(this.name(xsi, "type"))}="dcndl:NDC(\\d*)"`);
    return this.elements(source, dc, "subject").flatMap(({ attributes, inner }) => {
      const [, edition] = type.exec(attributes) ?? [];
      if (edition === undefined) return [];
      const stated = edition ? Number(edition) : undefined;
      return [{ ...optionalField("edition", stated), number: decode(inner).trim() }];
    });
  }

  item(source: string): NdlItem | undefined {
    const [title] = this.texts(source, dc, "title");
    if (!title) return undefined;
    const creators = this.texts(source, dc, "creator");
    const [author] = this.texts(source, undefined, "author");
    // <author> lists the catalogue forms, then the responsibility statement.
    const listed = creators.length ? `${creators.join(",")},` : "";
    const statement = author?.startsWith(listed) ? author.slice(listed.length) : undefined;
    const [edition] = this.texts(source, dcndl, "edition");
    const [issued] = this.texts(source, dcTerms, "issued");
    const [guid = ""] = this.texts(source, undefined, "guid");
    const isbns = this.elements(source, dc, "identifier")
      .filter((element) => this.typed(element, "dcndl:ISBN"))
      .map(({ inner }) => decode(inner).trim());
    const record: CatalogueRecord = {
      title,
      creators,
      ...optionalField("statement", statement),
      publishers: this.texts(source, dc, "publisher"),
      series: this.texts(source, dcndl, "seriesTitle"),
      ...optionalField("edition", edition),
      ndc: this.ndcNumbers(source),
    };
    return {
      record,
      isbns,
      ...optionalField("issued", issued),
      ndl: guid.startsWith(ndlCatalogue),
      book: this.texts(source, undefined, "category").some((text) => /図書|電子書籍/.test(text)),
    };
  }
}

/** 国立国会図書館サーチのOpenSearchの応答にある書誌を、応答の順に読む。応答でなければ例外。 */
export function readNdlItems(xml: string): NdlItem[] {
  const feed = new Feed(xml);
  return feed.elements(xml, undefined, "item").flatMap(({ inner }) => feed.item(inner) ?? []);
}
