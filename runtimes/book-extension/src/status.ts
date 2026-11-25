import type { Reply } from "./messages.ts";

export function statusLabel(reply: Reply, manual: boolean): string {
  if (reply.kind === "observed") {
    const owns = {
      sameEdition: "この版を所持",
      otherEdition: "別版を所持",
      unknownEdition: "所持記録あり・版未確認",
      unowned: manual && !reply.wanted ? "未所有" : "",
      undetermined: "確認できません",
    }[reply.ownership];
    return [owns, reply.wanted ? "欲しいに登録済み" : ""].filter(Boolean).join("／");
  }
  if (reply.kind === "unreadable")
    return manual
      ? "読めない書籍記録があります。「Obsidianで記録を確認」から開いて修正してください。"
      : "読めない書籍記録があります。拡張からObsidianで確認してください。";
  if (!manual) return "確認できません";
  switch (reply.kind) {
    case "saved":
      return "Vaultに保存しました。";
    case "replayed":
      return "Vaultへの保存を確認しました。";
    case "opened":
      return "Obsidianで開きました。";
    case "unknown":
      return "保存結果は不明です。新たに登録せず、同じ購入の結果を再確認してください。";
    case "forgotten":
      return "保留を解除しました。購入がVaultに保存されたかは確認していません。もう一度登録する前に、Obsidianで記録を確認してください。";
    case "scopeMismatch":
      return "この保留は、いまペアリングしている先とは別のVaultまたは書籍フォルダで購入したものです。購入時の書籍フォルダでペアリングし直して再確認するか、そのVaultで記録を確認してから保留を解除してください。";
    case "manualCheck":
      return "この保留には購入時のVaultと書籍フォルダの記録がないため、自動では再確認できません。Obsidianで記録を確認してから保留を解除してください。";
    case "needsInput":
      return "本か版を特定できません。Obsidianで対象を確認してください。";
    case "unauthorized":
      return "Obsidian を開き、拡張の接続設定を確認してください。";
    case "conflict":
      return "競合を検出しました。対象をObsidianで確認してください。";
    case "notSaved":
      return "保存しませんでした。";
    case "unavailable":
      return "確認できません。Obsidianを開き、書籍フォルダや接続を確認してください。";
    default:
      return "操作を完了できませんでした。";
  }
}
