import type { Response } from "@book-props/vault-contract";
import { decodePageState, decodeResponse, type PageState } from "./messages.ts";
import { statusLabel } from "./status.ts";

const status = document.querySelector<HTMLElement>("#status")!;
const purchase = document.querySelector<HTMLButtonElement>("#purchase")!;
const wish = document.querySelector<HTMLButtonElement>("#wish")!;
const open = document.querySelector<HTMLButtonElement>("#open")!;
const reconcile = document.querySelector<HTMLButtonElement>("#reconcile")!;
const forget = document.querySelector<HTMLButtonElement>("#forget")!;
const actions = [purchase, wish, open, reconcile, forget];
let wanted = false;
let busy = false;

async function loadPageState(): Promise<PageState | undefined> {
  try {
    return decodePageState(await chrome.runtime.sendMessage({ kind: "inspect" }));
  } catch {
    return undefined;
  }
}

function stateText(state: PageState): string {
  if (state.pending) return statusLabel({ kind: "unknown" }, true);
  if (state.hasBook) return statusLabel(state.reply, true);
  return state.supported
    ? "書誌を確認できません。Obsidianで本を指定してください。"
    : "このページは対象外です。Obsidianで本を指定できます。";
}

async function refresh(message?: string): Promise<void> {
  const state = await loadPageState();
  if (!state) {
    status.textContent = "このページの状態を確認できません。";
    return;
  }
  const { reply } = state;
  wanted = reply.kind === "observed" && reply.wanted;
  const canSend = state.hasBook && reply.kind === "observed";
  purchase.disabled = !canSend || state.pending;
  wish.disabled = !canSend;
  open.disabled = false;
  open.textContent = reply.kind === "unreadable" ? "Obsidianで記録を確認" : "Obsidianで開く";
  reconcile.hidden = !state.pending;
  forget.hidden = !state.pending;
  reconcile.disabled = forget.disabled = !state.pending;
  wish.textContent = wanted ? "購入希望を解除" : "欲しい本に追加";
  status.textContent = message ?? stateText(state);
}

async function act(kind: string): Promise<void> {
  if (busy) return;
  busy = true;
  for (const button of actions) button.disabled = true;
  // A purchase whose reply is lost may still have been saved, so it stays unknown rather than unavailable.
  const failure: Response = kind === "purchase" ? { kind: "unknown" } : { kind: "unavailable" };
  try {
    const outcome = decodeResponse(await chrome.runtime.sendMessage({ kind }), failure);
    await refresh(statusLabel(outcome, true));
  } catch {
    await refresh(statusLabel(failure, true));
  } finally {
    busy = false;
  }
}

purchase.addEventListener("click", () => {
  void act("purchase");
});
wish.addEventListener("click", () => {
  void act(wanted ? "clearWish" : "setWish");
});
open.addEventListener("click", () => {
  void act("open");
});
reconcile.addEventListener("click", () => {
  void act("reconcile");
});
forget.addEventListener("click", () => {
  if (window.confirm("Vaultの記録または購入状況を確認しましたか？結果の保留だけを解除します。"))
    void act("forget");
});
void refresh();
