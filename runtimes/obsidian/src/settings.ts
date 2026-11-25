import {
  Notice,
  PluginSettingTab,
  Setting,
  type App,
  type Plugin,
  type TextComponent,
} from "obsidian";

type SettingsHost = Plugin & {
  readonly folder: string;
  readonly connectionDirectory: string | undefined;
  readonly extensionId: string;
  selectFolder(folder: string): Promise<boolean>;
  configureConnection(extension: string): Promise<boolean>;
  revoke(): Promise<boolean>;
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
    const directory = this.books.connectionDirectory;
    if (directory) this.renderPairing(section, directory);
    else section.createEl("p", { text: "接続を受け付けていません。" });
  }

  private renderPairing(section: HTMLElement, directory: string): void {
    section.createEl("p", { text: "Chrome で選ぶ接続用フォルダ:" });
    section
      .createEl("p")
      .createEl("code", { text: directory, cls: "book-props-connection-directory" });
    new Setting(section)
      .setName("ペアリング")
      .addButton((button) =>
        button.setButtonText("フォルダのパスをコピー").onClick(async () => {
          await navigator.clipboard.writeText(directory);
          new Notice("接続用フォルダのパスをコピーしました。");
        }),
      )
      .addButton((button) =>
        button.setButtonText("ペアリングを解除").onClick(async () => {
          button.setDisabled(true);
          const revoked = await this.books.revoke();
          new Notice(revoked ? "ペアリングを解除しました。" : "ペアリングを解除できませんでした。");
          this.refreshPairing();
        }),
      );
  }
}
