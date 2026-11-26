import type { Consent } from "./consent.ts";
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
/** The user's agreement to the disclosure, which the settings page shows and records. */
export type ConsentChoice = Pick<Consent, "given" | "agree" | "withdraw">;
export type OptionsView = {
  /** Shows the disclosure in place of the pairing controls, or the pairing controls once the user agreed. */
  disclose(shown: boolean): void;
  agreeing(busy: boolean): void;
  say(text: string): void;
  offerAllow(shown: boolean): void;
  pairing(busy: boolean): void;
  allowing(busy: boolean): void;
};

const pairingLabel = {
  paired: "ペアリング済みです。",
  unpaired: "ペアリングされていません。",
  unknown: "接続を確認できません。Obsidian を開いてください。",
  consentRequired: "データの扱いへの同意が取り消されています。",
  dormant:
    "接続用フォルダの許可が切れています。「今後も自動で接続する」を押して許可してください。毎回許可する選択肢が出たらそれを選ぶと、以後は自動で接続します。",
} as const;
const folderProblem = {
  notConnectionFolder: "Obsidian の Book Props 設定に表示される接続用フォルダを選んでください。",
  cancelled: "接続用フォルダの選択が取り消されました。",
  denied: "ブラウザが接続用フォルダへのアクセスを許可しませんでした。",
  failed: "接続用フォルダの読み込みに失敗しました。",
} as const;

/** Shows the disclosure until the user agrees, then decides what the settings page says about the pairing, and runs pairing, re-allowing and disconnecting. */
export class Options {
  private readonly requests: OptionsRequests;
  private readonly folder: ConnectionFolder;
  private readonly consent: ConsentChoice;
  private readonly view: OptionsView;
  // Pairing or disconnecting replaces the opening status check, whose answer would then be stale.
  private changed = false;
  // What the page shows: undefined before the first answer, then whether the user agreed.
  private agreed: boolean | undefined;

  constructor(
    requests: OptionsRequests,
    folder: ConnectionFolder,
    consent: ConsentChoice,
    view: OptionsView,
  ) {
    this.requests = requests;
    this.folder = folder;
    this.consent = consent;
    this.view = view;
  }

  /** Shows the disclosure or the pairing; runs again whenever consent may have changed, here or in another page. */
  open = async (): Promise<void> => {
    const given = await this.consent.given().catch(() => false);
    if (given === this.agreed) return;
    this.agreed = given;
    this.view.disclose(!given);
    if (given) await this.check();
    else this.changed = false;
  };

  agree = async (): Promise<void> => {
    this.view.agreeing(true);
    try {
      await this.consent.agree().catch(() => undefined);
      await this.open();
    } finally {
      this.view.agreeing(false);
    }
  };

  /** Removes the agreement; pages stop reading, and the pairing stays for when the user agrees again. */
  withdraw = async (): Promise<void> => {
    await this.consent.withdraw().catch(() => undefined);
    await this.open();
  };

  private async check(): Promise<void> {
    if (this.changed) return;
    this.view.say("接続を確認しています…");
    let current: ConnectionStatus;
    try {
      current = await this.requests.status();
    } catch {
      if (!this.changed) this.view.say(pairingLabel.unknown);
      return;
    }
    await this.describe(current);
  }

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
