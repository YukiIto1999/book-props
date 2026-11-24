# Windows・Linux での導入と運用

Obsidian と Chrome は同じ端末で起動する。デスクトップ版 Obsidian 1.13.0 以降と Chrome が必要。ビルド済みの ZIP を使えば、証明書の登録、追加の実行ファイル、コマンド操作は不要。

この手順は v0.2.0 以降が対象です。
v0.1.0 を新たに入れる場合は[旧版の導入手順](https://github.com/YukiIto1999/book-props/blob/6d4b75edeed2ccf85e052d2b91f85eaee5679cb7/docs/installation.md)を使います。
v0.1.0 から切り替える場合は[更新と切り戻し](#更新と切り戻し)へ進みます。

普段の Vault に入れる前に、以下の操作を一時 Vault と別の Chrome プロファイルで試せる。普段の Vault に導入する前には、ノートと `.obsidian` を含むバックアップを取る。

## 成果物を用意する

[GitHub Releases](https://github.com/YukiIto1999/book-props/releases/latest) の **Assets** から `book-props-v<版>.zip` をダウンロードする。
GitHub が自動で添付する `Source code (zip)` は導入用ではない。
ZIP を展開する。Windows ではエクスプローラーの「すべて展開」を使える。ZIP の取得と展開に GitHub アカウント、GitHub CLI、PowerShell は不要。
配布物を手元で検証したい場合は、展開前に[任意の検証手順](#任意配布物の検証)を使う。

ZIP の `obsidian/` からは `main.js` と `manifest.json` だけを使う。
`chrome/` はフォルダごと端末の固定した場所に置く。Chrome では `manifest.json` が直下にあるそのフォルダを読み込む。
ライセンスと依存の目録は読み込み先に置かない。

## ObsidianとChromeに入れる

1. Obsidianを閉じ、使うVaultの `.obsidian/plugins/book-props/` に `main.js` と `manifest.json` を置く。Vaultの設定フォルダを変更している場合は、その中の `plugins/book-props/` を使う。Vaultを開き直し、「設定」→「コミュニティプラグイン」で、自分が置いた Book Props を有効にする。
2. Vaultに `Books` などの書籍フォルダを作る。Obsidianの「設定」→「Book Props」で、Vaultからの相対パス（例：`Books`）を「書籍フォルダ」に入れて「適用」を押す。
3. Chromeで `chrome://extensions/` を開く。「デベロッパー モード」を有効にし、「パッケージ化されていない拡張機能を読み込む」でChrome成果物のフォルダを選ぶ。表示された Book Props の拡張IDを控える。
4. Obsidian の Book Props 設定に「Chrome拡張ID」を入れ、「接続設定を適用」を押す。

## ペアリングして確認する

1. 接続したい Vault の Book Props 設定で「ペアリング情報を発行」→「ペアリング情報をコピー」を押す。
2. Chrome 拡張の「接続設定・対応サイト」を開く。「ペアリング情報」に貼り付けて「ペアリング」を押す。「ペアリングしました。」と表示されれば接続できている。ペアリング情報は発行から5分以内に一度だけ使える。ウェブサイトや他の Vault から取得した情報は貼り付けない。使い終えたら、クリップボードに別の内容をコピーしておく。
3. [対応商品ページ](requirements.md#対応サイト)を開き、既知の本の所持・購入希望を確認する。一時 Vault で保存まで試すなら、[楽天ブックスの『リーダブルコード』](https://books.rakuten.co.jp/rb/11753651/)などを開き、「欲しい本に追加」を選ぶ。ポップアップを開き直すと「欲しいに登録済み」と表示され、書籍フォルダに本ページが一つできる。この操作は注文ではなく、Vault に購入希望を記録するだけである。

## 日常の運用と復旧

- **再接続：** Chrome や Obsidian を終了した後、またはセッションが失効した後は、接続する Vault で新しいペアリング情報を発行する。接続自体を開始できない場合は、同じ端末で開いているか、書籍フォルダと拡張 ID が正しいかを確認する。
- **Chrome 拡張フォルダの移動：** [拡張 ID は読み込みパスで決まる](https://chromium.googlesource.com/chromium/src/+/157.0.8103.79/extensions/common/extension.cc)。移動前に結果不明の購入を確認する。新しい場所から読み込み直したら、Obsidian に新しい ID を設定し、ペアリングし直す。
- **購入結果が不明：** 別の購入として登録し直さず、購入時と同じVault・書籍フォルダに接続し、「同じ購入の結果を再確認」を選ぶ。再確認できない場合はObsidianで本ページの記録を確認する。「保留を解除」は未保存を意味しない。
- **取り下げと復元：** 誤登録は Obsidian の「本・版を管理」からアーカイブ・復元する。版の移動で移動元・移動先の両方から版が消えた場合は、移動した端末の同じ Vault・書籍フォルダで「本・版を管理」を開き、控えを確認する。控えは Windows では `%LOCALAPPDATA%\BookProps\edition-moves\`、Linux では `$XDG_DATA_HOME/BookProps/edition-moves/`（未設定時は `~/.local/share` 配下）にある。Vault や書籍 JSON には含まれない。
- **同期：** 書籍ノートは既存の方法で同期できるが、Book Props の設定ファイル `plugins/book-props/data.json` は端末間で上書きしない。接続先や拡張 ID は端末ごとに設定する。[同期で検出できない競合](requirements.md#端末と同期)にも注意する。

## 更新と切り戻し

1. Vault と現在の両成果物をバックアップする。Chrome 拡張と Obsidian プラグインを無効にし、Obsidian を閉じる。結果不明の購入があっても、拡張をアンインストールしたり、保留を解除したりしない。
2. 同じ新版の ZIP から両方を置き換える。Obsidian は `main.js` と `manifest.json` だけを差し替え、`data.json` は残す。Chrome は元の拡張フォルダの中身を差し替える。別の場所から読み込むと、以前の保留記録を引き継げない。
3. 両方を有効にし、`chrome://extensions/` で Book Props を再読み込みする。v0.1.0 から更新した場合は、新しいペアリング情報で接続し直す。結果不明の購入が残っている場合は、購入した Vault と書籍フォルダに接続し、「同じ購入の結果を再確認」を選ぶ。

v0.1.0 で Chrome に登録した証明書は、新版では使わない。旧版へ戻さないことを確認した後、登録した Chrome プロファイルの `chrome://certificate-manager/` で、旧版で控えた SHA-256 指紋と一致する Book Props の証明書だけを削除できる。一致を確認できない証明書には触れない。

問題が起きたら、先に両方を無効にする。書籍ノートは通常の Markdown なので、プラグインなしで開ける。旧版に戻すには、両方の成果物を同じ旧版に戻し、Obsidian を閉じて更新前の `data.json` を復元する。通常はノートを戻す必要はない。ノートも戻す場合は、更新後の変更を失わないよう現在の Vault を別に保存し、バックアップとの差分を確認する。

利用をやめる場合は、Chrome で拡張を削除し、Obsidian でプラグインを無効にする。Obsidian を閉じれば `plugins/book-props/` を取り除ける。書籍ノートは削除しなくてよい。

## 任意：配布物の検証

ZIP の SHA-256 を確認する場合は、同じ Release から `SHA256SUMS` も取得し、ZIP と同じフォルダに置く。
そのフォルダで Windows PowerShell を開き、ファイル名を取得した版に合わせて実行する。
ハッシュが一致しなければ、その ZIP は展開しない。

```powershell
$zip = 'book-props-v0.2.0.zip'
$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $zip -ErrorAction Stop).Hash.ToLowerInvariant()
$expected = (Get-Content -Raw -LiteralPath '.\SHA256SUMS' -ErrorAction Stop).Trim()
if ($expected -cne "$hash  $zip") { throw 'ダウンロードした ZIP の SHA-256 が一致しません。' }
'SHA-256 が一致しました。'
```

その ZIP が GitHub Release に登録された添付ファイルであり、指定したワークフローでビルドされたことまで確認する場合は、`github.com` に認証済みの [GitHub CLI](https://cli.github.com/) で次を実行する。
`$tag` は取得した版に合わせる。
どちらかが失敗したら、その ZIP は展開しない。

```powershell
& {
  $tag = 'v0.2.0'
  $zip = "book-props-$tag.zip"
  Get-Command gh -CommandType Application -ErrorAction Stop | Out-Null
  gh release verify-asset $tag $zip --repo YukiIto1999/book-props
  if ($LASTEXITCODE -ne 0) { throw '公式 Release の添付ファイルとして検証できません。' }
  gh attestation verify $zip --repo YukiIto1999/book-props --signer-workflow YukiIto1999/book-props/.github/workflows/release.yml --source-ref "refs/tags/$tag"
  if ($LASTEXITCODE -ne 0) { throw 'ビルドの証明を検証できません。' }
}
```

Linux で SHA-256 だけを確認する場合は、ZIP と `SHA256SUMS` を置いたフォルダで `sha256sum --check SHA256SUMS` を実行する。
