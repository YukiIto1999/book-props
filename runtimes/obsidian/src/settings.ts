import {
  Notice,
  PluginSettingTab,
  Setting,
  type App,
  type Plugin,
  type TextComponent,
} from "obsidian";
import type { Credentials } from "./connection.ts";

type SettingsHost = Plugin & {
  readonly folder: string;
  readonly acceptingConnections: boolean;
  readonly extensionId: string;
  selectFolder(folder: string): Promise<boolean>;
  configureConnection(extension: string): Promise<boolean>;
  issueCode(): Credentials | undefined;
  revoke(): void;
};

export class Settings extends PluginSettingTab {
  private pairingSection?: HTMLElement;

  constructor(
    app: App,
    private readonly books: SettingsHost,
  ) {
    super(app, books);
  }

  display(): void {
    this.containerEl.empty();
    this.renderFolder();
    this.renderConnection();
  }

  // Each 適用 sends the value its input shows now; a redraw shows the applied value, so nothing unseen is sent later.
  private renderFolder(): void {
    let folder!: TextComponent;
    new Setting(this.containerEl)
      .setName("書籍フォルダ")
      .setDesc("このVaultの既存フォルダを指定します。Vault全体は指定できません。")
      .addText((field) => {
        folder = field.setValue(this.books.folder);
      })
      .addButton((button) =>
        button.setButtonText("適用").onClick(async () => {
          const accepted = await this.books.selectFolder(folder.getValue());
          new Notice(
            accepted ? "書籍フォルダを設定しました。" : "Vault内の既存フォルダを指定してください。",
          );
          if (accepted) this.display();
        }),
      );
  }

  private renderConnection(): void {
    this.containerEl.createEl("h3", { text: "Chromeとの接続" });
    let extension!: TextComponent;
    new Setting(this.containerEl)
      .setName("Chrome拡張ID")
      .setDesc("chrome://extensions の Book Props のIDを入力します。")
      .addText((field) => {
        extension = field.setValue(this.books.extensionId);
      })
      .addButton((button) =>
        button.setButtonText("接続設定を適用").onClick(async () => {
          button.setDisabled(true);
          const applied = await this.books.configureConnection(extension.getValue());
          new Notice(
            applied
              ? "接続設定を適用しました。"
              : "拡張 ID と書籍フォルダを確認してください。接続ポートが使用中の場合も開始できません。",
          );
          this.display();
        }),
      );
    this.pairingSection = this.containerEl.createDiv();
    this.refreshPairing();
  }

  hide(): void {
    this.pairingSection = undefined;
  }

  refreshPairing(): void {
    const section = this.pairingSection;
    if (!section) return;
    section.empty();
    if (this.books.acceptingConnections) this.renderPairing(section);
    else section.createEl("p", { text: "接続を受け付けていません。" });
  }

  private renderPairing(section: HTMLElement): void {
    const area = section.createDiv();
    const pairing = area.createEl("textarea", {
      attr: { "aria-label": "ペアリング情報", readonly: "", rows: "3", spellcheck: "false" },
    });
    area.hidden = true;
    const clear = () => {
      pairing.value = "";
      area.hidden = true;
    };
    area.createEl("button", { text: "ペアリング情報をコピー" }).addEventListener("click", () => {
      void navigator.clipboard.writeText(pairing.value).then(
        () => new Notice("ペアリング情報をコピーしました。"),
        () => {
          pairing.focus();
          pairing.select();
          new Notice("ペアリング情報を選択しました。そのままコピーしてください。");
        },
      );
    });
    new Setting(section)
      .setName("ペアリング")
      .addButton((button) =>
        button.setButtonText("ペアリング情報を発行").onClick(() => {
          const code = this.books.issueCode();
          if (!code) return;
          pairing.value = code.value;
          area.hidden = false;
          window.setTimeout(
            () => {
              if (pairing.value === code.value) clear();
            },
            Math.max(0, code.expiresAt - Date.now()),
          );
        }),
      )
      .addButton((button) =>
        button.setButtonText("ペアリングを解除").onClick(() => {
          this.books.revoke();
          clear();
        }),
      );
  }
}
