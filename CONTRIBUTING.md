# CONTRIBUTING

この文書は Book Props を変更・保守する開発者向け。利用する場合は[導入と運用](docs/installation.md)を参照する。

## 開発環境

LinuxまたはWSLでNixとdevenvを用意し、このリポジトリのルートで実行する。[`devenv.nix`](devenv.nix)と[`devenv.lock`](devenv.lock)が開発環境を、[`package.json`](package.json)と[`pnpm-lock.yaml`](pnpm-lock.yaml)がpnpmとJavaScriptの依存を定める。

```sh
devenv shell -- pnpm install --frozen-lockfile
devenv shell -- pnpm verify
```

## 変更と検証

- 利用者から見える契約は[要件](docs/requirements.md)、コードの責務と境界は[アーキテクチャ](docs/architecture.md)を確認する。生成物ではなく正本を変更し、振る舞いを変えた場合は同じ変更で要件と検査を更新する。
- `devenv shell -- pnpm verify` は commit の前に手元で走らせる入口で、CI も同じタスクを使う。整形、lint、型、依存の境界、業務と保存のテストを実行する。Obsidian コミュニティの自動審査と同じ規則でリポジトリの TypeScript を調べる [`tools/obsidian-review`](tools/obsidian-review/eslint.config.mjs) も含み、審査で誤りになる指摘があれば失敗する。`devenv shell -- pnpm verify:push` は成果物の生成と、接続用フォルダとTLSの実結合を加える。対象と依存は[`project.json`](project.json)を参照する。
- 業務の規則は [`core/vault`](core/vault) に置き、TypeScript 側には保存形式、ファイル操作、接続、画面を置く。層と読み込みの向きは[アーキテクチャ](docs/architecture.md#コードの配置と分担)を参照する。
- 画面や保存経路を変えた場合は、合成データの一時Vaultと別のChromeプロファイルを使い、操作後の表示とMarkdownの両方を確かめる。報告には対象のコミット、OSとアプリの版、操作、期待結果と実際の結果を添える。証明書の秘密鍵、ペアリングコード、資格情報、利用者のVaultの内容は添付しない。

### push の前の検証

追跡している [`.githooks/pre-push`](.githooks/pre-push) が、push の前に `devenv shell -- pnpm verify:push` を走らせ、合格したときだけ push を通す。検証した内容と送る内容を一致させるため、未コミットの変更や追跡していないファイルがある場合と、送るコミットが HEAD と異なる場合は、検証せずに止まる。送るコミットがすべて送り先の追跡ブランチにある場合（push 済みのコミットに付けたタグなど）は、検証を省く。

dotfiles の global のフックを使う環境では、リポジトリを信頼したときだけ `.githooks/` のフックが動く。リポジトリの所有者は、フックの内容を確かめてから一度だけ次を設定する。設定するまでは、push の前に `devenv shell -- pnpm verify:push` を手で実行する。

```sh
git config dotfiles.hooks.trusted true
```

global のフックを使わない環境では、`git config core.hooksPath .githooks` で有効にする。

検証の入口ごとの所要時間の目標と上限は [`tools/verification-time.json`](tools/verification-time.json) にだけ置き、フック、CI、`pnpm verify:full` のスクリプトが同じ値を読む。目標を超えても走行は止めず、上限に達した走行だけを止める。値を変えるときは、測った環境と実測、余裕の量と理由を同じファイルに書く。

## コミット

一つのコミットに一つの目的を入れる。件名は `型: 日本語の要約` の一行とし、本文は付けない。変更の目的と文末は、[commit-purpose](https://github.com/YukiIto1999/architecture-standard/blob/main/principles/documentation/commit-purpose.md)と[sentence-endings](https://github.com/YukiIto1999/architecture-standard/blob/main/principles/documentation/sentence-endings.md)に従う。

## 配布版の準備

### 初回の公開設定

以下は GitHub リポジトリの所有者が初回公開前に行う。

1. **Settings → Rules → Rulesets → New tag ruleset** で、対象 `*.*.*`、状態 **Active** のルールセットを二つ作る。Obsidian は版と同じ名前のタグの Release から `main.js` と `manifest.json` を取得するので、版タグには `v` を付けない。`*.*.*` は、0.4.0 までの `v0.4.0` のようなタグも対象に含む。
   一つは **Restrict creations** だけを有効にし、Bypass list はこのリポジトリの管理者だけに絞る。
   もう一つは **Restrict updates** と **Restrict deletions** を有効にし、Bypass list は空にする。
   こうすると公開前でも、作成済みタグの指すコミットを差し替えられない。
2. **Settings → Environments** で `release` を作る。
   **Selected branches and tags** を選び、**Tag** に `*.*.*` を追加する。
   Branch のルールは追加しない。
   版タグの push を公開の承認とするので、単独運用では Required reviewers を追加しない。
   ビルド証明の発行を版タグに限定する設定であり、環境にシークレットは置かない。
3. **Settings → General → Releases** で **Enable release immutability** を有効にする。
   公開済みの添付ファイルとタグが固定され、GitHub が版タグ・コミット・添付ファイルを結び付ける Release の証明を生成する。

署名鍵や公開用シークレットの登録は不要。

### 公開前に試す

既定ブランチから [Release ワークフロー](.github/workflows/release.yml)を手動実行すると、添付ファイルの作成、脆弱性検査、Windows・Linux での受け入れまで確認できる。
両 OS では同じ ZIP を展開し、一時 Vault と新しい Chrome プロファイルで、証明書を登録せずにペアリング、再接続、購入希望と購入の記録を試す。Windows では、公開済みの v0.1.0 で結果不明の購入を作り、同じ場所に更新して、元の書籍フォルダでだけ再照会できることも確認する。
結果は走行ログとスクリーンショットで確認できる。
手動実行ではビルドの証明を発行せず、公開もしない。

手元で同じ梱包と検査を行う場合は、依存を導入した対象コミットで次を実行する。
`0.5.0` はルートと両方のコンポーネントに共通する版に置き換える。
どのコマンドも失敗したら、次へ進まない。

```sh
devenv shell -- pnpm verify:push
mkdir -p work
devenv --profile release shell -- pnpm package:release 0.5.0 work/package-0.5.0
(cd work/package-0.5.0 && sha256sum --check SHA256SUMS)
devenv --profile release shell -- python3 tools/scripts/audit-release.py work/package-0.5.0/book-props-0.5.0.zip
```

Rust を更新する場合は、[`devenv.nix`](devenv.nix) の `rustRevision` と、同じリビジョンの Rust リポジトリ直下にある `COPYRIGHT`・`LICENSE-APACHE`・`LICENSE-MIT` の写しを一緒に更新する。
写しは [`tools/release/rust/`](tools/release/rust/) のリビジョン名のディレクトリに置き、旧リビジョンの写しは残さない。

Release には次を添付する。どれも同じビルドから作り、SBOM は ZIP を対象にする。

- `book-props-<版>.zip`：手動導入用。`obsidian/` と `chrome/`、ライセンスと依存の目録を含む。
- `main.js` と `manifest.json`：Obsidian のコミュニティプラグインとして取得されるファイル。ZIP の `obsidian/` と同じバイト列である。
- `book-props-chrome-<版>.zip`：Chrome Web Store に提出する拡張。直下に `manifest.json` があり、ZIP の `chrome/` とライセンスの目録を含む。
- `THIRD-PARTY-NOTICES.txt`：同梱した依存のライセンス。

Vault、接続設定、資格情報は配布物に入れない。

### 版タグと公開

公開するコードが既定ブランチに入っていることを確認し、そのコミットに注釈付きタグを付ける。
`0.5.0` はルートと両方のコンポーネントに共通する版に置き換える。
タグを push する直前に Immutable Releases が有効であることを確認する。
Actions の標準トークンでは公開前にこの設定を照会できないため、リポジトリの管理権限がある GitHub CLI で確認する。

```bash
read -r -p 'Source のコミット SHA: ' source
test "$(gh api repos/YukiIto1999/book-props/immutable-releases --jq .enabled)" = true &&
  git tag -a 0.5.0 "$source" -m 'Book Props 0.5.0' &&
  git push origin refs/tags/0.5.0
```

タグで起動した走行が添付ファイルを一度だけ梱包し、SBOM と既知の脆弱性を検査する。
同じ ZIP が Windows と Linux の受け入れに合格した場合だけ、GitHub Actions が各添付ファイルと SPDX SBOM の署名付きビルド証明を発行し、成果物のハッシュ、ワークフロー、版タグ、コミットを照合する。
検証済みの添付ファイル、SBOM、`SHA256SUMS` を下書きへ添付し、GitHub 側のハッシュが一致した場合だけ Release を公開する。
公開済みのタグや成果物は上書きしない。
一時的な障害なら、公開済みでないことを確認し、元のタグの走行で **Re-run all jobs** を選ぶ。
**Re-run failed jobs** では、現在の試行で ZIP が作られず、脆弱性検査やビルド証明の前提を満たさないことがある。
下書きだけが残っている場合は、その下書きだけを取り除き、タグを残してから再実行する。

公開後に ZIP と証明を再確認するときは、[配布物の検証](docs/installation.md#任意配布物の検証)を参照する。

## アーキテクチャの標準

[architecture-standard](https://github.com/YukiIto1999/architecture-standard)を使用する。準拠を判断するときは作業環境の現行の標準本文と適用手順を参照する。標準から外れている箇所は[アーキテクチャ](docs/architecture.md#標準にない採用と逸脱)に記す。
