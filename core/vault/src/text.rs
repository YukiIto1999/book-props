//! Text rules the runtime's screens rely on, spelled the way JavaScript reads text: its whitespace,
//! its string order, and the calendar dates a person writes.

use std::cmp::Ordering;

use unicode_normalization::UnicodeNormalization;

/// Whitespace as JavaScript's `\s` and `trim` know it.
pub(crate) const fn is_space(character: char) -> bool {
    matches!(
        character,
        '\t' | '\n' | '\u{b}' | '\u{c}' | '\r' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200a}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202f}'
                | '\u{205f}'
                | '\u{3000}'
                | '\u{feff}'
    )
}

pub(crate) fn trim(text: &str) -> &str {
    text.trim_matches(is_space)
}

/// The text compatibility-normalized, lower-cased, and without whitespace, so that width, case,
/// and spacing do not tell two values apart.
pub(crate) fn fold(text: &str) -> String {
    let normalized: String = text.nfkc().collect();
    normalized
        .to_lowercase()
        .chars()
        .filter(|character| !is_space(*character))
        .collect()
}

/// Orders two texts by their UTF-16 code units, as JavaScript compares strings.
pub(crate) fn code_unit_order(left: &str, right: &str) -> Ordering {
    left.encode_utf16().cmp(right.encode_utf16())
}

/// Splits up to `most` leading ASCII digits off `text`, if there are at least `least`.
fn digits(text: &str, least: usize, most: usize) -> Option<(&str, &str)> {
    let count = text
        .bytes()
        .take(most)
        .take_while(u8::is_ascii_digit)
        .count();
    (count >= least).then(|| text.split_at(count))
}

fn separated(text: &str) -> Option<&str> {
    text.strip_prefix(['-', '/', '.'])
}

const fn days_in(year: u32, month: u32) -> u32 {
    match month {
        2 if year.is_multiple_of(4) && (!year.is_multiple_of(100) || year.is_multiple_of(400)) => {
            29
        }
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    }
}

/// A real calendar date written as a four-digit year, month, and day separated by `-`, `/`, or
/// `.`, as `YYYY-MM-DD`.
#[must_use]
pub fn calendar_date(value: &str) -> Option<String> {
    let normalized: String = value.nfkc().collect();
    let (year, rest) = digits(trim(&normalized), 4, 4)?;
    let (month, rest) = digits(separated(rest)?, 1, 2)?;
    let (day, rest) = digits(separated(rest)?, 1, 2)?;
    if !rest.is_empty() {
        return None;
    }
    let (year_number, month, day) = (year.parse().ok()?, month.parse().ok()?, day.parse().ok()?);
    ((1..=12).contains(&month) && (1..=days_in(year_number, month)).contains(&day))
        .then(|| format!("{year}-{month:02}-{day:02}"))
}

/// The day a stored date names; a time of day after `T` or a space does not change the day.
pub(crate) fn date_key(value: &str) -> Option<String> {
    let normalized: String = value.nfkc().collect();
    let day = trim(&normalized).split(['T', ' ']).next()?;
    if day.is_empty() {
        return None;
    }
    calendar_date(day)
}
