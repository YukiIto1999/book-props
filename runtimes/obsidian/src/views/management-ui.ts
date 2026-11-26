import type { ManagementResult } from "../catalog/management.ts";

export const actionMessage: Record<ManagementResult, string> = {
  saved: "Vaultに保存しました。",
  conflict: "対象または書誌が変更されています。記録を確認してからやり直してください。",
  unavailable: "最新の記録を確認できません。開いている編集と書籍フォルダを確認してください。",
  pending: "確定を確認できません。移動は記録を失わず再開できる状態を保持しています。",
};

export function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function downloadText(
  parent: HTMLElement,
  name: string,
  type: string,
  contents: string,
): void {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const link = parent.createEl("a", { attr: { href: url, download: name } });
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
