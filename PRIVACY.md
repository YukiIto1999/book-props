# Privacy policy

[English](#english) | [日本語](#日本語)

## English

This policy covers the Book Props browser extension and the Book Props Obsidian plugin.

### What the extension reads

On supported product pages (Amazon.co.jp, Rakuten Books, VALUE BOOKS, and BOOKOFF Online), the extension reads the book's title, authors, ISBN, edition label, publisher, publication date, and cover image address. It does not read other pages, your browsing history, form input, or account information on these sites.

### Where the data goes

The extension sends this information only to the Book Props plugin of Obsidian on the same computer, over a local connection to `127.0.0.1` protected by TLS 1.3. The plugin compares it with the notes in your Obsidian vault and, when you choose to, records a purchase or a wish in that vault.

Book Props sends no data to the developer or to any other party. It has no analytics, telemetry, advertising, or accounts.

### What is stored on your computer

- In the browser: the handle of the connection folder you chose, a random identifier for this installation, a session token that expires, and records of purchases whose result is not yet confirmed. They stay in the extension's own storage.
- In your home folder: the connection folder `Book Props/<vault name>`, which holds the local address, an opaque identifier, a TLS trust anchor, and one-time pairing proofs, but no book data.
- In your vault: the book notes you create.

To remove the data, select **このブラウザの接続を解除** in the extension and **ペアリングを解除** in the Obsidian plugin settings, then remove the extension and the plugin. Your book notes remain as ordinary Markdown files.

### Requests to other services

When you look up a book in the Obsidian plugin, the plugin sends the ISBN or title you typed to the National Diet Library Search (`https://ndlsearch.ndl.go.jp`), or downloads the product page whose address you entered. The extension itself makes no requests to other services.

### Contact

Report questions or concerns as an issue at <https://github.com/YukiIto1999/book-props/issues>.

## 日本語

このポリシーは、Book Props のブラウザ拡張と Obsidian プラグインを対象とする。

### 拡張が読み取るもの

対応サイト（Amazon.co.jp、楽天ブックス、バリューブックス、BOOKOFF オンライン）の商品ページで、書名、著者、ISBN、版の表記、出版社、発行日、表紙画像のアドレスを読み取る。それ以外のページ、閲覧履歴、フォームの入力、これらのサイトのアカウント情報は読み取らない。

### データの送り先

読み取った情報は、同じ端末の Obsidian の Book Props プラグインにだけ、`127.0.0.1` への TLS 1.3 で保護した接続で送る。プラグインは Vault のノートと照らし合わせ、利用者が選んだときに購入や購入希望をその Vault に記録する。

Book Props は、開発者にも第三者にもデータを送らない。利用状況の分析や送信、広告、アカウントの登録はない。

### 端末に保存するもの

- ブラウザ：選んだ接続用フォルダのハンドル、この拡張を見分けるための無作為な識別子、期限付きのセッショントークン、結果をまだ確認できていない購入の記録。いずれも拡張専用の保存領域に置く。
- ホームフォルダ：接続用フォルダ `Book Props/<Vault 名>`。端末内の接続先、不透明な識別子、TLS の信頼アンカー、一度だけ使うペアリングの検証値を置き、本のデータは置かない。
- Vault：利用者が作る本のノート。

これらを消すときは、拡張の「このブラウザの接続を解除」と、Obsidian のプラグイン設定の「ペアリングを解除」を押してから、拡張とプラグインを削除する。本のノートは通常の Markdown として残る。

### 他のサービスへの要求

Obsidian プラグインで書誌を探すと、入力した ISBN か書名を国立国会図書館サーチ（`https://ndlsearch.ndl.go.jp`）に送るか、入力したアドレスの商品ページを取得する。拡張自体は他のサービスに要求を送らない。

### 問い合わせ

質問や懸念は <https://github.com/YukiIto1999/book-props/issues> の Issue で受け付ける。
