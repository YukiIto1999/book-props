import { Setting } from "obsidian";
import type { Bounds, ShelfFilter } from "../catalog/shelf-query.ts";
import type { FieldKey, ShelfTag } from "../core/catalog-core.ts";
import { isOptionKey } from "./option-keys.ts";
import { readingLabels, type ShelfFields } from "./shelf-fields.ts";

const ownershipLabels = { any: "すべて", owned: "所有あり", unowned: "所有なし" } as const;
const wishLabels = { any: "すべて", wanted: "欲しい本", unwanted: "購入希望なし" } as const;
const readingFilterLabels = { any: "すべて", unset: "未設定", ...readingLabels } as const;
const directionLabels = { asc: "昇順", desc: "降順" } as const;
const boundParts = [
  ["from", "最小"],
  ["through", "最大"],
] as const;

type FilterControls = Readonly<{
  filter: ShelfFilter;
  fields: ShelfFields;
  columns: Set<FieldKey>;
  update: (patch: Partial<ShelfFilter>) => void;
  redraw: () => void;
}>;

function mountChoice<Key extends string>(
  parent: HTMLElement,
  name: string,
  labels: Readonly<Record<Key, string>>,
  selected: Key,
  choose: (key: Key) => void,
): void {
  new Setting(parent).setName(name).addDropdown((field) => {
    field.selectEl.setAttribute("aria-label", name);
    field
      .addOptions(labels)
      .setValue(selected)
      .onChange((value) => {
        if (isOptionKey(labels, value)) choose(value);
      });
  });
}

function mountSearch(parent: HTMLElement, { filter, update }: FilterControls): void {
  new Setting(parent).setName("検索").addSearch((field) => {
    field.inputEl.setAttribute("aria-label", "本棚を検索");
    field
      .setPlaceholder("書名、著者、出版社、タグ、ISBN、購入日")
      .setValue(filter.text)
      .onChange((text) => update({ text }));
  });
}

function mountStateFilters(parent: HTMLElement, { filter, update }: FilterControls): void {
  mountChoice(parent, "所有", ownershipLabels, filter.ownership, (ownership) =>
    update({ ownership }),
  );
  mountChoice(parent, "購入希望", wishLabels, filter.wish, (wish) => update({ wish }));
  mountChoice(parent, "読書状態", readingFilterLabels, filter.reading, (reading) =>
    update({ reading }),
  );
}

function mountBounds(bounds: HTMLElement, key: FieldKey, { fields, update }: FilterControls): void {
  const label = fields.labels[key];
  let range: Bounds = { key, from: "", through: "" };
  const limits = new Setting(bounds).setName(`${label}の範囲`);
  for (const [part, partLabel] of boundParts) {
    limits.addText((input) => {
      input.inputEl.type = fields.rangeKinds.get(key) ?? "text";
      if (input.inputEl.type === "number") input.inputEl.step = "any";
      input.inputEl.setAttribute("aria-label", `${label}の${partLabel}`);
      input.onChange((value) => {
        range = { ...range, [part]: value };
        update({ range });
      });
    });
  }
  update({ range });
}

function mountRange(parent: HTMLElement, controls: FilterControls): void {
  const { fields, update } = controls;
  const rangeFields = parent.createDiv();
  const setting = new Setting(rangeFields).setName("値の範囲");
  const bounds = rangeFields.createDiv();
  setting.addDropdown((field) => {
    field.selectEl.setAttribute("aria-label", "範囲指定の項目");
    field.addOption("", "範囲指定なし");
    // 範囲を指定できる項目には必ず表示名があるが、なければ項目名をそのまま示す。
    for (const key of fields.rangeKinds.keys()) field.addOption(key, fields.labels[key] ?? key);
    field.onChange((key) => {
      bounds.empty();
      if (isOptionKey(fields.labels, key)) mountBounds(bounds, key, controls);
      else update({ range: undefined });
    });
  });
}

function mountSort(parent: HTMLElement, { filter, fields, update }: FilterControls): void {
  new Setting(parent)
    .setName("並べ替え")
    .addDropdown((field) => {
      field.selectEl.setAttribute("aria-label", "並べ替えの項目");
      field
        .addOptions(fields.labels)
        .setValue(filter.sort)
        .onChange((value) => {
          if (isOptionKey(fields.labels, value)) update({ sort: value });
        });
    })
    .addDropdown((field) => {
      field.selectEl.setAttribute("aria-label", "並べ替えの向き");
      field
        .addOptions(directionLabels)
        .setValue(filter.descending ? "desc" : "asc")
        .onChange((value) => update({ descending: value === "desc" }));
    });
}

function mountColumnToggles(
  parent: HTMLElement,
  { fields, columns, redraw }: FilterControls,
): void {
  const display = parent.createEl("details");
  display.createEl("summary", { text: "本棚に表示する項目" });
  for (const [key, label] of Object.entries(fields.labels)) {
    if (key === "title" || !isOptionKey(fields.labels, key)) continue;
    const toggle = display.createEl("label");
    const checkbox = toggle.createEl("input", { type: "checkbox" });
    checkbox.checked = columns.has(key);
    toggle.appendText(label);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) columns.add(key);
      else columns.delete(key);
      redraw();
    });
    display.appendText(" ");
  }
}

/** Mounts the search, state, range, sort, and column controls above the shelf. */
export function mountFilterControls(parent: HTMLElement, controls: FilterControls): void {
  mountSearch(parent, controls);
  mountStateFilters(parent, controls);
  mountRange(parent, controls);
  mountSort(parent, controls);
  mountColumnToggles(parent, controls);
}

/** Mounts one toggle button per shelf tag and returns them by the core's tag key. */
export function mountTagBar(
  parent: HTMLElement,
  tags: readonly ShelfTag[],
  toggleTag: (tag: string, key: string) => void,
): ReadonlyMap<string, HTMLButtonElement> {
  const buttons = new Map<string, HTMLButtonElement>();
  if (!tags.length) return buttons;
  const bar = parent.createDiv({
    attr: { role: "group", "aria-label": "タグで絞り込む（選んだタグがすべて付いた本）" },
  });
  bar.createSpan({ text: "タグ: " });
  for (const { name, key } of tags) {
    const button = bar.createEl("button", { text: `#${name}`, attr: { "aria-pressed": "false" } });
    button.addEventListener("click", () => toggleTag(name, key));
    buttons.set(key, button);
  }
  return buttons;
}

export function markSelectedTags(
  buttons: ReadonlyMap<string, HTMLButtonElement>,
  selectedTags: ReadonlySet<string>,
): void {
  for (const [key, button] of buttons) {
    button.setAttribute("aria-pressed", String(selectedTags.has(key)));
    button.toggleClass("mod-cta", selectedTags.has(key));
  }
}
