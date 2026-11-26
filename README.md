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
3. In the extension's connection settings, select **接続用フォルダを選ぶ**, choose that folder, and allow the browser to edit it.
4. Open a book on a supported store. The extension shows your ownership status, and its popup records purchases and wishes in your vault.

Use the commands **書籍を登録・編集**, **本棚を開く**, and **本・版を管理** to work with your books in Obsidian.

## Network use, files outside the vault, and privacy

- **National Diet Library Search.** When you look up a book by ISBN or title, the plugin sends what you typed to `https://ndlsearch.ndl.go.jp/api/opensearch` and reads the results.
- **Store product pages.** When you look up a book by a product URL, the plugin downloads that page from the supported store, without its query string.
- **Connection to the browser extension.** The plugin listens only on `127.0.0.1` and accepts the extension on the same computer. Book data travels inside TLS 1.3. Book Props has no server of its own.
- **Files outside the vault.** The connection folder `~/Book Props/<vault name>/` holds the local address, an opaque identifier of the books folder, the current TLS trust anchor, and one-time pairing proofs. It holds no books, keys, or session tokens, and is deleted when you unpair or change the books folder. Moving an edition between books keeps a recovery copy of the moved edition in `%LOCALAPPDATA%\BookProps\edition-moves\` on Windows or `$XDG_DATA_HOME/BookProps/edition-moves/` on Linux (`~/.local/share` when unset).
- **External program.** On Windows, the plugin runs the built-in Windows PowerShell to check that only your account can write to the connection folder.
- **Browser extension.** On supported product pages, the extension reads the title, authors, ISBN, edition label, publisher, publication date, and cover image address, and sends them only to Obsidian on the same computer. See the [privacy policy](PRIVACY.md).

Book Props has no telemetry, ads, accounts, or payments.

## Development

[CONTRIBUTING (Japanese)](CONTRIBUTING.md) covers the development environment, verification, and releases. See the [documentation index (Japanese)](docs/README.md) for requirements and architecture.

## License

Book Props is available under the [MIT License](LICENSE). Licenses of bundled third-party code are in `THIRD-PARTY-NOTICES.txt` attached to each release.
