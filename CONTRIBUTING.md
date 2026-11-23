# CONTRIBUTING

この文書はBook Propsを変更・保守する開発者向け。導入する場合は[Windowsでの導入・運用](docs/installation.md)を参照する。

## 開発環境

LinuxまたはWSLでNixとdevenvを用意し、このリポジトリのルートで実行する。[`devenv.nix`](devenv.nix)と[`devenv.lock`](devenv.lock)が開発環境を、[`package.json`](package.json)と[`pnpm-lock.yaml`](pnpm-lock.yaml)がpnpmとJavaScriptの依存を定める。

```sh
devenv shell -- pnpm install --frozen-lockfile
devenv shell -- pnpm verify
```

## 変更と検証

- 利用者から見える契約は[要件](docs/requirements.md)、コードの責務と境界は[アーキテクチャ](docs/architecture.md)を確認する。生成物ではなく正本を変更し、振る舞いを変えた場合は同じ変更で要件と検査を更新する。
- `devenv shell -- pnpm verify` はCIと同じ入口で、整形、lint、型、依存境界、業務と保存のテストを実行する。`devenv shell -- pnpm verify:push` は成果物の生成とTLS実結合を加える。対象と依存は[`project.json`](project.json)を参照する。
  TLS 実結合では devenv が供給する D-Bus の設定を使い、実行機のセッションや `/etc/dbus-1/session.conf` には依存しない。
- 画面や保存経路を変えた場合は、合成データの一時Vaultと別のChromeプロファイルを使い、操作後の表示とMarkdownの両方を確かめる。報告には対象のコミット、OSとアプリの版、操作、期待結果と実際の結果を添える。証明書の秘密鍵、ペアリングコード、資格情報、利用者のVaultの内容は添付しない。

## コミット

一つのコミットに一つの目的を入れる。件名は `型: 日本語の要約` の一行とし、本文は付けない。変更の目的と文末は、[commit-purpose](https://github.com/YukiIto1999/architecture-standard/blob/main/principles/documentation/commit-purpose.md)と[sentence-endings](https://github.com/YukiIto1999/architecture-standard/blob/main/principles/documentation/sentence-endings.md)に従う。

## 配布版の準備

### 初回の公開設定

以下は GitHub リポジトリの所有者が初回公開前に行う。

1. **Settings → Rules → Rulesets → New tag ruleset** で、対象 `v*`、状態 **Active** のルールセットを二つ作る。
   一つは **Restrict creations** だけを有効にし、Bypass list はこのリポジトリの管理者だけに絞る。
   もう一つは **Restrict updates** と **Restrict deletions** を有効にし、Bypass list は空にする。
   こうすると公開前でも、作成済みタグの指すコミットを差し替えられない。
2. **Settings → Environments** で `release` を作る。
   **Selected branches and tags** を選び、**Tag** に `v*` を追加する。
   Branch のルールは追加しない。
   版タグの push を公開の承認とするので、単独運用では Required reviewers を追加しない。
   ビルド証明の発行を版タグに限定する設定であり、環境にシークレットは置かない。
3. **Settings → General → Releases** で **Enable release immutability** を有効にする。
   公開済みの ZIP とタグが固定され、GitHub が版タグ・コミット・添付ファイルを結び付ける Release の証明を生成する。

署名鍵や公開用シークレットの登録は不要。

### 公開前に試す

既定ブランチから [Release ワークフロー](.github/workflows/release.yml)を手動実行すると、ZIP の作成、脆弱性検査、Windows での受け入れまで確認できる。
Windows では同じ ZIP を展開し、一時 Vault と別の Chrome プロファイルで、証明書の登録、ペアリング、購入希望と購入の記録を試す。
結果は走行ログとスクリーンショットで確認できる。
手動実行ではビルドの証明を発行せず、公開もしない。

手元で同じ梱包と検査を行う場合は、依存を導入した対象コミットで次を実行する。
`v0.1.0` はルートと両方のコンポーネントに共通する版に置き換える。
どのコマンドも失敗したら、次へ進まない。

```sh
devenv shell -- pnpm verify:push
mkdir -p work
devenv --profile release shell -- pnpm package:release v0.1.0 work/package-v0.1.0
(cd work/package-v0.1.0 && sha256sum --check SHA256SUMS)
devenv --profile release shell -- python3 tools/scripts/audit-release.py work/package-v0.1.0/book-props-v0.1.0.zip
```

Rust を更新する場合は、[`devenv.nix`](devenv.nix) の `rustRevision` と、同じリビジョンの Rust リポジトリ直下にある `COPYRIGHT`・`LICENSE-APACHE`・`LICENSE-MIT` の写しを一緒に更新する。
写しは [`tools/release/rust/`](tools/release/rust/) のリビジョン名のディレクトリに置き、旧リビジョンの写しは残さない。

ZIP に入っている `obsidian/` と `chrome/` を導入に使う。
ライセンスと依存の目録は ZIP に同梱されるが、プラグインや拡張のフォルダには置かない。
Vault、接続設定、資格情報は配布物に入れない。

### 版タグと公開

公開するコードが既定ブランチに入っていることを確認し、そのコミットに注釈付きタグを付ける。
`v0.1.0` はルートと両方のコンポーネントに共通する版に置き換える。
タグを push する直前に Immutable Releases が有効であることを確認する。
Actions の標準トークンでは公開前にこの設定を照会できないため、リポジトリの管理権限がある GitHub CLI で確認する。

```bash
read -r -p 'Source のコミット SHA: ' source
test "$(gh api repos/YukiIto1999/book-props/immutable-releases --jq .enabled)" = true &&
  git tag -a v0.1.0 "$source" -m 'Book Props v0.1.0' &&
  git push origin refs/tags/v0.1.0
```

タグで起動した走行が ZIP を一度だけ梱包し、SBOM と既知の脆弱性を検査する。
同じ ZIP が Windows の受け入れに合格した場合だけ、GitHub Actions が ZIP と SPDX SBOM の署名付きビルド証明を発行し、成果物のハッシュ、ワークフロー、版タグ、コミットを照合する。
検証済みの ZIP、SBOM、`SHA256SUMS` を下書きへ添付し、GitHub 側のハッシュが一致した場合だけ Release を公開する。
公開済みのタグや成果物は上書きしない。
一時的な障害なら、公開済みでないことを確認し、元のタグの走行で **Re-run all jobs** を選ぶ。
**Re-run failed jobs** では、現在の試行で ZIP が作られず、脆弱性検査やビルド証明の前提を満たさないことがある。
下書きだけが残っている場合は、その下書きだけを取り除き、タグを残してから再実行する。

公開後に ZIP と証明を再確認するときは、[配布物の検証](docs/installation.md#任意配布物の検証)を参照する。

## アーキテクチャの標準

[architecture-standard](https://github.com/YukiIto1999/architecture-standard)を使用する。準拠を判断するときは作業環境の現行の標準本文と適用手順を参照する。標準から外れている箇所は[アーキテクチャ](docs/architecture.md#標準にない採用と逸脱)に記す。
