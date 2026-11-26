import {
  Modal,
  Notice,
  Setting,
  type App,
  type ButtonComponent,
  type TextComponent,
} from "obsidian";
import type { BibliographySources } from "../adapters/bibliography-sources.ts";
import type { BookRecord } from "../adapters/note-format/book-record.ts";
import type { Catalog, Operation, Product, Selection, StoredBook } from "../catalog/catalog.ts";
import type { Outcome } from "../core/catalog-core.ts";
import { optionalField } from "../shared/optional-field.ts";
import { mountBibliography } from "./bibliography-form.ts";
import { isOptionKey } from "./option-keys.ts";
import {
  actionLabels,
  changedDraft,
  choiceDecisions,
  confirmSave,
  ownershipLabels,
  resultMessage,
  unreadableChoices,
  type LocalAction,
} from "./registration-messages.ts";
import {
  draftProduct,
  inputLabels,
  inputValues,
  productInputs,
  type ProductInput,
} from "./registration-draft.ts";

type Decision = Outcome["decision"];
/** 登録画面が使う、目録・書誌の取得先・この端末の要求元ID。 */
export type RegistrationServices = Readonly<{
  catalog: Catalog;
  sources: BibliographySources;
  clientId: string;
}>;
type RegistrationContext = RegistrationServices &
  Readonly<{
    signal: AbortSignal;
    close: () => void;
  }>;

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
    const { catalog, sources, signal } = this.context;
    mountBibliography(this.parent, {
      catalog,
      sources,
      signal,
      choose: (product) => this.applyProduct(product),
    });
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
    return { action: this.action, product, ...optionalField("selection", this.selection) };
  }

  /** Starts a check of the current draft; the returned test fails once the modal closes or a newer change or check begins. */
  private claim(): () => boolean {
    const draft = this.draft;
    const check = ++this.checks;
    return () => !this.context.signal.aborted && this.draft === draft && this.checks === check;
  }

  /** Offers the editions the catalog listed, and a new edition when the action may add one. */
  private chooseEdition(
    target: BookRecord,
    { editionIds, newEdition }: Extract<Decision, { kind: "chooseEdition" }>,
  ): void {
    new Setting(this.choices).setName("対象の版").addDropdown((field) => {
      field.selectEl.setAttribute("aria-label", "対象の版");
      field.addOption("", "選択してください");
      if (newEdition) field.addOption("new", "別の版を追加");
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

  /** Offers the books the catalog listed, and a new book when the action may create one. */
  private chooseBook(
    entries: readonly StoredBook[],
    { bookIds, newBook }: Extract<Decision, { kind: "chooseBook" | "insufficientEvidence" }>,
  ): void {
    new Setting(this.choices).setName("対象の本").addDropdown((field) => {
      field.selectEl.setAttribute("aria-label", "対象の本");
      field.addOption("", "選択してください");
      if (newBook) field.addOption("new", "別の本として登録");
      for (const { book } of entries.filter((entry) => bookIds.includes(entry.book.id))) {
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
    if (decision.kind === "chooseEdition" && target) this.chooseEdition(target, decision);
    else if (decision.kind === "chooseBook" || decision.kind === "insufficientEvidence")
      this.chooseBook(entries, decision);
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
    const execution = await catalog.save(this.operation(), clientId, signal);
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
    private readonly services: RegistrationServices,
    private readonly initial: Product = {},
    private readonly intent: LocalAction = "purchase",
  ) {
    super(app);
  }

  override onOpen(): void {
    this.setTitle("書籍の登録・編集");
    const context = {
      ...this.services,
      signal: this.lookup.signal,
      close: () => this.close(),
    };
    new RegistrationForm(this.contentEl, context, this.initial, this.intent).mount();
  }

  override onClose(): void {
    this.lookup.abort();
  }
}
