import {
  Notice,
  PluginSettingTab,
  type App,
  type Plugin,
  type SettingDefinition,
  type SettingDefinitionItem,
  type TextComponent,
} from "obsidian";

type SettingsHost = Plugin & {
  readonly folder: string;
  readonly connectionDirectory: string | undefined;
  selectFolder(folder: string): Promise<boolean>;
  startConnection(): Promise<true | string>;
  revoke(): Promise<boolean>;
};

export class Settings extends PluginSettingTab {
  constructor(
    app: App,
    private readonly books: SettingsHost,
  ) {
    super(app, books);
  }

  override getSettingDefinitions(): SettingDefinitionItem[] {
    const directory = this.books.connectionDirectory;
    return [
      this.folder(),
      {
        type: "group",
        heading: "Chromeとの接続",
        items: [directory ? this.pairing(directory) : this.start()],
      },
    ];
  }

  // Each 適用 sends the value its input shows now; a redraw shows the applied value, so nothing unseen is sent later.
  private folder(): SettingDefinition {
    return {
      name: "書籍フォルダ",
      desc: "このVaultの既存フォルダを指定します。Vault全体は指定できません。",
      render: (setting) => {
        let folder!: TextComponent;
        setting
          .addText((field) => {
            folder = field.setValue(this.books.folder);
          })
          .addButton((button) =>
            button.setButtonText("適用").onClick(async () => {
              const accepted = await this.books.selectFolder(folder.getValue());
              new Notice(
                accepted
                  ? "書籍フォルダを設定しました。"
                  : "Vault内の既存フォルダを指定してください。",
              );
              if (accepted) this.update();
            }),
          );
      },
    };
  }

  private start(): SettingDefinition {
    return {
      name: "接続を始める",
      desc: "ホームの「Book Props」フォルダの下に接続用フォルダを作り、Chrome 拡張からの接続を受け付けます。",
      aliases: ["ペアリング"],
      render: (setting) => {
        setting.addButton((button) =>
          button
            .setButtonText("接続を始める")
            .setCta()
            .onClick(async () => {
              button.setDisabled(true);
              const started = await this.books.startConnection();
              new Notice(started === true ? "Chrome からの接続を受け付けています。" : started);
              this.update();
            }),
        );
      },
    };
  }

  private pairing(directory: string): SettingDefinition {
    return {
      name: "接続用フォルダ",
      desc: "Chrome 拡張の接続設定で、このフォルダを選びます。",
      aliases: ["ペアリング"],
      render: (setting) => {
        setting.descEl
          .createDiv()
          .createEl("code", { text: directory, cls: "book-props-connection-directory" });
        setting
          .addButton((button) =>
            button.setButtonText("パスをコピー").onClick(async () => {
              await navigator.clipboard.writeText(directory);
              new Notice("接続用フォルダのパスをコピーしました。");
            }),
          )
          .addButton((button) =>
            button.setButtonText("ペアリングを解除").onClick(async () => {
              button.setDisabled(true);
              const revoked = await this.books.revoke();
              new Notice(
                revoked ? "ペアリングを解除しました。" : "ペアリングを解除できませんでした。",
              );
              this.update();
            }),
          );
      },
    };
  }
}
