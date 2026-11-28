//! The Nippon Decimal Classification (NDC) of a book: the number a National Diet Library record
//! states, and the names shown for it, taken from the Japan Library Association's NDC9 data.
//!
//! The library classifies newer books by NDC10, whose names are not open data, and older records
//! state only NDC8 or earlier numbers. The three-digit sections of these editions are mostly those
//! of NDC9, so a number of any edition is named by the NDC9 section of its first three digits.

use unicode_normalization::UnicodeNormalization;

/// The NDC9 names, one `notation<TAB>name` row each: the ten main classes (`0`), the hundred
/// divisions (`00`), the three-digit sections (`007`) with the name in context, and the
/// four-digit classes (`007.6`) with the name in context. A four-digit name starting with `--`
/// follows its section's name.
const NAMES: &str = include_str!("../../data/ndc9/labels.tsv");

fn name(notation: &str) -> Option<&'static str> {
    NAMES
        .lines()
        .find_map(|row| row.strip_prefix(notation)?.strip_prefix('\t'))
}

/// An NDC number in its usual form, three digits and an optional decimal part, or `None` when the
/// text is no NDC number. Full-width digits read as digits, and the leading zeros a decimal number
/// loses (`7.64` for `007.64`, as YAML reads an unquoted value) come back.
pub(crate) fn ndc_number(text: &str) -> Option<String> {
    let text: String = text.trim().nfkc().collect();
    let (whole, fraction) = match text.split_once('.') {
        Some((whole, fraction)) => (whole, Some(fraction)),
        None => (text.as_str(), None),
    };
    let digits = |part: &str| !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_digit());
    if !digits(whole) || whole.len() > 3 || !fraction.is_none_or(digits) {
        return None;
    }
    Some(match fraction {
        Some(fraction) => format!("{whole:0>3}.{fraction}"),
        None => format!("{whole:0>3}"),
    })
}

/// The section an NDC number falls in, as its three digits and name, such as `007 情報科学`, or
/// `None` when the text is no NDC number. A section NDC9 leaves vacant takes its division's name.
#[must_use]
pub fn ndc_section(text: &str) -> Option<String> {
    let number = ndc_number(text)?;
    let section = &number[..3];
    Some(match name(section).or_else(|| name(&section[..2])) {
        Some(name) => format!("{section} {name}"),
        None => section.to_owned(),
    })
}

/// The four-digit class an NDC number falls in, as its four digits and name in context, such as
/// `007.6 情報科学--データ処理．情報処理`, or `None` when the text is no NDC number. A number of
/// three digits, or one whose four-digit class NDC9 does not name, takes its section, so books
/// still group by the finest class NDC9 names.
#[must_use]
pub fn ndc_subsection(text: &str) -> Option<String> {
    let number = ndc_number(text)?;
    let named = number.get(..5).and_then(|class| {
        let own = name(class)?;
        Some(match own.strip_prefix("--") {
            Some(own) => format!("{class} {}--{own}", name(&class[..3])?),
            None => format!("{class} {own}"),
        })
    });
    named.or_else(|| ndc_section(&number))
}

/// The ten main classes in order, as digit and name, such as `0 総記`.
#[must_use]
pub fn ndc_classes() -> Vec<String> {
    ('0'..='9')
        .map(|digit| {
            let digit = digit.to_string();
            match name(&digit) {
                Some(name) => format!("{digit} {name}"),
                None => digit,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{ndc_classes, ndc_number, ndc_section, ndc_subsection};

    #[test]
    fn reads_an_ndc_number_in_its_usual_form() {
        assert_eq!(ndc_number("007.64").as_deref(), Some("007.64"));
        assert_eq!(ndc_number(" 798 ").as_deref(), Some("798"));
        assert_eq!(ndc_number("7.64").as_deref(), Some("007.64"));
        assert_eq!(ndc_number("９１３．６").as_deref(), Some("913.6"));
        assert_eq!(ndc_number(""), None);
        assert_eq!(ndc_number("913."), None);
        assert_eq!(ndc_number("1234"), None);
        assert_eq!(ndc_number("K913"), None);
        assert_eq!(ndc_number("913.6.1"), None);
    }

    #[test]
    fn names_the_section_a_number_falls_in() {
        assert_eq!(ndc_section("007.64").as_deref(), Some("007 情報科学"));
        assert_eq!(
            ndc_section("913.6").as_deref(),
            Some("913 日本文学--小説．物語")
        );
        assert_eq!(ndc_section("798").as_deref(), Some("798 室内娯楽"));
        assert_eq!(
            ndc_section("161.1").as_deref(),
            Some("161 宗教学．宗教思想")
        );
        assert_eq!(
            ndc_section("331.19").as_deref(),
            Some("331 経済学．経済思想")
        );
        assert_eq!(ndc_section("not a number"), None);
    }

    #[test]
    fn names_a_vacant_section_after_its_division() {
        assert_eq!(ndc_section("009").as_deref(), Some("009 総記"));
    }

    #[test]
    fn names_the_four_digit_class_a_number_falls_in() {
        let named = ndc_subsection;
        assert_eq!(
            named("007.64").as_deref(),
            Some("007.6 情報科学--データ処理．情報処理")
        );
        assert_eq!(
            named("913.6").as_deref(),
            Some("913.6 日本文学--小説．物語--近代：明治以後")
        );
        assert_eq!(
            named("933.7").as_deref(),
            Some("933.7 英米文学--小説．物語--20世紀―")
        );
        assert_eq!(
            named("798.5").as_deref(),
            Some("798.5 室内娯楽--テレビゲーム")
        );
        assert_eq!(
            named("302.1").as_deref(),
            Some("302.1 政治・経済・社会・文化事情--日本")
        );
        assert_eq!(named("not a number"), None);
    }

    #[test]
    fn takes_the_section_without_a_named_four_digit_class() {
        // Three digits only, NDC10's new 798.4 (RPG), and 801.04 under no NDC9 class 801.0.
        assert_eq!(ndc_subsection("798").as_deref(), Some("798 室内娯楽"));
        assert_eq!(ndc_subsection("798.4").as_deref(), Some("798 室内娯楽"));
        assert_eq!(ndc_subsection("801.04").as_deref(), Some("801 言語学"));
        // 010.6 is named in the data only after an index term, so it names no class.
        assert_eq!(
            ndc_subsection("010.6").as_deref(),
            ndc_section("010").as_deref()
        );
    }

    #[test]
    fn lists_the_ten_main_classes_in_order() {
        let classes = ndc_classes();
        assert_eq!(classes.len(), 10);
        assert_eq!(classes[0], "0 総記");
        assert_eq!(classes[9], "9 文学");
    }
}
