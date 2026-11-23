# Windowsでの導入・運用

Chromeでの照合に使うObsidianとChromeは、同じWindows端末で起動する。デスクトップ版Obsidian 1.13.0以降が必要。手動導入と再接続はWindows 11、Obsidian 1.15.1、Chrome 157で確認した。ビルド済みの成果物があれば、利用する端末にNixやdevenvは不要。

普段のVaultに入れる前に、次の手順を一時Vaultと別のChromeプロファイルで通す。
普段のVaultへ切り替えるときは、ノートと `.obsidian` を含むバックアップを作り、書籍専用のフォルダを用意する。
書籍フォルダはVaultのルートにはできない。
普段のVaultで発行した証明書の指紋を照合し、使うChromeプロファイルに登録してペアリングする。
一時Vaultの接続先、証明書、コードは使い回さない。

## 成果物を用意する

[GitHub Releases](https://github.com/YukiIto1999/book-props/releases/latest) の **Assets** から `book-props-v<版>.zip` をダウンロードする。
GitHub が自動で添付する `Source code (zip)` は導入用ではない。
ダウンロードした ZIP をエクスプローラーで右クリックし、「すべて展開」を選ぶ。
ZIP の取得と展開に GitHub アカウント、GitHub CLI、PowerShell は不要。
配布物を手元で検証したい場合は、展開前に[任意の検証手順](#任意配布物の検証)を使う。

ZIP の `obsidian/` からは `main.js` と `manifest.json` だけを使う。
`chrome/` はフォルダごと Windows 側の固定した場所に置き、`manifest.json` が直下にあるそのフォルダを読み込む。
ライセンスと依存の目録は読み込み先に置かない。

## ObsidianとChromeに入れる

1. Obsidianを閉じ、使うVaultの `.obsidian/plugins/book-props/` に `main.js` と `manifest.json` を置く。Vaultの設定フォルダを変更している場合は、その中の `plugins/book-props/` を使う。Vaultを開き直し、「設定」→「コミュニティプラグイン」で、自分が置いた Book Props を有効にする。
2. Vaultに `Books` などの書籍フォルダを作る。Obsidianの「設定」→「Book Props」で、Vaultからの相対パス（例：`Books`）を「書籍フォルダ」に入れて「適用」を押す。
3. Chromeで `chrome://extensions/` を開く。「デベロッパー モード」を有効にし、「パッケージ化されていない拡張機能を読み込む」でChrome成果物のフォルダを選ぶ。表示された Book Props の拡張IDを控える。
4. Obsidianの Book Props 設定に「Chrome拡張ID」を入れ、「接続設定を適用」を押す。`https://…localhost:…` の接続先と `SHA-256` 指紋が表示されれば、ペアリングへ進める。

## 証明書を登録してペアリングする

1. Obsidianの Book Props 設定で「証明書を保存」を押す。保存した `.crt` の指紋を確認するには、Windows PowerShellで次を実行し、ファイルのフルパスを入力する。

   ```powershell
   $path = Read-Host '保存した .crt のフルパス'
   $cert = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($path)
   $sha256 = [System.Security.Cryptography.SHA256]::Create()
   [BitConverter]::ToString($sha256.ComputeHash($cert.RawData)).Replace('-', ':')
   ```

2. 指紋がObsidianの表示と一致する場合だけ、使うChromeプロファイルで `chrome://certificate-manager/` を開き、「ローカル証明書」→「自分でインストール」→「信頼できる証明書」の「インポート」から、その末端証明書（`.crt`）を登録する。登録先は[Chromeのプロファイルごとの証明書ストア](https://chromium.googlesource.com/chromium/src/+/157.0.8103.79/chrome/browser/net/server_certificate_database_service_factory.cc)であり、Windowsの証明書ストアには追加しない。指紋が一致しなければ登録せず、正しいVaultから保存し直す。
3. Chrome拡張の「接続設定・対応サイト」を開く。Obsidianで「コードを発行」を押し、表示された「接続先」と「一回限りのコード」をChrome側に入力して「ペアリング」を押す。Chromeが接続先へのアクセスを尋ねたら、Obsidianの表示と同じ接続先であることを確かめて許可する。「ペアリングしました。」と表示されれば接続できている。
4. 一時Vaultで[楽天ブックスの『リーダブルコード』](https://books.rakuten.co.jp/rb/11753651/)などの[対応商品ページ](requirements.md#対応サイト)を開き、拡張の「欲しい本に追加」を選ぶ。ポップアップを開き直すと「欲しいに登録済み」と表示され、指定した書籍フォルダに本ページが一つできる。この操作は注文ではなく、Vaultに購入希望を記録するだけである。

## 日常の運用と復旧

- **再接続：** Chromeの再起動、Obsidianの終了、セッション失効の後は、Obsidianを起動して新しいコードでペアリングする。接続設定に同じ接続先と指紋が表示されていれば、証明書を登録し直す必要はない。
- **Chrome拡張フォルダの移動：** 現在の拡張には `manifest.json` に固定の `key` がなく、[拡張IDは読み込みパスで決まる](https://chromium.googlesource.com/chromium/src/+/157.0.8103.79/extensions/common/extension.cc)。移動前に、結果不明の購入があれば先に確認する。Chromeで旧拡張を削除して移動先から読み込む。Obsidianには旧IDが残るため、新しいIDを入力して「接続設定を適用」を押し、新しく発行したコードでペアリングする。拡張IDの変更だけなら、証明書の再登録は不要。
- **証明書の更新：** Obsidianの「証明書を更新」を押す。Chromeの「自分でインストール」からBook Propsの旧証明書だけを削除し、更新後の指紋を確かめて新しい証明書を登録する。その後、ペアリングし直す。待ち受けを開始できない場合は、書籍フォルダ、拡張ID、Windowsの利用者が変わっていないかを確認する。
- **購入結果が不明：** 別の購入として登録し直さず、購入時と同じVault・書籍フォルダに接続し、「同じ購入の結果を再確認」を選ぶ。再確認できない場合はObsidianで本ページの記録を確認する。「保留を解除」は未保存を意味しない。
- **取り下げと復元：** 誤登録はObsidianの「本・版を管理」からアーカイブ・復元する。版の移動で移動元・移動先の両方から版が消えた場合は、移動した端末の同じVault・書籍フォルダで「本・版の管理」を開き、控えを確認する。控えは端末内の `%LOCALAPPDATA%\BookProps\edition-moves\` にあり、Vaultや書籍JSONには含まれない。別端末で控えから復元できるとは扱わない。
- **同期：** 既存のVault同期を使う場合は、一時Vaultで自分の同期方式を試してから導入する。Windowsの秘密鍵はVaultと一緒には移らない。複数の端末でChromeと連携する場合は、書籍ノートは同期しても、Book Propsの接続設定（`plugins/book-props/data.json`）は端末間で上書きしない。別端末の設定が上書きされると、対応する秘密鍵を取得できず、接続できなくなる。[同期で検出できない競合](requirements.md#端末と同期)にも注意する。

## 更新と切り戻し

1. 結果不明の購入があれば先に確認する。Vaultと現在の両成果物を別の場所にバックアップし、ObsidianのプラグインとChrome拡張を無効にする。Obsidianを閉じる。
2. [同じ新版の ZIP](#成果物を用意する)から両方を入れ替える。Obsidian は `main.js` と `manifest.json` だけを置き換え、同じ Vault で使う `data.json` は残す。Chrome は元の拡張フォルダに新しい成果物を置く。自動更新は行わない。
3. 両方を有効にする。Chromeの `chrome://extensions/` で Book Props の再読み込みを押し、必要ならペアリングし直す。商品ページを再読み込みし、既知の本の所持・購入希望が正しいことを確かめる。

同じフォルダでの成果物の置き直し・再ペアリングは確認済み。異なる開発版からの上書き更新と、フォルダの移動で拡張IDが変わった後の再ペアリングは実機では未確認なので、まず一時Vaultで試す。

問題が起きたら、先に両方を無効にする。書籍ノートは通常のMarkdownなので、プラグインなしで開ける。前の動作へ戻すなら、両方の成果物を対応する同じ版へ戻す。ノートを戻す必要がある場合は、更新後の変更を失わないよう現在のVaultも退避し、差分を確かめてからバックアップを復元する。

利用をやめる場合は、Obsidianで接続設定に表示される指紋を控えてから、プラグインと拡張を無効にする。証明書を登録したChromeプロファイルごとに `chrome://certificate-manager/` の「ローカル証明書」→「自分でインストール」→「信頼できる証明書」を開き、指紋が一致するBook Propsの末端証明書だけを削除する。その後、Chromeの拡張を削除し、Obsidianを閉じてVaultの `plugins/book-props/` を取り除ける。書籍ノートを削除する必要はない。

## 任意：配布物の検証

ZIP の SHA-256 を確認する場合は、同じ Release から `SHA256SUMS` も取得し、ZIP と同じフォルダに置く。
そのフォルダで Windows PowerShell を開き、ファイル名を取得した版に合わせて実行する。
ハッシュが一致しなければ、その ZIP は展開しない。

```powershell
$zip = 'book-props-v0.1.0.zip'
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
  $tag = 'v0.1.0'
  $zip = "book-props-$tag.zip"
  Get-Command gh -CommandType Application -ErrorAction Stop | Out-Null
  gh release verify-asset $tag $zip --repo YukiIto1999/book-props
  if ($LASTEXITCODE -ne 0) { throw '公式 Release の添付ファイルとして検証できません。' }
  gh attestation verify $zip --repo YukiIto1999/book-props --signer-workflow YukiIto1999/book-props/.github/workflows/release.yml --source-ref "refs/tags/$tag"
  if ($LASTEXITCODE -ne 0) { throw 'ビルドの証明を検証できません。' }
}
```
