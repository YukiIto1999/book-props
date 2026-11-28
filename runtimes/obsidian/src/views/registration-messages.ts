import type { Result } from "../catalog/catalog.ts";
import type { Action, Outcome } from "../core/catalog-core.ts";

/** 登録画面から選べる操作。照合だけの操作は、拡張から届くときにしか使わない。 */
export type LocalAction = Exclude<Action, "inspect">;

export const actionLabels: Record<LocalAction, string> = {
  purchase: "購入として登録",
  recordOwnership: "所持を記録",
  setWish: "欲しい本に追加",
  clearWish: "購入希望を解除",
  cancelOwnership: "所有を取り消す",
};
export const ownershipLabels = {
  sameEdition: "この版を所持",
  otherEdition: "別版を所持",
  unknownEdition: "所持記録あり・版未確認",
  unowned: "未所有",
  undetermined: "判定不能",
} as const;
/** 照合の結果のうち、所持の状態ではなく、確認を求める文を見せるもの。 */
export const choiceDecisions: readonly string[] = [
  "chooseBook",
  "chooseEdition",
  "insufficientEvidence",
  "conflictingEvidence",
  "invalidIsbn",
];
export const unreadableChoices = "書籍フォルダから候補を読み取れませんでした。";
export const changedDraft = "入力が変わりました。保存する前に照合結果を確認してください。";
export const confirmSave = " 結果を確認し、もう一度「保存」を押してください。";

const operationMessages = {
  saved: "Vaultに保存しました。",
  replayed: "保存済みです。",
  conflict: "競合を検出しました。対象の本・版を確認してください。",
  unavailable: "最新の記録を確認できません。書籍フォルダと開いている編集画面を確認してください。",
  unknown: "保存結果を確認できません。再登録する前に本ページを確認してください。",
  notSaved: "保存しませんでした。",
  observed: "変更対象がありません。",
};

/** 保存しても本が変わらなかった時の文。購入希望の追加と解除では、本がすでにその状態だと伝える。 */
function unchangedMessage(action: LocalAction, { bookId, wanted }: Outcome): string {
  if (bookId && action === "setWish" && wanted) return "この本はすでに欲しい本に入っています。";
  if (bookId && action === "clearWish" && !wanted) return "この本は欲しい本に入っていません。";
  return operationMessages.observed;
}

/** 照合や保存の結果を、選んだ操作に合わせた一文にする。 */
export function resultMessage(catalogResult: Result, action: LocalAction): string {
  if (catalogResult.kind === "unreadable")
    return `「${catalogResult.path}」を読み取れません。${catalogResult.reason} 記録を確認してください。`;
  if (catalogResult.kind === "observed") return unchangedMessage(action, catalogResult.outcome);
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
