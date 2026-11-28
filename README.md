[English](README.md) | [日本語](README.ja.md)

# Book Props

Keep your books in Obsidian, one note per book, and see on bookstore pages whether you already own a book or want it. Book Props is an Obsidian plugin with a companion extension for Chrome and other Chromium-based browsers.

## Features

- One Markdown note per book. A revised edition counts as a separate edition; print and digital copies with the same content count as one edition. A wish is recorded per book, separately from the editions you own.
- Register and edit books, browse and filter your shelf, move editions between books, archive and restore records, and import or export JSON, all from Obsidian commands.
- Look up bibliographic data by ISBN or title in the National Diet Library Search, or from a supported product page.
- On supported product pages (Amazon.co.jp, Rakuten Books, VALUE BOOKS, BOOKOFF Online), the extension shows whether you own this edition, own another edition, or want the book. From its popup you can record a purchase or a wish, or open the note in Obsidian.

The interface is in Japanese.

## Requirements

- Obsidian 1.13.0 or later on Windows or Linux desktop.
- Chrome or another Chromium-based browser on the same computer, for the extension. Vivaldi is also tested.
- On mobile you can read the synced notes, but the plugin and the extension do not run.

## Installation

Download `book-props-<version>.zip` from the [latest GitHub Release](https://github.com/YukiIto1999/book-props/releases/latest). It contains both the Obsidian plugin and the browser extension. The [installation guide (Japanese)](docs/installation.md) shows how to install and pair them. Setup does not need certificate registration, a helper executable, or the GitHub CLI.

Each release also attaches `main.js` and `manifest.json` for Obsidian, and `book-props-chrome-<version>.zip` for the Chrome Web Store. They hold the same files as the ZIP.

## Usage

1. In Obsidian, open **Settings → Book Props** and set the books folder of your vault.
2. Under **Chromeとの接続**, select **接続を始める**. The plugin creates a connection folder named after your vault under `Book Props` in your home folder.
3. When you install the extension, it opens its connection settings with a notice of the data it reads and where it sends it. Read it and select **同意して使い始める**. Until you agree, the extension reads no pages and does not connect to Obsidian. You can withdraw with **同意を取り消す** on the same page.
4. In the extension's connection settings, select **接続用フォルダを選ぶ**, choose that folder, and allow the browser to edit it.
5. Open a book on a supported store. The extension shows your ownership status, and its popup records purchases and wishes in your vault.
6. If the extension says that the folder permission has expired, which can happen after you close its settings or restart the browser, select **今後も自動で接続する** in its settings and allow access again. Choosing the option to allow on every visit keeps it connected from then on.

Use the commands **書籍を登録・編集**, **本棚を開く**, and **本・版を管理** to work with your books in Obsidian. New book notes are named after the title with an eight-character code of the book ID, such as `リーダブルコード (7b91b5a8).md`. Books with the same title get different names in the same folder. Even when two devices register books with the same title before syncing, the names practically never match: both books would also need the same eight-character code, a chance of about one in four billion. You may rename notes freely. Notes created by 0.7.0 or earlier are named after the book ID, and notes whose title you normalised with **本の表記をそろえる** keep a name built from the older title; the command **ファイル名を書名に合わせる** lists each such note with its current and new name and renames the ones you choose. Links to them are updated only when **Automatically update internal links** is on under **Settings → Files and links**, so turn it on before running the command if other notes link to your book notes.

To record how far you have read a book (未読 unread, 読書中 reading, 再読中 rereading, 読了 finished, 参照用 reference), open its note and use the command **読書状態を変える**, or pick a status in the row of the book in **本棚を開く**. Both can also set it back to 未設定 (unset). A status picked in a shelf row is saved at once, and the focus moves to the next book's status. To set many books at once, set the shelf's reading-status filter to 未設定, tick the books or select **表示中の本をすべて選ぶ**, then choose a status under **選んだ本の読書状態** and select **選んだ本に付ける**. The shelf never changes the finish date (読了日). When **読書状態を変える** switches a book to 読了 and its finish date is empty, it fills in today's date, which you can change or clear before saving; a finish date already in the note changes only when you edit it. A finished book without a finish date shows **読了日を入れる** in its shelf row.

The command **本の一覧を作る** creates `本の一覧.base` at the root of your vault and opens it. This Obsidian Bases file lists the books in your books folder in the views 表紙 (covers), すべての本 (all books), 出版社別 (by publisher), 著者別 (by author), 欲しい本 (wanted), and 読書状態別 (by reading status). If a file with that name already exists, the command opens it without changing it; to create it again, for example after changing the books folder, delete the file first. Grouping by a list would put each combination of authors or publishers in its own group, so the author view groups by the first author and the publisher view by the edition publishers joined with 「・」. To see the books that share an author with the book you are reading, embed `![[本の一覧.base#同じ著者の本]]` in its note, or move `本の一覧.base` to the right sidebar and choose the view 同じ著者の本.

## Network use, files outside the vault, and privacy

- **National Diet Library Search.** When you look up a book by ISBN or title, the plugin sends what you typed to `https://ndlsearch.ndl.go.jp/api/opensearch` and reads the results.
- **National Diet Library Search, after a registration from the extension.** When the extension records a purchase, an owned book, or a wish for a book with an ISBN, the plugin saves the note first and then sends that ISBN to the same address to align the title, authors, publisher, and series with the library's record. Requests go one at a time with a pause between them. When the service answers that it is busy, the plugin waits and asks again, up to three more times; if it still cannot get an answer, it tries again later. It never does this for the ownership check that shows the badge. The command “本の表記をそろえる” sends the ISBNs of your books only when you tick its National Diet Library option.
- **Store product pages.** When you look up a book by a product URL, the plugin downloads that page from the supported store, without its query string.
- **Connection to the browser extension.** The plugin listens only on `127.0.0.1` and accepts the extension on the same computer. Book data travels inside TLS 1.3. Book Props has no server of its own.
- **Files outside the vault.** The connection folder `~/Book Props/<vault name>/` holds the local address, an opaque identifier of the books folder, the current TLS trust anchor, and one-time pairing proofs. It holds no books, keys, or session tokens, and is deleted when you unpair or change the books folder. Moving an edition between books keeps a recovery copy of the moved edition in `%LOCALAPPDATA%\BookProps\edition-moves\` on Windows or `$XDG_DATA_HOME/BookProps/edition-moves/` on Linux (`~/.local/share` when unset).
- **External program.** On Windows, the plugin runs the built-in Windows PowerShell to check that only your account can write to the connection folder.
- **Browser extension.** After you agree in its settings, the extension reads the page address and the book's title, authors, ISBN, edition label, publisher, publication date, and cover image address on supported product pages. The page address stays inside the extension; the book details go only to Obsidian on the same computer. See the [privacy policy](PRIVACY.md).

Book Props has no telemetry, ads, accounts, or payments.

## Development

[CONTRIBUTING (Japanese)](CONTRIBUTING.md) covers the development environment, verification, and releases. See the [documentation index (Japanese)](docs/README.md) for requirements and architecture.

## License

Book Props is available under the [MIT License](LICENSE). Licenses of bundled third-party code are in `THIRD-PARTY-NOTICES.txt` attached to each release.

The names of the Nippon Decimal Classification (NDC) classes and sections that the plugin writes next to a book's classification number come from the [NDC9 data of the Japan Library Association Classification Committee](https://www.jla.or.jp/committees/bunrui/ndc-data/) (日本図書館協会分類委員会「NDCデータ」ndc9), licensed under [CC BY](https://creativecommons.jp/licenses/). Book Props extracts only the names; the changes are described in [`core/vault/data/ndc9/NOTICE.txt`](core/vault/data/ndc9/NOTICE.txt).
