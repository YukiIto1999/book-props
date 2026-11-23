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
- 画面や保存経路を変えた場合は、合成データの一時Vaultと別のChromeプロファイルを使い、操作後の表示とMarkdownの両方を確かめる。報告には対象のコミット、OSとアプリの版、操作、期待結果と実際の結果を添える。証明書の秘密鍵、ペアリングコード、資格情報、利用者のVaultの内容は添付しない。

## コミット

一つのコミットに一つの目的を入れる。件名は `型: 日本語の要約` の一行とし、本文は付けない。変更の目的と文末は、[commit-purpose](https://github.com/YukiIto1999/architecture-standard/blob/main/principles/documentation/commit-purpose.md)と[sentence-endings](https://github.com/YukiIto1999/architecture-standard/blob/main/principles/documentation/sentence-endings.md)に従う。

## 配布版の準備

### 初回の署名設定

GitHub で `v*` タグを対象とする ruleset を用意し、作成・更新・削除を信頼するリリース担当者に限る。
GitHub の `release` Environment でも、許可する対象を版タグに絞る。
リポジトリの設定で Release の不変性を有効にする。

リポジトリのルートで次を実行する。
`/path/to/private/book-props` はリポジトリの外にある保護された保存先に置き換える。

```sh
devenv --profile release shell -- cosign generate-key-pair --output-key-prefix /path/to/private/book-props
```

公開鍵だけを `tools/release/cosign.pub` として既定ブランチにコミットする。
暗号化済みの秘密鍵ファイルの内容を `release` Environment の Secret `RELEASE_SIGNING_KEY`、そのパスワードを `RELEASE_SIGNING_PASSWORD` として登録する。
秘密鍵とパスワードは Git・作業記録・ログに残さない。

### 候補の確認

公開鍵を含む既定ブランチから、[Release ワークフロー](.github/workflows/release.yml)を手動実行する。
Actions が作った候補 ZIP を一時 Vault と別の Chrome プロファイルに入れ、照合と登録を確かめる。更新のときは切り戻しも試す。
手動実行は候補の生成と検査までで、Release は公開しない。

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

ZIP に入っている `obsidian/` と `chrome/` を導入に使う。
ライセンスと依存の目録は ZIP に同梱されるが、プラグインや拡張のフォルダには置かない。
Vault、接続設定、資格情報は配布物に入れない。

### 版タグと公開

候補 ZIP を確認したコミットに `v0.1.0` のような版タグを付け、タグだけを push する。
Actions はタグのコミットをビルドし、その ZIP の SPDX SBOM、既知脆弱性、署名と由来を検査する。
全検査が通った場合だけ、同じ下書きに添付したファイルのハッシュを GitHub の記録と照合し、Release を公開する。
公開済みのタグや成果物は上書きしない。
公開前に失敗して下書きが残ったときは、状態を確認してから処理し、再実行で下書きを黙って上書きしない。

伝送時のハッシュだけでなく出所も確かめる場合は、タグのソースから取得した信頼済みの公開鍵を使い、公開 ZIP とその `.sigstore.json` を照合する。
鍵ペアで署名し公開ログには送信しないため、検証に `--insecure-ignore-tlog` を指定する。

```sh
cosign verify-blob --key tools/release/cosign.pub --insecure-ignore-tlog \
  --bundle book-props-v0.1.0.zip.sigstore.json book-props-v0.1.0.zip
```

## アーキテクチャの標準

[architecture-standard](https://github.com/YukiIto1999/architecture-standard)を使用する。準拠を判断するときは作業環境の現行の標準本文と適用手順を参照する。標準から外れている箇所は[アーキテクチャ](docs/architecture.md#標準にない採用と逸脱)に記す。
