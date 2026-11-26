import { get } from "node:https";
import { Setting, type ButtonComponent } from "obsidian";
import { extractProduct, siteOf } from "@book-props/book-products";
import { product } from "@book-props/vault-contract";
import type { Catalog, Product } from "./catalog.ts";
import { isOptionKey } from "./option-keys.ts";
import { optionalField } from "./optional-field.ts";

const api = "https://ndlsearch.ndl.go.jp/api/opensearch";
const ndlCatalogue = "https://ndlsearch.ndl.go.jp/help/api/provider#opac";
const dc = "http://purl.org/dc/elements/1.1/";
const dcTerms = "http://purl.org/dc/terms/";
const ndl = "http://ndl.go.jp/dcndl/terms/";
const xsi = "http://www.w3.org/2001/XMLSchema-instance";
const lookupModes = { isbn: "ISBN", title: "書名", url: "商品URL" } as const;
type LookupMode = keyof typeof lookupModes;
/** The entered method and query; `generation` counts their changes so an older lookup cannot fill the view. */
type LookupForm = {
  mode: LookupMode;
  query: string;
  generation: number;
  pending: AbortController | undefined;
};
type LookupView = Readonly<{ status: HTMLElement; results: HTMLElement }>;
type LookupContext = Readonly<{
  catalog: Catalog;
  signal: AbortSignal;
  choose: (book: Product) => void;
}>;
type LookupOutcome =
  | Readonly<{ kind: "found"; candidates: Product[] }>
  | Readonly<{ kind: "invalidIsbn" }>;

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

/** Accepts only credential-free HTTPS product pages; throws when the input is not a URL at all. */
function productUrl(needle: string): URL | undefined {
  const input = new URL(needle);
  return input.protocol === "https:" && !input.username && !input.password ? input : undefined;
}

async function findCandidates(
  method: LookupMode,
  needle: string,
  url: URL | undefined,
  { catalog, signal }: LookupContext,
): Promise<LookupOutcome> {
  if (method === "url") {
    const candidate = url ? await lookupProduct(url, signal) : undefined;
    return { kind: "found", candidates: candidate ? [candidate] : [] };
  }
  if (method === "title")
    return { kind: "found", candidates: await searchNdl("title", needle, signal) };
  const normalized = catalog.normalizeIsbns([needle]);
  if ("invalid" in normalized) return { kind: "invalidIsbn" };
  // 一つの入力は正規化した一つのISBNになるので、ない場合は確認数字の誤りと同じく扱う。
  const [isbn] = normalized.values;
  if (isbn === undefined) return { kind: "invalidIsbn" };
  return { kind: "found", candidates: await searchNdl("isbn", isbn, signal) };
}

function lookupFailed({ status, results }: LookupView, url?: URL): void {
  status.setText("書誌を取得できません。手入力でも登録できます。");
  if (url)
    results.createEl("a", {
      text: "商品をブラウザで開く",
      attr: { href: url.href, target: "_blank", rel: "noopener noreferrer" },
    });
}

function showCandidates(
  { status, results }: LookupView,
  candidates: readonly Product[],
  choose: (book: Product) => void,
): void {
  status.setText("候補を選ぶと入力欄に反映します。選ぶだけでは保存しません。");
  for (const candidate of candidates) {
    const parts = [
      candidate.title,
      candidate.authors?.join("、"),
      candidate.label,
      candidate.isbns?.join("、"),
      candidate.publisher,
    ];
    new Setting(results).setName(parts.filter(Boolean).join(" ／ ")).addButton((button) =>
      button.setButtonText("この書誌を使う").onClick(() => {
        choose(candidate);
        results.empty();
        status.setText("書誌を入力欄に反映しました。");
      }),
    );
  }
}

/** Forgets the shown candidates and stops a running lookup, so only the current method and query can fill the view. */
function resetLookup(form: LookupForm, view: LookupView): void {
  form.generation += 1;
  form.pending?.abort();
  form.pending = undefined;
  view.status.empty();
  view.results.empty();
}

async function runLookup(
  button: ButtonComponent,
  form: LookupForm,
  view: LookupView,
  context: LookupContext,
): Promise<void> {
  resetLookup(form, view);
  const needle = form.query.trim();
  const method = form.mode;
  if (!needle || needle.length > (method === "url" ? 2048 : 512)) {
    view.status.setText("取得方法と入力を確認してください。");
    return;
  }
  const { generation } = form;
  const lookup = new AbortController();
  form.pending = lookup;
  const signal = AbortSignal.any([context.signal, lookup.signal]);
  // An answer counts only for the lookup still current: not after the modal closed or the method or query changed, even back to the same text.
  const isCurrent = (): boolean => !signal.aborted && form.generation === generation;
  button.setDisabled(true);
  view.status.setText("書誌を取得しています…");
  let url: URL | undefined;
  try {
    url = method === "url" ? productUrl(needle) : undefined;
    const outcome = await findCandidates(method, needle, url, { ...context, signal });
    if (!isCurrent()) return;
    if (outcome.kind === "invalidIsbn") view.status.setText("ISBNの確認数字を確認してください。");
    else if (outcome.candidates.length) showCandidates(view, outcome.candidates, context.choose);
    else lookupFailed(view, url);
  } catch {
    if (isCurrent()) lookupFailed(view, url);
  } finally {
    if (form.pending === lookup) form.pending = undefined;
    button.setDisabled(false);
  }
}

function mountCredit(parent: HTMLElement): void {
  const credit = parent.createEl("p");
  credit.createSpan({ text: "書誌検索: " });
  credit.createEl("a", {
    text: "国立国会図書館サーチAPI／国立国会図書館蔵書",
    attr: { href: ndlCatalogue, target: "_blank", rel: "noopener noreferrer" },
  });
  credit.createSpan({ text: "（" });
  credit.createEl("a", {
    text: "CC BY 4.0",
    attr: {
      href: "https://creativecommons.org/licenses/by/4.0/deed.ja",
      target: "_blank",
      rel: "noopener noreferrer",
    },
  });
  credit.createSpan({ text: "）" });
}

export function mountBibliography(
  parent: HTMLElement,
  catalog: Catalog,
  signal: AbortSignal,
  choose: (book: Product) => void,
): void {
  const form: LookupForm = { mode: "isbn", query: "", generation: 0, pending: undefined };
  const view: LookupView = {
    status: parent.doc.createElement("p"),
    results: parent.doc.createElement("div"),
  };
  view.status.setAttribute("role", "status");
  const setting = new Setting(parent)
    .setName("書誌の取得")
    .setDesc(
      "ISBNと書名は国立国会図書館サーチで検索します。商品URLは対応サイトの商品詳細だけが対象です。",
    )
    .addDropdown((field) => {
      field.selectEl.setAttribute("aria-label", "取得方法");
      field.addOptions(lookupModes).onChange((value) => {
        if (!isOptionKey(lookupModes, value)) return;
        form.mode = value;
        resetLookup(form, view);
      });
    })
    .addText((field) => {
      field.inputEl.setAttribute("aria-label", "書誌検索の入力");
      field.onChange((value) => {
        form.query = value;
        resetLookup(form, view);
      });
    });
  parent.append(view.status, view.results);
  setting.addButton((button) =>
    button
      .setButtonText("書誌を取得")
      .onClick(() => runLookup(button, form, view, { catalog, signal, choose })),
  );
  mountCredit(parent);
}
