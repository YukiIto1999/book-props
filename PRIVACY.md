# Privacy policy

[English](#english) | [日本語](#日本語)

## English

This policy covers the Book Props browser extension and the Book Props Obsidian plugin.

### What the extension reads

On supported product pages (Amazon.co.jp, Rakuten Books, VALUE BOOKS, and BOOKOFF Online), the extension reads the page address and the book's title, authors, ISBN, edition label, publisher, publication date, and cover image address. It uses the page address only inside the extension, to tell whether the page is a supported product page. It does not read other pages, your browsing history, form input, or account information on these sites.

### Where the data goes

The extension sends the book details only to the Book Props plugin of Obsidian on the same computer, over a local connection to `127.0.0.1` protected by TLS 1.3. The plugin compares them with the notes in your Obsidian vault to show whether you own or want the book and, when you choose to, records a purchase or a wish in that vault. With a purchase, the extension also sends the random identifier of this installation and an identifier of that purchase request. The plugin writes both into the purchase record of the book note, so that a purchase sent again after an interrupted connection is not recorded twice.

Book Props sends no data to the developer or to any other party. It has no analytics, telemetry, advertising, or accounts. Its use of the data the extension reads complies with the [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/policies#protecting_user_privacy), including the [Limited Use](https://developer.chrome.com/docs/webstore/program-policies/limited-use) requirements.

### Your consent

When you install the extension, it opens its settings page with a notice of what it reads, where the data goes, and what it is used for. The extension reads no product page and does not connect to Obsidian until you select **同意して使い始める** there. Until then, its popup offers no actions and points you to that notice.

You can withdraw your consent at any time with **同意を取り消す** on the same page. The extension then stops reading pages at once, including pages already open; your pairing with Obsidian stays so that you can agree again later. If a later version changes what the extension reads or where it sends it, the extension asks for your consent again before reading anything.

### What is stored on your computer

- In the browser: the record of your consent (the version of this notice you agreed to and when), the handle of the connection folder you chose, a random identifier for this installation, a session token that expires, and records of purchases whose result is not yet confirmed. They stay in the extension's own storage.
- In your home folder: the connection folder `Book Props/<vault name>`, which holds the local address, an opaque identifier, a TLS trust anchor, and one-time pairing proofs, but no book data.
- In your user data folder: when you move an edition from one book to another, a recovery copy of that edition in `%LOCALAPPDATA%\BookProps\edition-moves\` on Windows or `$XDG_DATA_HOME/BookProps/edition-moves/` on Linux (`~/.local/share` when unset).
- In your vault: the book notes you create, and the plugin's settings, such as the books folder and the local address for the extension.

To stop the extension from reading pages, withdraw your consent in its settings. To remove the data, select **このブラウザの接続を解除** in the extension and **ペアリングを解除** in the Obsidian plugin settings, then remove the extension and the plugin. Your book notes remain as ordinary Markdown files.

### Requests to other services

When you look up a book in the Obsidian plugin, the plugin sends the ISBN or title you typed to the National Diet Library Search (`https://ndlsearch.ndl.go.jp`), or downloads the product page whose address you entered. After the extension records a purchase, an owned book, or a wish for a book with an ISBN, the plugin also sends that ISBN to the National Diet Library Search to align the book's title, authors, publisher, and series with the library's record, and to add its Nippon Decimal Classification number when the book has none. It sends one request at a time with a pause between them; when the service answers that it is busy, it waits and asks again up to three more times. For books whose check could not finish, it asks again when Obsidian starts and every hour while Obsidian is open. The command “本の表記をそろえる” sends the ISBNs of your books there only when you choose that option. The ownership check behind the badge sends nothing. The extension itself makes no requests to other services.

Book notes keep the address of each cover image, taken from the product page or typed by you. When you open the 表紙 view of `本の一覧.base`, Obsidian loads those images from their addresses, usually the stores' image servers. The plugin itself does not download them.

### Contact

Report questions or concerns as an issue at <https://github.com/YukiIto1999/book-props/issues>.

## 日本語

このポリシーは、Book Props のブラウザ拡張と Obsidian プラグインを対象とする。

### 拡張が読み取るもの

対応サイト（Amazon.co.jp、楽天ブックス、バリューブックス、BOOKOFF オンライン）の商品ページで、ページのアドレスと、本の書名、著者、ISBN、版の表記、出版社、発行日、表紙画像のアドレスを読み取る。ページのアドレスは、対応する商品ページかを見分けるために拡張の中だけで使う。それ以外のページ、閲覧履歴、フォームの入力、これらのサイトのアカウント情報は読み取らない。

### データの送り先

読み取った書誌は、同じ端末の Obsidian の Book Props プラグインにだけ、`127.0.0.1` への TLS 1.3 で保護した接続で送る。プラグインは Vault のノートと照らし合わせて、その本を持っているか、欲しい本に登録してあるかを示し、利用者が選んだときに購入や購入希望をその Vault に記録する。購入を記録するときは、この拡張を見分ける無作為な識別子と、その購入の要求の識別子も送る。プラグインはこの二つを本のノートの購入の記録に書き、接続が途切れて送り直した購入を二重に記録しないために使う。

Book Props は、開発者にも第三者にもデータを送らない。利用状況の分析や送信、広告、アカウントの登録はない。拡張が読み取ったデータの扱いは、[Chrome Web Store のユーザーデータに関するポリシー](https://developer.chrome.com/docs/webstore/program-policies/policies#protecting_user_privacy)と、その [Limited Use](https://developer.chrome.com/docs/webstore/program-policies/limited-use) の要件に従う。

### 利用者の同意

拡張を入れると、拡張の設定画面が開き、読み取るもの、送り先、使い道の説明を示す。そこで「同意して使い始める」を押すまで、拡張は商品ページを読み取らず、Obsidian にも接続しない。同意するまで、ポップアップは操作を出さず、この説明へ案内する。

同意は、同じ画面の「同意を取り消す」でいつでも取り消せる。取り消すと、開いているページも含めて、拡張はすぐに読み取りをやめる。Obsidian とのペアリングは残るので、後で同意し直せばそのまま使える。読み取るものや送り先を変える版では、何かを読み取る前に改めて同意を求める。

### 端末に保存するもの

- ブラウザ：同意の記録（同意した説明の版と日時）、選んだ接続用フォルダのハンドル、この拡張を見分けるための無作為な識別子、期限付きのセッショントークン、結果をまだ確認できていない購入の記録。いずれも拡張専用の保存領域に置く。
- ホームフォルダ：接続用フォルダ `Book Props/<Vault 名>`。端末内の接続先、不透明な識別子、TLS の信頼アンカー、一度だけ使うペアリングの検証値を置き、本のデータは置かない。
- 利用者のデータフォルダ：版を別の本へ移したとき、移した版の控えを Windows では `%LOCALAPPDATA%\BookProps\edition-moves\`、Linux では `$XDG_DATA_HOME/BookProps/edition-moves/`（未設定時は `~/.local/share` の下）に置く。
- Vault：利用者が作る本のノートと、書籍フォルダや拡張の接続先などのプラグインの設定。

読み取りだけをやめるときは、拡張の設定で同意を取り消す。データを消すときは、拡張の「このブラウザの接続を解除」と、Obsidian のプラグイン設定の「ペアリングを解除」を押してから、拡張とプラグインを削除する。本のノートは通常の Markdown として残る。

### 他のサービスへの要求

Obsidian プラグインで書誌を探すと、入力した ISBN か書名を国立国会図書館サーチ（`https://ndlsearch.ndl.go.jp`）に送るか、入力したアドレスの商品ページを取得する。拡張から ISBN のある本の購入・所持・欲しい本を登録した後も、本の書名・著者・出版社・シリーズを国立国会図書館の書誌にそろえ、分類の番号がない本には日本十進分類法の番号を入れるため、その ISBN を国立国会図書館サーチに送る。送るのは一件ずつで、間をあける。混み合っていると断られたときは、待ってから三回まで問い直す。照会を終えられなかった本は、Obsidian の起動時と、開いている間の1時間ごとに問い合わせ直す。コマンド「本の表記をそろえる」は、国立国会図書館サーチで確かめると選んだときだけ、登録済みの本の ISBN を送る。バッジのための照合では何も送らない。拡張自体は他のサービスに要求を送らない。

本のノートには、商品ページから取った表紙画像のアドレスか、自分で入力したアドレスを残す。`本の一覧.base` の「表紙」の表示を開くと、Obsidian がそれぞれのアドレス（多くは書店の画像サーバー）から画像を読み込む。プラグイン自身は表紙を取得しない。

### 問い合わせ

質問や懸念は <https://github.com/YukiIto1999/book-props/issues> の Issue で受け付ける。
