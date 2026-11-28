//! Identity evidence: ISBNs, normalized titles and authors, and edition labels.

use unicode_normalization::UnicodeNormalization;

use crate::bibliography::{author_keys, tidy, tidy_title};

/// A label or other short text compared without width, case, or spacing differences.
pub(crate) fn normalized(text: &str) -> String {
    let mut result = String::with_capacity(text.len());
    let mut space = false;
    for character in tidy(text).nfkc().flat_map(char::to_lowercase) {
        if character.is_whitespace() {
            space = true;
            continue;
        }
        if space && !result.is_empty() {
            result.push(' ');
        }
        result.push(character);
        space = false;
    }
    result
}

/// The words of a title that only name an edition, as the requirements count editions of one book.
const EDITION_WORDS: [&str; 9] = [
    "初版",
    "新版",
    "改訂版",
    "改訂新版",
    "増補版",
    "増補改訂版",
    "改訂増補版",
    "新装版",
    "新装改訂版",
];

const BRACKETS: [(char, char); 4] = [('(', ')'), ('[', ']'), ('【', '】'), ('〔', '〕')];

/// The edition a word of a stored-spelling title names, without the brackets around it: `第3版`,
/// `改訂2版`, `[改訂新版]`. Any other word, a volume such as `(上)` included, names none.
fn edition_word(word: &str) -> Option<&str> {
    let inner = BRACKETS
        .iter()
        .find_map(|(open, close)| word.strip_prefix(*open)?.strip_suffix(*close))
        .unwrap_or(word);
    let revised = inner.strip_prefix("改訂").unwrap_or(inner);
    let numbered = revised
        .strip_prefix('第')
        .unwrap_or(revised)
        .strip_suffix('版')
        .is_some_and(|number| {
            !number.is_empty()
                && number
                    .chars()
                    .all(|digit| digit.is_ascii_digit() || "一二三四五六七八九十".contains(digit))
        });
    (numbered || EDITION_WORDS.contains(&inner)).then_some(inner)
}

/// Where an edition word bracketed at the end of a longer word starts, and the edition it names.
fn attached_edition(word: &str) -> Option<(usize, &str)> {
    BRACKETS.iter().find_map(|(open, _)| {
        let start = word.rfind(*open).filter(|start| *start > 0)?;
        edition_word(&word[start..]).map(|edition| (start, edition))
    })
}

/// A title in the stored spelling split into the text that names its book and the first edition
/// it names: spaces and subtitle separators, a hyphen after a space among them, are left out, and
/// so is each edition word, whether it stands alone or is bracketed at the end of a word.
fn split_edition(tidied: &str) -> (String, Option<&str>) {
    let mut text = String::with_capacity(tidied.len());
    let mut edition = None;
    for (index, word) in tidied.split(' ').enumerate() {
        let word = if index == 0 {
            word
        } else {
            word.trim_start_matches([':', '-'])
        };
        let (kept, named) = match edition_word(word) {
            Some(named) => ("", Some(named)),
            None => attached_edition(word)
                .map_or((word, None), |(start, named)| (&word[..start], Some(named))),
        };
        text.push_str(kept);
        edition = edition.or(named);
    }
    (text, edition)
}

/// The key a title names its book by: the title in the stored spelling without width, case, or
/// spaces, without subtitle separators or dashes, and without the words that only name an edition.
/// Stores and the National Diet Library space and split one title differently, and some write the
/// edition into it; every other word, such as a volume `(上)` or a sister book's `[発展編]`, still
/// tells books apart.
pub(crate) fn title_key(text: &str) -> String {
    split_edition(&tidy_title(text))
        .0
        .nfkc()
        .flat_map(char::to_lowercase)
        .filter(|character| {
            !matches!(character, '—' | '―' | '─' | '━') && !character.is_whitespace()
        })
        .collect()
}

/// The edition a title in the stored spelling names with a word of its own, such as the `第3版` a
/// store writes into the title.
pub(crate) fn title_edition(tidied: &str) -> Option<String> {
    split_edition(tidied).1.map(str::to_owned)
}

/// Whether two author lists name the same people, whatever the order, the spelling of each name,
/// or the roles written with them.
pub(crate) fn same_authors(stored: &[String], source: &[String]) -> bool {
    author_keys(stored) == author_keys(source)
}

/// Canonical ISBN-13s of the inputs without duplicates, or the first input that is not an ISBN.
pub(crate) fn canonical_isbns(values: &[String]) -> Result<Vec<String>, &str> {
    let mut isbns = Vec::with_capacity(values.len());
    for source in values {
        let isbn = isbn13(source).ok_or(source.as_str())?;
        if !isbns.contains(&isbn) {
            isbns.push(isbn);
        }
    }
    Ok(isbns)
}

/// The ISBNs are already canonical ISBN-13s without duplicates, as a stored edition holds them.
pub(crate) fn canonical(values: &[String]) -> bool {
    canonical_isbns(values).is_ok_and(|isbns| isbns == values)
}

/// ISBN symbols with hyphens and whitespace removed, upper-cased; `None` if not an ISBN shape.
fn isbn_symbols(text: &str) -> Option<([u8; 13], usize)> {
    let mut bytes = [0; 13];
    let mut size = 0;
    for symbol in text.chars().filter(|c| *c != '-' && !c.is_whitespace()) {
        if size == bytes.len() || !(symbol.is_ascii_digit() || matches!(symbol, 'X' | 'x')) {
            return None;
        }
        bytes[size] = symbol.to_ascii_uppercase() as u8;
        size += 1;
    }
    Some((bytes, size))
}

/// Checks an ISBN-10 and rewrites it in place as the first 12 digits of its ISBN-13.
fn widen_isbn10(bytes: &mut [u8; 13]) -> Option<()> {
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
    Some(())
}

fn isbn13_check(digits: &[u8]) -> u8 {
    let sum = digits
        .iter()
        .zip([1u32, 3].into_iter().cycle())
        .map(|(digit, weight)| u32::from(digit - b'0') * weight)
        .sum::<u32>();
    b'0' + ((10 - sum % 10) % 10) as u8
}

pub(crate) fn isbn13(text: &str) -> Option<String> {
    let (mut bytes, size) = isbn_symbols(text)?;
    if size == 10 {
        widen_isbn10(&mut bytes)?;
    } else if size != 13
        || !bytes.iter().all(u8::is_ascii_digit)
        || !matches!(&bytes[..3], b"978" | b"979")
    {
        return None;
    }
    let check = isbn13_check(&bytes[..12]);
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

pub(crate) fn same_label(left: &str, right: &str) -> bool {
    left == right || edition_number(left).is_some_and(|n| edition_number(right) == Some(n))
}

pub(crate) fn distinct_editions(left: &str, right: &str) -> bool {
    let first = edition_number(left);
    let second = edition_number(right);
    let revised = |label| matches!(label, "改訂新版" | "改訂版" | "増補改訂版" | "増補版");
    matches!((first, second), (Some(a), Some(b)) if a != b)
        || first == Some(1) && revised(right)
        || second == Some(1) && revised(left)
}
