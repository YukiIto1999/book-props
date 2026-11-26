import { Modal, Setting, type App } from "obsidian";
import type { CustomField, EditionRecord } from "./book-note.ts";
import type { Catalog, StoredBook } from "./catalog.ts";
import { actionMessage, validDate } from "./management-ui.ts";
import { isOptionKey } from "./option-keys.ts";
import { optionalField } from "./optional-field.ts";
import { calendarDate } from "./shelf-fields.ts";

const editionFields = [
  ["label", "版"],
  ["publisher", "出版社"],
  ["publishedOn", "出版日"],
  ["cover", "表紙URL"],
  ["purchasedOn", "購入日"],
  ["purchasedFrom", "購入元"],
] as const;
type EditionField = (typeof editionFields)[number][0];

function isDateField(key: EditionField): boolean {
  return key === "publishedOn" || key === "purchasedOn";
}

/**
 * 編集した日付だけを保存形式に正規化するための検査
 * @param metadata - 保存する版の入力値
 * @param baseline - 編集を開始した時点の版
 * @returns 最初の日付のエラー
 */
function normalizeDates(
  metadata: Partial<Record<EditionField, string>>,
  baseline: EditionRecord | undefined,
): string | undefined {
  for (const [key, label] of editionFields) {
    const value = metadata[key];
    if (!isDateField(key) || value === undefined || value === baseline?.[key]) continue;
    const day = calendarDate(value);
    if (!day) return `${label}に実在する日付を入力してください: ${value}`;
    metadata[key] = day;
  }
  return undefined;
}

export class EditionEditor extends Modal {
  constructor(
    app: App,
    private readonly catalog: Catalog,
    private readonly target: StoredBook,
    private readonly baseline: EditionRecord | undefined,
    private readonly done: () => void,
  ) {
    super(app);
  }

  override onOpen(): void {
    this.setTitle(this.baseline ? "版を編集" : "版を追加");
    let isbn = this.baseline?.isbns.join("、") ?? "";
    let owned = this.baseline?.owned ?? false;
    const metadata: Partial<Record<EditionField, string>> = {};
    new Setting(this.contentEl).setName("ISBN").addText((field) => {
      field.inputEl.setAttribute("aria-label", "ISBN");
      field.setValue(isbn).onChange((value) => {
        isbn = value;
      });
    });
    this.mountMetadata(metadata);
    new Setting(this.contentEl).setName("所有").addToggle((field) =>
      field
        .setTooltip("この版の所有")
        .setValue(owned)
        .onChange((value) => {
          owned = value;
        }),
    );
    const status = this.contentEl.createEl("p", { attr: { role: "status" } });
    new Setting(this.contentEl).addButton((button) =>
      button
        .setButtonText("版を保存")
        .setCta()
        .onClick(async () => {
          const normalized = this.catalog.normalizeIsbns(
            isbn
              .split(/[、,]/)
              .map((part) => part.trim())
              .filter(Boolean),
          );
          if (normalized.kind === "invalid") {
            status.setText(`ISBNの確認数字を確認してください: ${normalized.input}`);
            return;
          }
          const invalidDate = normalizeDates(metadata, this.baseline);
          if (invalidDate) {
            status.setText(invalidDate);
            return;
          }
          if (metadata.cover) {
            try {
              if (new URL(metadata.cover).protocol !== "https:") throw new Error("non-HTTPS image");
            } catch {
              status.setText("表紙はHTTPSのURLを入力してください。");
              return;
            }
          }
          const value = {
            ...metadata,
            id: this.baseline?.id ?? crypto.randomUUID(),
            isbns: normalized.values,
            owned,
            ...optionalField("archivedAt", this.baseline?.archivedAt),
          };
          button.setDisabled(true);
          const bookId = this.target.book.id;
          const outcome = await this.catalog.manage(
            this.baseline
              ? { action: "editEdition", bookId, baseline: this.baseline, value }
              : { action: "addEdition", bookId, value },
          );
          status.setText(actionMessage[outcome]);
          button.setDisabled(outcome === "pending");
          if (outcome === "saved") {
            this.close();
            this.done();
          }
        }),
    );
  }

  private mountMetadata(metadata: Partial<Record<EditionField, string>>): void {
    for (const [key, label] of editionFields) {
      const stored = this.baseline?.[key];
      const day = isDateField(key) && stored ? calendarDate(stored) : undefined;
      if (stored !== undefined) metadata[key] = stored;
      new Setting(this.contentEl).setName(label).addText((field) => {
        field.inputEl.setAttribute("aria-label", label);
        if (isDateField(key) && (day || !stored)) field.inputEl.type = "date";
        if (key === "cover") field.inputEl.type = "url";
        field.setValue(day ?? stored ?? "").onChange((value) => {
          const entered = value.trim();
          if (entered) metadata[key] = entered;
          else delete metadata[key];
        });
      });
    }
  }
}

export const customKinds: Record<CustomField["kind"], string> = {
  text: "テキスト",
  number: "数値",
  date: "日付",
  boolean: "はい・いいえ",
  choice: "選択肢",
};

type FieldDraft = { kind: CustomField["kind"]; value: string; options: string[] };

export class FieldEditor extends Modal {
  constructor(
    app: App,
    private readonly catalog: Catalog,
    private readonly bookId: string,
    private readonly baseline: CustomField | undefined,
    private readonly done: () => void,
  ) {
    super(app);
  }

  override onOpen(): void {
    this.setTitle("独自項目");
    let name = this.baseline?.name ?? "";
    const draft: FieldDraft = {
      kind: this.baseline?.kind ?? "text",
      value: this.baseline ? String(this.baseline.value) : "",
      options: this.baseline?.kind === "choice" ? [...this.baseline.choices] : [],
    };
    new Setting(this.contentEl).setName("項目名").addText((field) => {
      field.inputEl.setAttribute("aria-label", "項目名");
      field.setValue(name).onChange((text) => {
        name = text.trim();
      });
    });
    const selector = new Setting(this.contentEl).setName("型");
    const draw = this.valueEditor(this.contentEl.createDiv(), draft);
    selector.addDropdown((field) => {
      field.selectEl.setAttribute("aria-label", "独自項目の型");
      field
        .addOptions(customKinds)
        .setValue(draft.kind)
        .onChange((type) => {
          if (!isOptionKey(customKinds, type)) return;
          draft.kind = type;
          draft.value = "";
          draw();
        });
    });
    draw();
    const status = this.contentEl.createEl("p", { attr: { role: "status" } });
    new Setting(this.contentEl).addButton((button) =>
      button
        .setButtonText("項目を保存")
        .setCta()
        .onClick(async () => {
          const { kind, value, options } = draft;
          let field: CustomField;
          if (!name) {
            status.setText("項目名を入力してください。");
            return;
          }
          if (kind === "number" && value !== "" && Number.isFinite(Number(value)))
            field = { name, kind, value: Number(value) };
          else if (kind === "boolean" && (value === "true" || value === "false"))
            field = { name, kind, value: value === "true" };
          else if ((kind === "date" && validDate(value)) || kind === "text")
            field = { name, kind, value };
          else if (kind === "choice" && options.includes(value))
            field = { name, kind, value, choices: options };
          else {
            status.setText("指定した型で読める値を選ぶか、入力してください。");
            return;
          }
          button.setDisabled(true);
          const outcome = await this.catalog.manage({
            action: "updateCustomField",
            bookId: this.bookId,
            ...optionalField("baseline", this.baseline),
            value: field,
          });
          status.setText(actionMessage[outcome]);
          button.setDisabled(outcome === "pending");
          if (outcome === "saved") {
            this.close();
            this.done();
          }
        }),
    );
  }

  private valueEditor(controls: HTMLElement, draft: FieldDraft): () => void {
    return () => {
      controls.empty();
      if (draft.kind === "choice") {
        new Setting(controls)
          .setName("選択肢")
          .setDesc("1行に1つ入力します。")
          .addTextArea((input) => {
            input.inputEl.setAttribute("aria-label", "選択肢");
            input.setValue(draft.options.join("\n")).onChange((text) => {
              draft.options = [
                ...new Set(
                  text
                    .split(/\r?\n/)
                    .map((option) => option.trim())
                    .filter(Boolean),
                ),
              ];
              if (!draft.options.includes(draft.value)) draft.value = "";
              values();
            });
          });
        const choiceBox = controls.createDiv();
        const values = () => {
          choiceBox.empty();
          new Setting(choiceBox).setName("値").addDropdown((field) => {
            field.selectEl.setAttribute("aria-label", "独自項目の値");
            field.addOption("", "選択してください");
            for (const option of draft.options) field.addOption(option, option);
            field.setValue(draft.value).onChange((choice) => {
              draft.value = choice;
            });
          });
        };
        values();
      } else if (draft.kind === "boolean") {
        new Setting(controls).setName("値").addDropdown((field) => {
          field.selectEl.setAttribute("aria-label", "独自項目の値");
          field
            .addOptions({ "": "選択してください", true: "はい", false: "いいえ" })
            .setValue(draft.value)
            .onChange((choice) => {
              draft.value = choice;
            });
        });
      } else {
        new Setting(controls).setName("値").addText((field) => {
          field.inputEl.setAttribute("aria-label", "独自項目の値");
          field.inputEl.type = draft.kind;
          if (draft.kind === "number") field.inputEl.step = "any";
          field.setValue(draft.value).onChange((text) => {
            draft.value = text;
          });
        });
      }
    };
  }
}
