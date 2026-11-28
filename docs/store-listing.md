# ストアへの掲載

Obsidian のコミュニティディレクトリと Chrome Web Store に申請するときに入力する内容と、用意するファイルをまとめる。掲載するかどうかと時期は所有者が決め、申請はどちらも所有者のアカウントで行う。各ストアの要件は 2026-11-28 に公式の文書で確かめた。

## 共通の前提

- 版タグは `0.13.0` のように `v` を付けない。両ストアに出すファイルは Release に添付してある（[CONTRIBUTING](../CONTRIBUTING.md#配布版の準備)）。
- ストアに出すファイルは、Release の添付ファイルをそのまま使う。手元でビルドし直したものは出さない。
- 申請前に `devenv shell -- pnpm verify` を通す。Obsidian の自動審査と同じ規則（`eslint-plugin-obsidianmd` の審査用の設定）の検査がここに含まれる。

### 通信とデータの流れ

両ストアの審査は、README、[プライバシーポリシー](../PRIVACY.md)、拡張の同意画面、ストアの入力欄が同じことを言っているかを見る。Book Props がデータを送る先は次の表がすべてであり、どれかを変えたら、表の右の列にある開示をすべて直す。

| 送り先 | 送るとき | 送るもの | 開示している所 |
| --- | --- | --- | --- |
| 国立国会図書館サーチ（`https://ndlsearch.ndl.go.jp/api/opensearch`） | ISBN か書名で探したとき。拡張から ISBN のある本を登録した後。照会を終えられなかった本について、Obsidian の起動時と開いている間の1時間ごと。「本の表記をそろえる」で照会を選んだとき | 入力した語、ISBN | README、PRIVACY、登録画面と「本の表記をそろえる」の出典表示 |
| 対応サイトの商品ページ | Obsidian で商品 URL から書誌を取り込むとき | そのページへの要求（クエリ文字列を除く） | README、PRIVACY |
| 表紙画像のアドレス（多くは書店の画像サーバー） | `本の一覧.base` の「表紙」の表示を開いたとき。読み込むのはプラグインではなく Obsidian | 画像の要求 | README、PRIVACY |
| 同じ端末の Obsidian（`127.0.0.1`、TLS 1.3） | 同意した後、拡張が対応サイトの商品ページを開いたときと、ポップアップで操作したとき | 書誌（書名、著者、ISBN、版の表記、出版社、発行日、表紙画像のアドレス）。購入ではこの拡張の識別子と要求の識別子 | 拡張の同意画面、PRIVACY、Chrome Web Store の説明文とプライバシーの入力欄 |

開発者や第三者に送るデータはない。拡張自体は外部のサービスに要求を送らない。

## Obsidian コミュニティディレクトリ

### 申請の手順

[Submit your plugin](https://docs.obsidian.md/plugins/releasing/submit-plugin) と [Set up and claim](https://docs.obsidian.md/community-directory/set-up-and-claim) の手順で申請する。

1. [community.obsidian.md](https://community.obsidian.md) に Obsidian のアカウントでサインインし、プロフィールの **GitHub** で **Connect** を押してリポジトリの所有を確かめさせる。
2. **Plugins** の **New plugin** で、**GitHub repository URL** に `https://github.com/YukiIto1999/book-props`、**Owner** に自分を選ぶ。
3. [Developer policies](https://docs.obsidian.md/community-directory/developer-policies) への同意と、保守を続けること（続けられなくなったら削除か譲渡すること）の確認をして **Submit** を押す。
4. 自動審査の結果がエントリの画面に出る。**Manifest**、**Releases**、**Source code**、**Build verification** の区分ごとに、誤り・警告・推奨・合格が付く。誤りが残る間は Obsidian から導入できない。直したら版を上げて新しい Release を出す。Release を出す前に試すときは、エントリの画面の **Review branch** で既定ブランチを走査する（[Manage your plugin or theme](https://docs.obsidian.md/community-directory/manage-entry)）。

| 項目 | 内容 |
| --- | --- |
| リポジトリ | `YukiIto1999/book-props` |
| プラグイン ID | `book-props`（2026-11-26 時点の `community-plugins.json` に同じ ID はない） |
| 審査が読むファイル | 既定ブランチ直下の `manifest.json`、`README.md`、`LICENSE` |
| 利用者が取得するファイル | `manifest.json` の版と同じ名前のタグの Release に添付した `main.js` と `manifest.json`。`styles.css` はない |
| 開示事項 | README の「Network use, files outside the vault, and privacy」 |

### 要件との照合

| 要件 | 出典 | 状態 |
| --- | --- | --- |
| ID は英小文字とハイフンだけで、`obsidian` を含まず、`plugin` で終わらない | [Manifest](https://docs.obsidian.md/Reference/Manifest) | 満たす（`book-props`） |
| 名前は基本ラテン文字だけで、「Obsidian」「Plugin」を含まない | [Manifest](https://docs.obsidian.md/Reference/Manifest) | 満たす（`Book Props`） |
| 説明は 250 字以内、動作から書き始め、句点で終える。絵文字や特殊文字を使わない | [Submission requirements](https://docs.obsidian.md/community-directory/submission-requirements-for-plugins) | 満たす（135 字） |
| `minAppVersion` を動作する最小の版にする | 同上 | `1.13.0`。動作を確かめた最も古い版は 1.13.7 で（[アーキテクチャ](architecture.md)）、1.13.0 から 1.13.6 では確かめていない。受け入れ試験は 1.15.1 で動かす。1.13.7 に上げるかは所有者が決める |
| Node.js を使うなら `isDesktopOnly` を `true` にする | 同上 | 満たす（`node:https`、`node:http`、`node:tls`、`node:fs/promises` などを使う） |
| 寄付を受けないなら `fundingUrl` を置かない | 同上 | 満たす（置いていない） |
| コマンド ID にプラグイン ID を含めない。見本のコードを残さない | 同上 | 満たす。`verify` の `obsidian-review` で検査する |
| 利用状況の送信をしない | [Developer policies](https://docs.obsidian.md/community-directory/developer-policies) | 満たす |
| 通信、Vault 外のファイル、アカウント、課金を README に明記する | 同上 | 満たす（README の開示の節。表紙の画像の読み込みと、照会のやり直しの時機も記した） |
| LICENSE を置き、使ったデータとコードのライセンスに従い、必要なら README に表示する | 同上 | 満たす（MIT。国立国会図書館蔵書と NDC データの CC BY 表示は README の License の節） |
| 自動審査の規則に違反しない | [eslint-plugin-obsidianmd の審査用の設定](https://github.com/obsidianmd/eslint-plugin/blob/master/docs/configuration.md#community-plugin-scanner-configuration) | `verify` の `obsidian-review` が同じ規則で通る。警告は `--quiet` で表示していない |
| 審査がソースからビルドし、Release の `main.js` と一致するか確かめる（Build verification） | [Manage your plugin or theme](https://docs.obsidian.md/community-directory/manage-entry)、[FAQ](https://docs.obsidian.md/community-directory/faq) | 未確認。審査はルートの `package.json` の `build` を使う。ここでは `nx run book-props:build` であり、Rust の `wasm32-unknown-unknown`、`wasm-bindgen`、`esbuild`、`resvg` など devenv の道具を前提にする。審査の環境でこれを実行でき、Wasm を含む `main.js` が一致するかは、申請後に **Review branch** で確かめるまで分からない |

### 掲載情報

申請の後、エントリの画面の **Edit listing** で、アイコン、短い説明と長い説明、カテゴリ、支払いの種類、スクリーンショットを入力する。掲載ページには、このほかに README の抜粋が出る。

| 項目 | 内容 |
| --- | --- |
| アイコン | 画像の寸法の指定は公開されていない。拡張と同じ図案（`runtimes/chrome/icons/icon.svg`）から書き出す |
| 短い説明 | `manifest.json` の `description` |
| 長い説明 | 下の英文 |
| カテゴリ | 入力欄の選択肢から所有者が選ぶ（選択肢は公開文書にない） |
| 支払いの種類 | Free。課金も有料の外部サービスもない（[FAQ](https://docs.obsidian.md/community-directory/faq)） |
| スクリーンショット | デスクトップ用は 1200×800 で 5 枚まで。JPEG、PNG、WebP で 1 枚 5 MB まで。デスクトップ専用なのでモバイル用（900×1600）は出さない |

長い説明：

```text
Book Props keeps one Markdown note per book in your vault, with its editions, the copies you own, whether you want it, and your reading status. Look up bibliographic data by ISBN or title in the National Diet Library Search of Japan, or from a supported bookstore product page. Browse and filter your shelf, align titles, authors, and publishers with the National Diet Library records, and create an Obsidian Bases file that lists your books by cover, author, publisher, wish, and reading status.

The companion extension for Chrome and other Chromium-based browsers shows on Amazon.co.jp, Rakuten Books, VALUE BOOKS, and BOOKOFF Online product pages whether you already own the book or want it, and records purchases and wishes in your vault.

Desktop only (Windows and Linux). The interface is in Japanese.
```

掲載ページの評価欄には、自動審査が見つけた外部のドメインへの要求やクリップボードへの書き込みが、開示として出る見込みである（[Community directory](https://help.obsidian.md/community-directory)）。外部への要求は README に記した用途だけで、クリップボードには、設定の「パスをコピー」を押したときに接続用フォルダのパスを書くだけである。

## Chrome Web Store

### 開発者アカウント

[デベロッパー ダッシュボード](https://chrome.google.com/webstore/devconsole)で登録する（[Register](https://developer.chrome.com/docs/webstore/register)、[Set up your developer account](https://developer.chrome.com/docs/webstore/set-up-account)）。

- 登録料は一回限り。登録に使うメールアドレスは後から変えられない。
- アカウントの画面で、公開する名前（掲載ページの「提供元」）を入れ、連絡先のメールアドレスを確認する。どちらも必須である。
- 拡張に購入の機能はないため、住所の登録は求められない。
- EU のデジタルサービス法により、トレーダーか非トレーダーかを申告する（[Trader/Non-Trader](https://developer.chrome.com/docs/webstore/program-policies/trader-disclosure)）。

### パッケージ

Release の `book-props-chrome-<版>.zip` をアップロードする。直下に `manifest.json` がある。

アイテムを作るとストアが拡張 ID を割り当てる。Obsidian 側は拡張 ID を登録せずに接続するので、ID を控えたり設定に写したりする作業はない。

ストア版は、手動で読み込んだ拡張とは ID が異なる別の拡張になる。保留記録や選んだフォルダは引き継がれないため、手動版から切り替える利用者には、[導入と運用](installation.md#日常の運用と復旧)の「Chrome Web Store 版への切り替え」の手順を案内する。

### ストアの掲載情報

| 項目 | 内容 |
| --- | --- |
| 名前 | Book Props（`manifest.json` から） |
| 概要 | `manifest.json` の説明文 |
| カテゴリ | 仕事効率化の系統から、ダッシュボードの選択肢を見て所有者が選ぶ |
| 言語 | 日本語 |
| ホームページの URL | `https://github.com/YukiIto1999/book-props` |
| サポートの URL | `https://github.com/YukiIto1999/book-props/issues` |

説明文：

```text
Obsidian で管理している蔵書と照らして、書店の商品ページで「この版を所持」「別版を所持」「欲しいに登録済み」などを表示します。

・対応サイト：Amazon.co.jp、楽天ブックス、バリューブックス、BOOKOFF オンライン
・ポップアップから、購入や購入希望を Obsidian の Vault に記録できます
・Obsidian で本のノートや登録画面を開けます
・商品ページの右クリックメニューから、所持と購入希望を確かめ直せます

使うには、同じパソコンのデスクトップ版 Obsidian に Book Props プラグインを入れ、プラグインの設定で「接続を始める」を押してから、この拡張の接続設定で Obsidian が作った接続用フォルダを選びます。

【データの扱い】
・読み取るページ：上の四つのサイトの商品ページだけです。ほかのページ、閲覧履歴、フォームの入力、サイトのアカウント情報は読み取りません。
・読み取る内容：ページのアドレスと、本の書名、著者、ISBN、版の表記、出版社、発行日、表紙画像のアドレスです。ページのアドレスは、対応する商品ページかを見分けるために拡張の中だけで使います。
・送り先：書誌は、同じパソコンで動く Obsidian の Book Props プラグインにだけ、パソコンの中で完結する接続で送ります。購入を記録するときは、二重に記録しないための識別子も一緒に送ります。開発者や第三者には送りません。利用状況の送信や広告はありません。
・使い道：その本を持っているか、欲しい本に登録してあるかを表示するためと、ポップアップで選んだときに購入や購入希望を Vault に記録するためです。
・同意：拡張を入れると設定画面が開き、この内容を示します。「同意して使い始める」を押すまで、拡張は商品ページを読み取らず、Obsidian にも接続しません。同意は設定画面の「同意を取り消す」でいつでも取り消せます。

Book Props は、Obsidian や各書店が提供・承認したものではありません。
```

最後の一文は、他社が提供・承認したように見せないための記載である（[Impersonation](https://developer.chrome.com/docs/webstore/program-policies/impersonation-and-intellectual-property)）。

### プライバシーへの取り組み

[Privacy practices](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy) の欄に入力する。入力欄、プライバシーポリシー、拡張の動作が食い違うと掲載を取り下げられる（[Listing requirements](https://developer.chrome.com/docs/webstore/program-policies/listing-requirements)）。

| 項目 | 入力 |
| --- | --- |
| 単一用途の説明 | 対応する書店の商品ページで、利用者の Obsidian Vault にある蔵書の記録と照らして、その本の所持と購入希望を表示し、利用者が選んだときに記録する。 |
| `storage` の理由 | データの扱いへの利用者の同意の記録（同意した説明の版と日時）、選んだ接続用フォルダの情報、結果をまだ確認できていない購入の記録、Obsidian との期限付きセッション、この拡張の識別子を、拡張専用の保存領域に置くため。 |
| `contextMenus` の理由 | 商品ページの右クリックメニューから、所持と購入希望を確かめ直すため。 |
| ホストへのアクセスの理由 | 利用者が拡張の設定画面で同意した後に、対応する四つの書店の商品ページから、ページのアドレスと、書名、著者、ISBN などの書誌を読み取るため。Amazon.co.jp とバリューブックスは商品ページのアドレスの形が一つに決まらず、Amazon はページを読み込み直さずに別の商品へ移るため、サイト全体で読み込み、アドレスが商品ページの形のときだけ読み取る。ほかのサイトでは動かない。 |
| リモートコード | 使用していない。WebAssembly はパッケージに同梱している。 |
| 収集するデータ | 「ウェブサイトのコンテンツ」（商品ページの書誌）と「ウェブ履歴」（ページのアドレス）。書誌は同じパソコンの Obsidian にだけ送り、開発者には送らない。ページのアドレスは対応ページかの判定に拡張の中で使うだけで、拡張の外へは送らない。端末の中だけで扱うデータも開示の対象になり、URL も利用者データに含まれるため（[User Data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq) の 3 と 4）、両方を申告する。 |
| 開示への同意 | 第三者への販売、目的外の利用、信用評価への利用をしないことに同意する。 |
| プライバシーポリシー | `https://github.com/YukiIto1999/book-props/blob/main/PRIVACY.md`。Limited Use の要件に従うことの表明を含む（[Limited Use](https://developer.chrome.com/docs/webstore/program-policies/limited-use) の 6） |

購入の記録は、利用者がポップアップで押して作る記録で、本と購入日を持ち、金額や支払手段は持たない。「財務情報と支払い情報」に当たるとみなすかは、ダッシュボードの説明を見て所有者が決める。

### 配布

[Distribution](https://developer.chrome.com/docs/webstore/cws-dashboard-distribution) で、無料であることと公開範囲を選ぶ。対応サイトは日本の書店だけで、画面も日本語だけである。地域を日本に絞るかは所有者が決める。

### 審査担当者への説明

テストの手順の欄は、制限のある資格情報や有料のアカウントが要る場合のためのもので、必須ではない（[Test instructions](https://developer.chrome.com/docs/webstore/cws-dashboard-test-instructions)）。この拡張は Obsidian プラグインがないと動かないため、次を書く。

```text
This extension works with the Book Props plugin for desktop Obsidian on the same computer.
1. Install Obsidian 1.13 or later. Download book-props-<version>.zip from https://github.com/YukiIto1999/book-props/releases/latest and put obsidian/main.js and obsidian/manifest.json into <vault>/.obsidian/plugins/book-props/. Enable the plugin under Settings > Community plugins.
2. Create a folder such as "Books" in the vault. In Settings > Book Props, enter "Books" in 書籍フォルダ and press 適用, then press 接続を始める.
3. When the extension is installed, its settings page (接続設定) opens with a disclosure of the data it reads, where it sends it, and why. Press 同意して使い始める. Until then the extension reads no pages, does not connect to Obsidian, and its popup only points to this disclosure. The same page offers 同意を取り消す to withdraw consent.
4. On the same settings page (also reachable from 接続設定・対応サイト in the popup), press 接続用フォルダを選ぶ, choose the folder shown in Obsidian (<home>/Book Props/<vault name>), and allow editing.
5. Open https://books.rakuten.co.jp/rb/11753651/. The popup shows 未所有. Press 欲しい本に追加; after reloading, the page shows 欲しいに登録済み.
If the extension later says that the folder permission has expired (接続用フォルダの許可が切れています), press 今後も自動で接続する in its settings and allow access.
The interface is in Japanese.
```

## 画像

リポジトリにある画像は、拡張のアイコンの図案（`runtimes/chrome/icons/icon.svg` と `icon-16.svg`）だけである。PNG はビルドで書き出し、Release の ZIP の `chrome/icon-128.png` に入る。スクリーンショットとプロモーション タイルはない。書店のページや表紙を写すため、スクリーンショットはリポジトリに置かない。

| ストア | 種類 | 寸法 | 必須 | 現状 |
| --- | --- | --- | --- | --- |
| Chrome Web Store | ストアアイコン | 128×128 の PNG。図案は 96×96 で周りに 16 px の透明な余白 | 必須 | ある（`icon-128.png`。図案は縦 96 px、横 83 px で、余白は上下 16 px） |
| Chrome Web Store | スクリーンショット | 1280×800（または 640×400）、角は四角、余白なし | 1 枚以上、5 枚まで | ない |
| Chrome Web Store | プロモーション タイル（小） | 440×280 の PNG か JPEG | 任意。ないと、ある拡張の後に並ぶ | ない |
| Chrome Web Store | マーキー プロモーション タイル | 1400×560 | 任意。特集に載るのに要る | ない |
| Obsidian | アイコン | 指定は公開されていない | 任意 | `icon.svg` から書き出せる |
| Obsidian | スクリーンショット | 1200×800、5 MB まで | 任意、5 枚まで | ない |

寸法と要否は [Supplying images](https://developer.chrome.com/docs/webstore/images)、[Store listing](https://developer.chrome.com/docs/webstore/cws-dashboard-listing)、[Manage your plugin or theme](https://docs.obsidian.md/community-directory/manage-entry) による。プロモーション タイルは文字を入れず、アイコンの図案を彩度の高い背景に置く。

### スクリーンショットの撮り方

所有者の Vault は写さない。合成した本だけを入れた使い捨ての Vault と新しいブラウザのプロファイルで撮る。

- 土台には、Release の受け入れ試験（`tests/e2e/large/desktop-release/`）の仕組みを使う。一時 Vault、Chrome for Testing の新しいプロファイル、`xvfb-run` の仮想画面で動き、利用者の画面を使わない。窓の寸法を 1280×800（Obsidian 用は 1200×800）にして、次の場面を撮る。
  - Chrome：対応サイトの商品ページの表示と、ポップアップ
  - Chrome：拡張の同意画面（データの扱いの説明）
  - Obsidian：本棚、登録画面、`本の一覧.base` の表示
- WSL で撮るときも、WSLg の画面ではなく `xvfb-run` の仮想画面で動かす。
- 合成の本には、自由に使える書誌だけを使う。商品ページを写す画面では、書店のページと表紙が写ることを所有者が承知して選ぶ。

## 申請前に所有者が行うこと

- Obsidian：community.obsidian.md のアカウント作成と GitHub の連携、申請後の **Review branch** での Build verification の確認、カテゴリの選択、アイコンとスクリーンショットの用意。
- Chrome Web Store：開発者登録と登録料、公開する名前、連絡先のメールアドレスの確認、トレーダーか非トレーダーかの申告、カテゴリと配布地域の選択、購入の記録を「財務情報と支払い情報」として申告するかの判断、スクリーンショット 1 枚以上とプロモーション タイル（小）の用意。
