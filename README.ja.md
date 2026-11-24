[English](README.md) | [日本語](README.ja.md)

# Book Props

書店の商品ページで「持っている」「欲しい」を確認し、Obsidianで蔵書と読書記録を管理する。
本はVault内のMarkdown一冊一ページで管理する。初版と改訂版は別の版として扱い、紙と電子は内容が同じと確認できれば同じ版にまとめる。「欲しい」は本単位で、版の所持とは別に記録する。

## 導入

[GitHub の最新 Release](https://github.com/YukiIto1999/book-props/releases/latest) の Assets から `book-props-v<版>.zip` を取得する。
ZIP には Chrome 拡張と Obsidian プラグインが入っている。
[導入手順](docs/installation.md)に従って、展開し、両方を読み込んで接続する。証明書の登録、追加の実行ファイル、GitHub CLI は不要。
配布物の手元での検証は任意。
Chrome Web Store と Obsidian Community Plugins では配布しない。

Chrome との連携は、同じ Windows または Linux 端末のデスクトップ版 Obsidian と Chrome で動く。専用サーバー、データベース、同期サービスは不要。スマートフォンでは同期済み Markdown を読めるが、専用プラグインと Chrome 拡張は動かない。

## 開発

[CONTRIBUTING](CONTRIBUTING.md)に、開発環境、検証、保守の手順を記す。[文書の案内](docs/README.md)から要件とアーキテクチャを参照できる。

## ライセンス

Book Propsのコードと文書は[MITライセンス](LICENSE)で利用できる。
