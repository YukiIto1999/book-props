import { Setting, type ButtonComponent } from "obsidian";
import type { BibliographySources } from "../adapters/bibliography-sources.ts";
import type { Catalog, Product } from "../catalog/catalog.ts";
import { mountNdlCredit } from "./ndl-credit.ts";
import { isOptionKey } from "./option-keys.ts";

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
  sources: BibliographySources;
  signal: AbortSignal;
  choose: (book: Product) => void;
}>;
type LookupOutcome =
  | Readonly<{ kind: "found"; candidates: Product[] }>
  | Readonly<{ kind: "invalidIsbn" }>;

/** Accepts only credential-free HTTPS product pages; throws when the input is not a URL at all. */
function productUrl(needle: string): URL | undefined {
  const input = new URL(needle);
  return input.protocol === "https:" && !input.username && !input.password ? input : undefined;
}

async function findCandidates(
  method: LookupMode,
  needle: string,
  url: URL | undefined,
  { catalog, sources, signal }: LookupContext,
): Promise<LookupOutcome> {
  if (method === "url") {
    const candidate = url ? await sources.productPage(url, signal) : undefined;
    return { kind: "found", candidates: candidate ? [candidate] : [] };
  }
  if (method === "title")
    return { kind: "found", candidates: await sources.search("title", needle, signal) };
  const normalized = catalog.normalizeIsbns([needle]);
  if (normalized.kind === "invalid") return { kind: "invalidIsbn" };
  // 一つの入力は正規化した一つのISBNになるので、ない場合は確認数字の誤りと同じく扱う。
  const [isbn] = normalized.values;
  if (isbn === undefined) return { kind: "invalidIsbn" };
  return { kind: "found", candidates: await sources.search("isbn", isbn, signal) };
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

export function mountBibliography(parent: HTMLElement, context: LookupContext): void {
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
    button.setButtonText("書誌を取得").onClick(() => runLookup(button, form, view, context)),
  );
  mountNdlCredit(parent);
}
