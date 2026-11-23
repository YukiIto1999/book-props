import {
  Notice,
  PluginSettingTab,
  Setting,
  type App,
  type Plugin,
  type TextComponent,
} from "obsidian";
import type { Credentials } from "./connection.ts";
import { downloadText } from "./management-ui.ts";

type Address = { url: string; fingerprint: string; certificate: string };

type SettingsHost = Plugin & {
  readonly folder: string;
  readonly address: Address | undefined;
  readonly extensionId: string;
  readonly hasIdentity: boolean;
  selectFolder(folder: string): Promise<boolean>;
  configureConnection(extension: string, renew: boolean): Promise<boolean>;
  issueCode(): Credentials | undefined;
  revoke(): void;
};

export class Settings extends PluginSettingTab {
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
    const current = this.books.address;
    this.containerEl.createEl("p", {
      text: current
        ? `${current.url} · SHA-256 ${current.fingerprint}`
        : "待ち受けていません。書籍フォルダとOSの保護された鍵保管が必要です。",
    });
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
          const applied = await this.books.configureConnection(extension.getValue(), false);
          new Notice(
            applied
              ? "接続設定を適用しました。"
              : "拡張ID、書籍フォルダ、OSの鍵保管を確認してください。",
          );
          this.display();
        }),
      );
    if (this.books.hasIdentity)
      new Setting(this.containerEl).setName("証明書の更新").addButton((button) =>
        button.setButtonText("証明書を更新").onClick(async () => {
          button.setDisabled(true);
          const renewed = await this.books.configureConnection(this.books.extensionId, true);
          new Notice(
            renewed
              ? "証明書を更新しました。Chromeで旧証明書を削除し、新しい証明書を登録してください。"
              : "証明書を更新できませんでした。",
          );
          this.display();
        }),
      );
    if (current) this.renderPairing(current);
  }

  private renderPairing(current: Address): void {
    new Setting(this.containerEl)
      .setName("末端証明書")
      .setDesc("指紋を確認して、Chromeでこの証明書だけを信頼登録してください。")
      .addButton((button) =>
        button
          .setButtonText("証明書を保存")
          .onClick(() =>
            downloadText(
              this.containerEl,
              "book-props-localhost.crt",
              "application/x-pem-file",
              current.certificate,
            ),
          ),
      );
    const pairing = this.containerEl.createEl("p", { attr: { role: "status" } });
    new Setting(this.containerEl)
      .setName("ペアリング")
      .addButton((button) =>
        button.setButtonText("コードを発行").onClick(() => {
          const code = this.books.issueCode();
          if (!code) return;
          pairing.setText(code.value);
          window.setTimeout(
            () => {
              if (pairing.textContent === code.value) pairing.empty();
            },
            Math.max(0, code.expiresAt - Date.now()),
          );
        }),
      )
      .addButton((button) =>
        button.setButtonText("ペアリングを解除").onClick(() => {
          this.books.revoke();
          pairing.empty();
        }),
      );
  }
}
