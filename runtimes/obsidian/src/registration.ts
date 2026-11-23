import {
  Modal,
  Notice,
  Setting,
  type App,
  type ButtonComponent,
  type TextComponent,
} from "obsidian";
import type { BookRecord } from "./book-note.ts";
import { mountBibliography } from "./bibliography.ts";
import type {
  Action,
  Catalog,
  Operation,
  Outcome,
  Product,
  Result,
  Selection,
  StoredBook,
} from "./catalog.ts";
import { isOptionKey } from "./option-keys.ts";
import {
  draftProduct,
  inputLabels,
  inputValues,
  productInputs,
  type ProductInput,
} from "./registration-draft.ts";

type LocalAction = Exclude<Action, "inspect">;
type RegistrationContext = Readonly<{
  catalog: Catalog;
  clientId: string;
  signal: AbortSignal;
  close: () => void;
}>;

const actionLabels: Record<LocalAction, string> = {
  purchase: "購入として登録",
  recordOwnership: "所持を記録",
  setWish: "欲しい本に追加",
  clearWish: "購入希望を解除",
  cancelOwnership: "所有を取り消す",
};
const ownershipLabels = {
  sameEdition: "この版を所持",
  otherEdition: "別版を所持",
  unknownEdition: "所持記録あり・版未確認",
  unowned: "未所有",
  undetermined: "判定不能",
} as const;
const choiceDecisions: readonly string[] = [
  "chooseBook",
  "chooseEdition",
  "insufficientEvidence",
  "conflictingEvidence",
  "invalidIsbn",
];
const unreadableChoices = "書籍フォルダから候補を読み取れませんでした。";
const changedDraft = "入力が変わりました。保存する前に照合結果を確認してください。";
const confirmSave = " 結果を確認し、もう一度「保存」を押してください。";

const operationMessages = {
  saved: "Vaultに保存しました。",
  replayed: "保存済みです。",
  conflict: "競合を検出しました。対象の本・版を確認してください。",
  unavailable: "最新の記録を確認できません。書籍フォルダと開いている編集画面を確認してください。",
  unknown: "保存結果を確認できません。再登録する前に本ページを確認してください。",
  notSaved: "保存しませんでした。",
  observed: "変更対象がありません。",
};

function resultMessage(catalogResult: Result): string {
  if (catalogResult.kind === "unreadable")
    return `「${catalogResult.path}」を読み取れません。${catalogResult.reason} 記録を確認してください。`;
  if (catalogResult.kind !== "needsInput") return operationMessages[catalogResult.kind];
  const decision = catalogResult.outcome.decision;
  if (decision.kind === "invalidIsbn") return `ISBNを確認してください: ${decision.input}`;
  if (decision.kind === "chooseEdition") return "版を特定できません。対象の版を選んでください。";
  if (decision.kind === "chooseBook")
    return "本を一つに特定できません。候補から対象を選んでください。";
  if (decision.kind === "conflictingEvidence")
    return "書誌と選択した記録が一致しません。対象やISBNを確認してください。";
  return "書誌だけでは特定できません。書名を入力し、対象の本を選ぶこともできます。";
}

/** Holds one registration draft: the entered bibliography, the chosen action, and the record the user picked. */
class RegistrationForm {
  private details: Product;
  private action: LocalAction;
  private selection: Selection | undefined;
  // `draft` counts changes to what would be saved and `checks` counts started checks; an answer is shown only while both still match.
  private draft = 0;
  private checks = 0;
  /** The draft whose check result is on screen. Saving any other draft first shows its result and writes nothing. */
  private shown: number | undefined;
  private readonly values: Record<ProductInput, string>;
  private readonly inputs: Partial<Record<ProductInput, TextComponent>> = {};
  private readonly choices: HTMLElement;
  private readonly status: HTMLElement;

  constructor(
    private readonly parent: HTMLElement,
    private readonly context: RegistrationContext,
    private readonly initial: Product,
    intent: LocalAction,
  ) {
    this.details = initial;
    this.action = intent;
    this.values = inputValues(initial);
    this.choices = parent.doc.createElement("div");
    this.status = parent.doc.createElement("p");
    this.status.setAttribute("role", "status");
  }

  mount(): void {
    mountBibliography(this.parent, this.context.catalog, this.context.signal, (product) =>
      this.applyProduct(product),
    );
    for (const name of productInputs) this.mountInput(name);
    new Setting(this.parent).setName("操作").addDropdown((field) => {
      field.selectEl.setAttribute("aria-label", "操作");
      field
        .addOptions(actionLabels)
        .setValue(this.action)
        .onChange((value) => {
          if (!isOptionKey(actionLabels, value)) return;
          this.action = value;
          this.change();
        });
    });
    this.parent.append(this.choices, this.status);
    new Setting(this.parent).addButton((button) =>
      button.setButtonText("照合").onClick(() => this.preview()),
    );
    new Setting(this.parent).addButton((button) =>
      button
        .setButtonText("保存")
        .setCta()
        .onClick(() => this.save(button)),
    );
    if (this.initial.title || this.initial.isbns?.length) void this.preview();
  }

  private mountInput(name: ProductInput): void {
    new Setting(this.parent).setName(inputLabels[name]).addText((field) => {
      this.inputs[name] = field;
      field.inputEl.setAttribute("aria-label", inputLabels[name]);
      field.setValue(this.values[name]).onChange((value) => {
        this.values[name] = value;
        this.change();
      });
    });
  }

  /** Starts a new draft: the chosen record and the shown result described the previous entry. */
  private change(): void {
    this.draft += 1;
    this.shown = undefined;
    this.selection = undefined;
    this.choices.empty();
    this.status.setText(changedDraft);
  }

  private select(selection: Selection | undefined): void {
    this.selection = selection;
    this.draft += 1;
    this.shown = undefined;
    void this.preview();
  }

  private applyProduct(product: Product): void {
    this.details = product;
    Object.assign(this.values, inputValues(product));
    for (const key of productInputs) this.inputs[key]?.setValue(this.values[key]);
    this.change();
    void this.preview();
  }

  private operation(): Operation {
    const product = draftProduct(this.details, this.values, this.context.catalog);
    return { action: this.action, product, selection: this.selection };
  }

  /** Starts a check of the current draft; the returned test fails once the modal closes or a newer change or check begins. */
  private claim(): () => boolean {
    const draft = this.draft;
    const check = ++this.checks;
    return () => !this.context.signal.aborted && this.draft === draft && this.checks === check;
  }

  private chooseEdition(target: BookRecord, editionIds: readonly string[]): void {
    new Setting(this.choices).setName("対象の版").addDropdown((field) => {
      field.selectEl.setAttribute("aria-label", "対象の版");
      field.addOption("", "選択してください");
      if (this.action !== "cancelOwnership") field.addOption("new", "別の版を追加");
      for (const edition of target.editions.filter(({ id }) => editionIds.includes(id))) {
        field.addOption(
          edition.id,
          [edition.label, ...edition.isbns].filter(Boolean).join(" / ") ||
            `版 ${target.editions.indexOf(edition) + 1}`,
        );
      }
      field.onChange((editionId) => {
        this.select(editionId ? { bookId: target.id, editionId } : { bookId: target.id });
      });
    });
  }

  /** Offers every current book, or only the listed candidates when the catalog narrowed them down. */
  private chooseBook(
    entries: readonly StoredBook[],
    candidateIds: readonly string[] | undefined,
  ): void {
    new Setting(this.choices).setName("対象の本").addDropdown((field) => {
      field.selectEl.setAttribute("aria-label", "対象の本");
      field.addOption("", "選択してください");
      if (this.action !== "clearWish" && this.action !== "cancelOwnership")
        field.addOption("new", "別の本として登録");
      for (const { book } of entries) {
        if (book.archivedAt || (candidateIds && !candidateIds.includes(book.id))) continue;
        field.addOption(
          book.id,
          [book.title, ...book.authors, book.editions.find(({ isbns }) => isbns.length)?.isbns[0]]
            .filter(Boolean)
            .join(" / "),
        );
      }
      field.onChange((bookId) => {
        this.select(bookId ? { bookId } : undefined);
      });
    });
  }

  private async showChoices(outcome: Outcome, current: () => boolean): Promise<void> {
    const decision = outcome.decision;
    if (decision.kind === "invalidIsbn" || decision.kind === "conflictingEvidence") return;
    const entries = await this.context.catalog.entries().catch(() => undefined);
    if (!current()) return;
    if (!entries) {
      this.status.setText(unreadableChoices);
      return;
    }
    this.choices.empty();
    const target = entries.find(({ book }) => book.id === outcome.bookId)?.book;
    if (decision.kind === "chooseEdition" && target)
      this.chooseEdition(target, decision.editionIds);
    else if (decision.kind === "chooseBook") this.chooseBook(entries, decision.bookIds);
    else if (decision.kind === "insufficientEvidence") this.chooseBook(entries, undefined);
  }

  private async preview(): Promise<void> {
    const current = this.claim();
    this.shown = undefined;
    this.choices.empty();
    this.status.setText("照合しています…");
    const observation = await this.context.catalog.preview(this.operation());
    if (!current()) return;
    if (observation.kind !== "observed") this.status.setText(resultMessage(observation));
    else if (choiceDecisions.includes(observation.outcome.decision.kind)) {
      this.status.setText(resultMessage({ kind: "needsInput", outcome: observation.outcome }));
      await this.showChoices(observation.outcome, current);
    } else {
      const { ownership, wanted } = observation.outcome;
      const found = ownershipLabels[ownership];
      this.status.setText(wanted ? `${found}／欲しいに登録済み` : found);
      this.shown = this.draft;
    }
  }

  private async save(button: ButtonComponent): Promise<void> {
    if (this.shown !== this.draft) {
      await this.preview();
      if (this.shown === this.draft) this.status.appendText(confirmSave);
      return;
    }
    const { catalog, clientId, signal } = this.context;
    const current = this.claim();
    button.setDisabled(true);
    const purchase =
      this.action === "purchase"
        ? { clientId, requestId: crypto.randomUUID(), issuedAt: Date.now() }
        : undefined;
    const execution = await catalog.execute({ ...this.operation(), purchase }, signal);
    const message = resultMessage(execution);
    if (execution.kind === "saved" || execution.kind === "replayed") {
      new Notice(message);
      this.context.close();
      return;
    }
    // The outcome of a save that ran is always shown, even when the entry changed meanwhile.
    this.status.setText(message);
    button.setDisabled(execution.kind === "unknown");
    if (!current()) return;
    this.shown = undefined;
    if (execution.kind !== "needsInput") return;
    await this.showChoices(execution.outcome, current);
  }
}

export class Registration extends Modal {
  private readonly lookup = new AbortController();
  constructor(
    app: App,
    private readonly catalog: Catalog,
    private readonly clientId: string,
    private readonly initial: Product = {},
    private readonly intent: LocalAction = "purchase",
  ) {
    super(app);
  }

  onOpen(): void {
    this.setTitle("書籍の登録・編集");
    const context = {
      catalog: this.catalog,
      clientId: this.clientId,
      signal: this.lookup.signal,
      close: () => this.close(),
    };
    new RegistrationForm(this.contentEl, context, this.initial, this.intent).mount();
  }

  onClose(): void {
    this.lookup.abort();
  }
}
