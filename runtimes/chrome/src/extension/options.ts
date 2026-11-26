import type { ConnectionStatus, Reply } from "./outcomes.ts";
import { statusLabel } from "./status.ts";

export type FolderChoice =
  | { kind: "selected"; grantId: string }
  | { kind: "notConnectionFolder" | "cancelled" | "denied" | "failed" };
/** The connection folder the browser keeps for this extension. */
export type ConnectionFolder = {
  /** The saved folder's permission; undefined when none has been paired. */
  permission(): Promise<PermissionState | undefined>;
  /** Lets the user pick the folder the plugin shows, and remembers it until pairing commits it. */
  select(): Promise<FolderChoice>;
  /** Asks the user to keep allowing the paired folder. */
  restore(): Promise<PermissionState>;
};
/** The settings page's requests to the worker; each throws when the worker cannot be reached. */
export type OptionsRequests = {
  status(): Promise<ConnectionStatus>;
  pair(grantId: string): Promise<Reply>;
  disconnect(): Promise<Reply>;
};
export type OptionsView = {
  say(text: string): void;
  offerAllow(shown: boolean): void;
  pairing(busy: boolean): void;
  allowing(busy: boolean): void;
};

const pairingLabel = {
  paired: "ペアリング済みです。",
  unpaired: "ペアリングされていません。",
  unknown: "接続を確認できません。Obsidian を開いてください。",
  dormant:
    "接続用フォルダの許可が切れています。「今後も自動で接続する」を押して許可してください。毎回許可する選択肢が出たらそれを選ぶと、以後は自動で接続します。",
} as const;
const folderProblem = {
  notConnectionFolder: "Obsidian の Book Props 設定に表示される接続用フォルダを選んでください。",
  cancelled: "接続用フォルダの選択が取り消されました。",
  denied: "ブラウザが接続用フォルダへのアクセスを許可しませんでした。",
  failed: "接続用フォルダの読み込みに失敗しました。",
} as const;

/** Decides what the settings page says about the pairing, and runs pairing, re-allowing and disconnecting. */
export class Options {
  private readonly requests: OptionsRequests;
  private readonly folder: ConnectionFolder;
  private readonly view: OptionsView;
  // Pairing or disconnecting replaces the opening status check, whose answer would then be stale.
  private changed = false;

  constructor(requests: OptionsRequests, folder: ConnectionFolder, view: OptionsView) {
    this.requests = requests;
    this.folder = folder;
    this.view = view;
  }

  open = async (): Promise<void> => {
    this.view.say("接続を確認しています…");
    let current: ConnectionStatus;
    try {
      current = await this.requests.status();
    } catch {
      if (!this.changed) this.view.say(pairingLabel.unknown);
      return;
    }
    await this.describe(current);
  };

  /** The browser keeps the folder handle, but a one-time grant ends when the browser restarts, the extension reloads, or its last page closes. */
  private async describe(current: ConnectionStatus): Promise<void> {
    const permission =
      current.state === "unknown"
        ? await this.folder.permission().catch(() => undefined)
        : undefined;
    if (this.changed) return;
    const dormant = permission === "prompt";
    this.view.say(pairingLabel[dormant ? "dormant" : current.state]);
    this.view.offerAllow(dormant);
  }

  pair = async (): Promise<void> => {
    this.changed = true;
    this.view.pairing(true);
    this.view.say("ペアリングを確認しています。");
    try {
      const choice = await this.folder.select();
      if (choice.kind !== "selected") {
        this.view.say(folderProblem[choice.kind]);
        return;
      }
      this.view.say("Obsidian への接続を確認しています。");
      const reply = await this.requests.pair(choice.grantId);
      this.view.say(
        reply.kind === "saved"
          ? "ペアリングしました。商品ページを開くと所持を確認します。"
          : "ペアリングできません。Obsidian の起動と接続用フォルダを確認してください。",
      );
      if (reply.kind === "saved") this.view.offerAllow(false);
    } catch {
      this.view.say(folderProblem.failed);
    } finally {
      this.view.pairing(false);
    }
  };

  allow = async (): Promise<void> => {
    this.changed = true;
    this.view.allowing(true);
    try {
      const permission = await this.folder.restore();
      if (permission !== "granted") {
        this.view.say("許可されませんでした。接続するには、もう一度押して許可してください。");
        return;
      }
      this.view.offerAllow(false);
      this.view.say(pairingLabel[(await this.requests.status()).state]);
    } catch {
      this.view.say(pairingLabel.unknown);
    } finally {
      this.view.allowing(false);
    }
  };

  disconnect = async (): Promise<void> => {
    this.changed = true;
    const reply = await this.requests.disconnect();
    this.view.say(
      reply.kind === "saved"
        ? "このブラウザの接続を解除しました。Obsidian 側でも解除できます。"
        : statusLabel(reply, true),
    );
    if (reply.kind === "saved") this.view.offerAllow(false);
  };
}
