use serde::{Deserialize, Serialize};
use std::borrow::Cow;
use unicode_normalization::UnicodeNormalization;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
enum Action {
    Inspect,
    Purchase,
    RecordOwnership,
    SetWish,
    ClearWish,
    CancelOwnership,
}

#[derive(Deserialize)]
struct Input<'a> {
    action: Action,
    #[serde(borrow)]
    product: Product<'a>,
    #[serde(borrow)]
    books: Vec<Book<'a>>,
    #[serde(borrow)]
    selection: Option<Selection<'a>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Selection<'a> {
    book_id: &'a str,
    edition_id: Option<&'a str>,
}

#[derive(Deserialize)]
struct Product<'a> {
    #[serde(borrow, default)]
    title: Cow<'a, str>,
    #[serde(default)]
    authors: Vec<String>,
    #[serde(default)]
    isbns: Vec<String>,
    #[serde(borrow)]
    label: Option<Cow<'a, str>>,
    #[serde(borrow, default)]
    details: Details<'a>,
}

#[derive(Deserialize)]
struct Book<'a> {
    id: &'a str,
    #[serde(borrow)]
    title: Cow<'a, str>,
    authors: Vec<String>,
    wanted: bool,
    #[serde(default, rename = "archivedAt")]
    archived_at: Option<&'a str>,
    #[serde(borrow)]
    editions: Vec<Edition<'a>>,
}

#[derive(Deserialize)]
struct Edition<'a> {
    id: &'a str,
    #[serde(borrow)]
    label: Option<Cow<'a, str>>,
    owned: bool,
    isbns: Vec<String>,
    #[serde(default, rename = "archivedAt")]
    archived_at: Option<&'a str>,
    #[serde(borrow, default)]
    details: Details<'a>,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Details<'a> {
    #[serde(borrow)]
    publisher: Option<Cow<'a, str>>,
    #[serde(borrow)]
    published_on: Option<Cow<'a, str>>,
    #[serde(borrow)]
    cover: Option<Cow<'a, str>>,
    #[serde(borrow)]
    purchased_on: Option<Cow<'a, str>>,
    #[serde(borrow)]
    purchased_from: Option<Cow<'a, str>>,
}

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct EditionPatch<'a> {
    #[serde(skip_serializing_if = "Vec::is_empty")]
    isbns: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    label: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    publisher: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    published_on: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    cover: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    purchased_on: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    purchased_from: Option<&'a str>,
}

fn fill<'a>(old: Option<&str>, source: Option<&'a str>) -> Option<&'a str> {
    old.filter(|value| !value.trim().is_empty())
        .is_none()
        .then_some(source)
        .flatten()
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn edition_patch<'a>(
    old: &Edition<'_>,
    source: &'a Product<'a>,
    isbns: &[String],
) -> Option<EditionPatch<'a>> {
    let patch = EditionPatch {
        isbns: isbns
            .iter()
            .filter(|isbn| !old.isbns.contains(isbn))
            .cloned()
            .collect(),
        label: fill(old.label.as_deref(), source.label.as_deref()),
        publisher: fill(
            old.details.publisher.as_deref(),
            source.details.publisher.as_deref(),
        ),
        published_on: fill(
            old.details.published_on.as_deref(),
            source.details.published_on.as_deref(),
        ),
        cover: fill(
            old.details.cover.as_deref(),
            source.details.cover.as_deref(),
        ),
        purchased_on: fill(
            old.details.purchased_on.as_deref(),
            source.details.purchased_on.as_deref(),
        ),
        purchased_from: fill(
            old.details.purchased_from.as_deref(),
            source.details.purchased_from.as_deref(),
        ),
    };
    (!patch.isbns.is_empty()
        || [
            patch.label,
            patch.publisher,
            patch.published_on,
            patch.cover,
            patch.purchased_on,
            patch.purchased_from,
        ]
        .into_iter()
        .any(|item| item.is_some()))
    .then_some(patch)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
enum Ownership {
    SameEdition,
    OtherEdition,
    UnknownEdition,
    Unowned,
    Undetermined,
}

#[derive(Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
enum Decision<'a> {
    None,
    InvalidIsbn {
        input: &'a str,
    },
    InsufficientEvidence,
    ConflictingEvidence,
    ChooseBook {
        book_ids: Vec<&'a str>,
    },
    ChooseEdition {
        edition_ids: Vec<&'a str>,
    },
    CreateBook {
        wanted: bool,
        record_edition: bool,
    },
    AddEdition {
        wanted_before: bool,
        wanted_after: bool,
    },
    Update {
        wanted_before: bool,
        wanted_after: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        owned_before: Option<bool>,
        #[serde(skip_serializing_if = "Option::is_none")]
        owned_after: Option<bool>,
        #[serde(skip_serializing_if = "Option::is_none")]
        edition_patch: Option<EditionPatch<'a>>,
    },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Outcome<'a> {
    ownership: Ownership,
    wanted: bool,
    book_id: Option<&'a str>,
    edition_id: Option<&'a str>,
    decision: Decision<'a>,
    isbns: Vec<String>,
}

impl<'a> Outcome<'a> {
    fn undetermined(decision: Decision<'a>) -> Self {
        Self {
            ownership: Ownership::Undetermined,
            wanted: false,
            book_id: None,
            edition_id: None,
            decision,
            isbns: Vec::new(),
        }
    }
}

fn normalized(text: &str) -> String {
    normalize(text, false)
}

fn normalized_title(text: &str) -> String {
    normalize(text, true)
}

fn normalize(text: &str, title: bool) -> String {
    let mut result = String::with_capacity(text.len());
    let mut space = false;
    for character in text.nfkc().flat_map(char::to_lowercase) {
        if character.is_whitespace() {
            space = true;
            continue;
        }
        if title
            && (matches!(character, '—' | '―')
                || space && !result.is_empty() && matches!(character, '-' | ':'))
        {
            result.push('—');
        } else {
            if space && !result.is_empty() && !(title && result.ends_with('—')) {
                result.push(' ');
            }
            result.push(character);
        }
        space = false;
    }
    result
}

fn normalized_author(text: &str) -> String {
    let mut value = normalized(text);
    if value
        .chars()
        .all(|c| matches!(c, ' ' | '々' | '\u{3040}'..='\u{30ff}' | '\u{3400}'..='\u{9fff}'))
    {
        value.retain(|c| c != ' ');
    }
    value
}

fn same_authors(stored: &[String], source: &[String]) -> bool {
    if stored.len() != source.len() {
        return false;
    }
    let mut left: Vec<_> = stored.iter().map(|s| normalized_author(s)).collect();
    let mut right: Vec<_> = source.iter().map(|s| normalized_author(s)).collect();
    left.sort_unstable();
    right.sort_unstable();
    left == right
}

fn isbn13(text: &str) -> Option<String> {
    let mut bytes = [0; 13];
    let mut size = 0;
    for symbol in text.chars().filter(|c| *c != '-' && !c.is_whitespace()) {
        if size == bytes.len() || !(symbol.is_ascii_digit() || matches!(symbol, 'X' | 'x')) {
            return None;
        }
        bytes[size] = symbol.to_ascii_uppercase() as u8;
        size += 1;
    }
    if size == 10 {
        let (digits, check) = bytes[..10].split_at(9);
        if !digits.iter().all(u8::is_ascii_digit) {
            return None;
        }
        let last = if check[0] == b'X' {
            10
        } else {
            u32::from(check[0] - b'0')
        };
        let sum = digits
            .iter()
            .zip((2..=10).rev())
            .map(|(digit, weight)| u32::from(digit - b'0') * weight)
            .sum::<u32>();
        if (sum + last) % 11 != 0 {
            return None;
        }
        bytes.copy_within(0..9, 3);
        bytes[..3].copy_from_slice(b"978");
        bytes[12] = b'0';
    } else if size != 13
        || !bytes.iter().all(u8::is_ascii_digit)
        || !matches!(&bytes[..3], b"978" | b"979")
    {
        return None;
    }
    let sum = bytes[..12]
        .iter()
        .zip([1u32, 3].into_iter().cycle())
        .map(|(digit, weight)| u32::from(digit - b'0') * weight)
        .sum::<u32>();
    let check = b'0' + ((10 - sum % 10) % 10) as u8;
    if size == 13 && bytes[12] != check {
        return None;
    }
    bytes[12] = check;
    String::from_utf8(bytes.to_vec()).ok()
}

fn edition_number(label: &str) -> Option<u32> {
    if matches!(label, "初版" | "first edition") {
        return Some(1);
    }
    label
        .strip_prefix('第')?
        .strip_suffix('版')?
        .trim()
        .parse()
        .ok()
        .filter(|n| *n > 0)
}

fn same_label(left: &str, right: &str) -> bool {
    left == right || edition_number(left).is_some_and(|n| edition_number(right) == Some(n))
}

fn distinct_editions(left: &str, right: &str) -> bool {
    let first = edition_number(left);
    let second = edition_number(right);
    let revised = |label| matches!(label, "改訂新版" | "改訂版" | "増補改訂版" | "増補版");
    matches!((first, second), (Some(a), Some(b)) if a != b)
        || first == Some(1) && revised(right)
        || second == Some(1) && revised(left)
}

fn new_revision(editions: &[&Edition<'_>], label: Option<&str>) -> bool {
    editions.is_empty()
        || label.is_some_and(|candidate| {
            editions.iter().all(|edition| {
                edition
                    .label
                    .as_deref()
                    .is_some_and(|label| distinct_editions(candidate, &normalized(label)))
            })
        })
}

fn decision<'a>(
    input: &'a Input<'a>,
    book: &Book<'a>,
    edition: Option<&Edition<'a>>,
    editions: &[&Edition<'a>],
    label: Option<&str>,
    isbns: &[String],
) -> Decision<'a> {
    let action = &input.action;
    let after = match action {
        Action::Inspect => return Decision::None,
        Action::Purchase | Action::ClearWish => false,
        Action::SetWish => true,
        Action::RecordOwnership | Action::CancelOwnership => book.wanted,
    };
    if matches!(action, Action::SetWish | Action::ClearWish) {
        return Decision::Update {
            wanted_before: book.wanted,
            wanted_after: after,
            owned_before: None,
            owned_after: None,
            edition_patch: None,
        };
    }
    if let Some(edition) = edition {
        return Decision::Update {
            wanted_before: book.wanted,
            wanted_after: after,
            owned_before: Some(edition.owned),
            owned_after: Some(!matches!(action, Action::CancelOwnership)),
            edition_patch: if matches!(action, Action::Purchase | Action::RecordOwnership) {
                edition_patch(edition, &input.product, isbns)
            } else {
                None
            },
        };
    }
    if !matches!(action, Action::CancelOwnership) && new_revision(editions, label) {
        return Decision::AddEdition {
            wanted_before: book.wanted,
            wanted_after: after,
        };
    }
    Decision::ChooseEdition {
        edition_ids: editions.iter().map(|edition| edition.id).collect(),
    }
}

fn locate_book<'a>(
    books: &'a [Book<'a>],
    product: &Product<'a>,
    isbns: &[String],
    selection: Option<&Selection<'a>>,
    inspect_only: bool,
) -> Result<Option<&'a Book<'a>>, Decision<'a>> {
    let title = normalized_title(&product.title);
    let named = !title.is_empty()
        && product
            .authors
            .iter()
            .any(|author| !normalized(author).is_empty());
    if selection.is_none() && !named && isbns.is_empty() {
        return Err(Decision::InsufficientEvidence);
    }
    let visible_books = || {
        books
            .iter()
            .filter(|book| !inspect_only || book.archived_at.is_none())
    };
    let mut exact = visible_books().filter(|book| {
        book.editions
            .iter()
            .any(|edition| edition.isbns.iter().any(|isbn| isbns.contains(isbn)))
    });
    if let Some(selection) = selection {
        if exact.any(|book| book.id != selection.book_id) {
            return Err(Decision::ConflictingEvidence);
        }
        if selection.book_id == "new" {
            return Ok(None);
        }
        return visible_books()
            .find(|book| book.id == selection.book_id)
            .map(Some)
            .ok_or(Decision::ConflictingEvidence);
    }
    let named_books = || {
        visible_books().filter(|book| {
            named
                && normalized_title(&book.title) == title
                && same_authors(&book.authors, &product.authors)
        })
    };
    if let Some(book) = exact.next() {
        let mut names = named_books();
        let different_book = names
            .next()
            .is_some_and(|first| first.id != book.id && !names.any(|other| other.id == book.id));
        if exact.next().is_some() || different_book {
            return Err(Decision::ConflictingEvidence);
        }
        return Ok(Some(book));
    }
    let mut matches = named_books();
    let first = matches.next();
    if let Some(first) = first
        && let Some(second) = matches.next()
    {
        let book_ids = [first.id, second.id]
            .into_iter()
            .chain(matches.map(|book| book.id))
            .collect();
        return Err(Decision::ChooseBook { book_ids });
    }
    Ok(first)
}

fn inspect<'a>(input: &'a Input<'a>) -> Outcome<'a> {
    let product = &input.product;
    let mut isbns = Vec::with_capacity(product.isbns.len());
    for source in &product.isbns {
        let Some(isbn) = isbn13(source) else {
            return Outcome::undetermined(Decision::InvalidIsbn { input: source });
        };
        if !isbns.contains(&isbn) {
            isbns.push(isbn);
        }
    }
    let inspect_only = matches!(input.action, Action::Inspect);
    let book = match locate_book(
        &input.books,
        product,
        &isbns,
        input.selection.as_ref(),
        inspect_only,
    ) {
        Ok(book) => book,
        Err(reason) => return Outcome::undetermined(reason),
    };
    let Some(book) = book else {
        let decision = match input.action {
            Action::Inspect | Action::ClearWish | Action::CancelOwnership => Decision::None,
            _ if product.title.trim().is_empty() => Decision::InsufficientEvidence,
            Action::SetWish => Decision::CreateBook {
                wanted: true,
                record_edition: false,
            },
            Action::Purchase | Action::RecordOwnership => Decision::CreateBook {
                wanted: false,
                record_edition: true,
            },
        };
        return Outcome {
            ownership: Ownership::Unowned,
            isbns,
            ..Outcome::undetermined(decision)
        };
    };
    if book.archived_at.is_some() {
        return Outcome::undetermined(Decision::ConflictingEvidence);
    }
    let label = product
        .label
        .as_deref()
        .map(normalized)
        .filter(|value| !value.is_empty());
    let has_isbn = |edition: &Edition<'_>| edition.isbns.iter().any(|isbn| isbns.contains(isbn));
    let has_label = |edition: &Edition<'_>| {
        label.as_ref().is_some_and(|candidate| {
            edition
                .label
                .as_deref()
                .is_some_and(|stored| same_label(candidate, &normalized(stored)))
        })
    };
    let wish_action = matches!(input.action, Action::SetWish | Action::ClearWish);
    let selected = input
        .selection
        .as_ref()
        .filter(|_| !wish_action)
        .and_then(|selection| selection.edition_id);
    let mut known = book.editions.iter().filter(|edition| {
        (!inspect_only || edition.archived_at.is_none())
            && (has_isbn(edition) || has_label(edition))
    });
    let undetermined = || {
        let plan = if wish_action {
            decision(input, book, None, &[], None, &isbns)
        } else {
            Decision::ConflictingEvidence
        };
        Outcome {
            wanted: book.wanted,
            book_id: Some(book.id),
            ..Outcome::undetermined(plan)
        }
    };
    let edition = match selected {
        Some("new") if known.next().is_none() => None,
        Some("new") => return undetermined(),
        Some(id) => {
            if book.editions.iter().any(|edition| {
                (!inspect_only || edition.archived_at.is_none())
                    && has_isbn(edition)
                    && edition.id != id
            }) {
                return undetermined();
            }
            let Some(edition) = book
                .editions
                .iter()
                .find(|edition| edition.id == id && edition.archived_at.is_none())
            else {
                return undetermined();
            };
            Some(edition)
        }
        None => {
            let first = known.next();
            if known.next().is_some() || first.is_some_and(|edition| edition.archived_at.is_some())
            {
                return undetermined();
            }
            first
        }
    };
    let active: Vec<_> = book
        .editions
        .iter()
        .filter(|edition| edition.archived_at.is_none())
        .collect();
    let other_owned = active.iter().any(|edition| edition.owned);
    let ownership = match (edition, other_owned) {
        (Some(known), _) if known.owned => Ownership::SameEdition,
        (_, false) => Ownership::Unowned,
        (Some(_), true) => Ownership::OtherEdition,
        (None, true) if selected == Some("new") || new_revision(&active, label.as_deref()) => {
            Ownership::OtherEdition
        }
        (None, true) => Ownership::UnknownEdition,
    };
    let decision = if selected == Some("new")
        && matches!(input.action, Action::Purchase | Action::RecordOwnership)
    {
        Decision::AddEdition {
            wanted_before: book.wanted,
            wanted_after: matches!(input.action, Action::RecordOwnership) && book.wanted,
        }
    } else {
        decision(input, book, edition, &active, label.as_deref(), &isbns)
    };
    Outcome {
        ownership,
        wanted: book.wanted,
        book_id: Some(book.id),
        edition_id: edition.map(|edition| edition.id),
        decision,
        isbns,
    }
}

/// Evaluates catalog evidence and decides the state change without performing Vault I/O.
///
/// # Errors
/// Returns a serialization error if the input is not a well-formed catalog request.
#[cfg_attr(target_arch = "wasm32", wasm_bindgen::prelude::wasm_bindgen)]
pub fn evaluate(input: &str) -> Result<String, String> {
    let decoded: Input<'_> = serde_json::from_str(input).map_err(|error| error.to_string())?;
    serde_json::to_string(&inspect(&decoded)).map_err(|error| error.to_string())
}
