import type { Response } from "@book-props/vault-contract";
import type { ConnectionFolder } from "./options.ts";
import type { BookChange, PageState, Reply } from "./outcomes.ts";
import { statusLabel } from "./status.ts";

export type PopupAction = BookChange | "open" | "reconcile" | "forget";
/** The popup's requests to the worker about the active tab. */
export type PopupRequests = {
  /** The active tab's state; undefined when the worker cannot answer. */
  inspect(): Promise<PageState | undefined>;
  /** Throws when the worker cannot be reached; an unreadable answer becomes `failure`. */
  request(action: PopupAction, failure: Response): Promise<Reply>;
};
type PopupControls = {
  canPurchase: boolean;
  canWish: boolean;
  wishLabel: string;
  openLabel: string;
  pending: boolean;
};
export type PopupView = {
  render(controls: PopupControls): void;
  say(text: string): void;
  /** Disables every action while one runs. */
  lock(): void;
};

/** Decides what the popup offers for the active tab, and runs one action at a time. */
export class Popup {
  private readonly requests: PopupRequests;
  private readonly folder: Pick<ConnectionFolder, "permission">;
  private readonly view: PopupView;
  private wanted = false;
  private busy = false;

  constructor(
    requests: PopupRequests,
    folder: Pick<ConnectionFolder, "permission">,
    view: PopupView,
  ) {
    this.requests = requests;
    this.folder = folder;
    this.view = view;
  }

  refresh = async (message?: string): Promise<void> => {
    const state = await this.requests.inspect();
    if (!state) {
      this.view.say("このページの状態を確認できません。");
      return;
    }
    const { reply } = state;
    this.wanted = reply.kind === "observed" && reply.wanted;
    const canSend = state.hasBook && reply.kind === "observed";
    this.view.render({
      canPurchase: canSend && !state.pending,
      canWish: canSend,
      wishLabel: this.wanted ? "購入希望を解除" : "欲しい本に追加",
      openLabel: reply.kind === "unreadable" ? "Obsidianで記録を確認" : "Obsidianで開く",
      pending: state.pending,
    });
    this.view.say(message ?? (await this.stateText(state)));
  };

  act = async (action: PopupAction): Promise<void> => {
    if (this.busy) return;
    this.busy = true;
    this.view.lock();
    // A purchase whose reply is lost may still have been saved, so it stays unknown rather than unavailable.
    const failure: Response = action === "purchase" ? { kind: "unknown" } : { kind: "unavailable" };
    try {
      const outcome = await this.requests.request(action, failure).catch((): Reply => failure);
      await this.refresh(statusLabel(outcome, true));
    } finally {
      this.busy = false;
    }
  };

  toggleWish = (): Promise<void> => this.act(this.wanted ? "clearWish" : "setWish");

  private async stateText(state: PageState): Promise<string> {
    if (state.pending) return statusLabel({ kind: "unknown" }, true);
    // A one-time folder grant ends with the browser, an extension reload, or the last extension page, and the extension cannot pair again until the user allows it.
    const blocked = state.reply.kind === "unavailable" || state.reply.kind === "unauthorized";
    if (blocked && (await this.folder.permission().catch(() => undefined)) === "prompt")
      return "接続用フォルダの許可が切れています。「接続設定・対応サイト」を開いて許可してください。";
    if (state.hasBook) return statusLabel(state.reply, true);
    return state.supported
      ? "書誌を確認できません。Obsidianで本を指定してください。"
      : "このページは対象外です。Obsidianで本を指定できます。";
  }
}
