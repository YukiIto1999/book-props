# ストアへの掲載

Obsidian のコミュニティプラグインと Chrome Web Store に申請するときに入力する内容と、用意するファイルをまとめる。掲載するかどうかと時期は所有者が決める。申請はどちらも所有者のアカウントで行う。

## 共通の前提

- 版タグは `0.5.0` のように `v` を付けない。0.5.0 以降の Release から、両ストアに出すファイルが添付される（[CONTRIBUTING](../CONTRIBUTING.md#配布版の準備)）。
- ストアに出すファイルは、Release の添付ファイルをそのまま使う。手元でビルドし直したものは出さない。
- 申請前に `devenv shell -- pnpm verify` を通す。Obsidian の自動審査と同じ規則の検査がここに含まれる。

## Obsidian コミュニティプラグイン

[Submit your plugin](https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin) の手順で、[community.obsidian.md](https://community.obsidian.md) から申請する。

| 項目 | 内容 |
| --- | --- |
| リポジトリ | `YukiIto1999/book-props` |
| プラグイン ID | `book-props`（2026-11-26 時点の `community-plugins.json` に同じ ID はない） |
| 審査が読むファイル | 既定ブランチ直下の `manifest.json`、`README.md`、`LICENSE` |
| 利用者が取得するファイル | `manifest.json` の版と同じ名前のタグの Release に添付した `main.js` と `manifest.json` |
| 開示事項 | README の「Network use, files outside the vault, and privacy」 |

申請の後は自動審査の指摘が表示される。直すときは版を上げて新しい Release を出す。

## Chrome Web Store

開発者登録（Google アカウントと一回限りの登録料）を済ませ、[デベロッパー ダッシュボード](https://chrome.google.com/webstore/devconsole)で新しいアイテムを作る。

### パッケージ

Release の `book-props-chrome-<版>.zip` をアップロードする。直下に `manifest.json` がある。

アイテムを作るとストアが拡張 ID を割り当てる。Obsidian 側は拡張 ID を登録せずに接続するので、ID を控えたり設定に写したりする作業はない。

### ストアの掲載情報

| 項目 | 内容 |
| --- | --- |
| 名前 | Book Props（`manifest.json` から） |
| 概要 | `manifest.json` の説明文 |
| カテゴリ | 仕事効率化 |
| 言語 | 日本語 |
| ホームページの URL | `https://github.com/YukiIto1999/book-props` |
| サポートの URL | `https://github.com/YukiIto1999/book-props/issues` |

説明文：

```text
Obsidian で管理している蔵書と照らして、書店の商品ページで「この版を所持」「別版を所持」「欲しいに登録済み」などを表示します。

・対応サイト：Amazon.co.jp、楽天ブックス、バリューブックス、BOOKOFF オンライン
・ポップアップから、購入や購入希望を Obsidian の Vault に記録できます
・Obsidian で本のノートや登録画面を開けます

使うには、同じパソコンのデスクトップ版 Obsidian に Book Props プラグインを入れ、プラグインの設定で「接続を始める」を押してから、この拡張の接続設定で Obsidian が作った接続用フォルダを選びます。

本の情報は、同じパソコンの Obsidian にだけ送ります。開発者や第三者には送りません。利用状況の送信や広告はありません。
```

### 画像

| 種類 | 寸法 | 用意の仕方 |
| --- | --- | --- |
| ストアアイコン | 128×128 | Release の ZIP の `chrome/icon-128.png` |
| スクリーンショット | 1280×800、1〜5 枚 | 合成データの Vault と別の Chrome プロファイルで、対応サイトの商品ページにポップアップと表示を出して撮る |
| プロモーション タイル（小） | 440×280 | アイコンの図案を濃い青緑の背景に置き、文字は入れない |

スクリーンショットとタイルは書店のページを含むため、リポジトリには置かない。

### プライバシーへの取り組み

| 項目 | 入力 |
| --- | --- |
| 単一用途の説明 | 対応する書店の商品ページで、利用者の Obsidian Vault にある蔵書の記録と照らして、その本の所持と購入希望を表示し、利用者が選んだときに記録する。 |
| `storage` の理由 | 結果をまだ確認できていない購入の記録、Obsidian との期限付きセッション、この拡張の識別子を、拡張専用の保存領域に置くため。 |
| `contextMenus` の理由 | 商品ページの右クリックメニューから、所持と購入希望を確かめ直すため。 |
| ホストへのアクセスの理由 | 対応する四つの書店の商品ページから、書名、著者、ISBN などの書誌を読み取るため。ほかのサイトでは動かない。 |
| リモートコード | 使用していない。WebAssembly はパッケージに同梱している。 |
| 収集するデータ | 「ウェブサイトのコンテンツ」（商品ページの書誌）。同じパソコンの Obsidian にだけ送り、開発者には送らない。 |
| 開示への同意 | 第三者への販売、目的外の利用、信用評価への利用をしないことに同意する。 |
| プライバシーポリシー | `https://github.com/YukiIto1999/book-props/blob/main/PRIVACY.md` |

### 審査担当者への説明

拡張は Obsidian プラグインと組み合わせて動くため、テストの手順欄に次を書く。

```text
This extension works with the Book Props plugin for desktop Obsidian on the same computer.
1. Install Obsidian 1.13 or later. Download book-props-<version>.zip from https://github.com/YukiIto1999/book-props/releases/latest and put obsidian/main.js and obsidian/manifest.json into <vault>/.obsidian/plugins/book-props/. Enable the plugin under Settings > Community plugins.
2. Create a folder such as "Books" in the vault. In Settings > Book Props, enter "Books" in 書籍フォルダ and press 適用, then press 接続を始める.
3. In this extension, open 接続設定・対応サイト from the popup, press 接続用フォルダを選ぶ, choose the folder shown in Obsidian (<home>/Book Props/<vault name>), and allow editing.
4. Open https://books.rakuten.co.jp/rb/11753651/. The popup shows 未所有. Press 欲しい本に追加; after reloading, the page shows 欲しいに登録済み.
If the extension later says that the folder permission has expired (接続用フォルダの許可が切れています), press 今後も自動で接続する in its settings and allow access.
The interface is in Japanese.
```
