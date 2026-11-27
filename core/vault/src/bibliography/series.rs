//! Series and labels: kept only as a source states them, and taken off a title only when the title
//! ends with one of them in parentheses.

use unicode_normalization::UnicodeNormalization;

/// A series name compared without width, case, spacing, punctuation, or its trailing number, so
/// `講談社現代新書 2004` and `講談社現代新書 ; 2004` name the same series.
fn series_key(text: &str) -> String {
    let letters: String = text
        .nfkc()
        .flat_map(char::to_lowercase)
        .filter(|character| character.is_alphanumeric())
        .collect();
    letters
        .trim_end_matches(|character: char| character.is_ascii_digit())
        .to_owned()
}

/// The parenthesised part a title ends with, and the title before it.
fn trailing_parenthesis(title: &str) -> Option<(&str, &str)> {
    let inner = title.strip_suffix(')')?;
    let mut depth = 0usize;
    for (at, character) in inner.char_indices().rev() {
        match character {
            ')' => depth += 1,
            '(' if depth == 0 => return Some((inner[..at].trim_end(), &inner[at + 1..])),
            '(' => depth -= 1,
            _ => {}
        }
    }
    None
}

/// The title without a trailing `(series)` when the parenthesis names one of the series a source
/// states, ignoring the series number. Any other parenthesis, such as a volume or a subtitle,
/// stays.
pub(crate) fn without_series<'t>(title: &'t str, series: &[&str]) -> &'t str {
    let Some((before, inside)) = trailing_parenthesis(title) else {
        return title;
    };
    let key = series_key(inside);
    let named = !key.is_empty() && series.iter().any(|name| series_key(name) == key);
    if named && !before.is_empty() {
        before
    } else {
        title
    }
}

#[cfg(test)]
mod tests {
    use super::without_series;

    #[test]
    fn takes_off_a_trailing_series_a_source_states() {
        assert_eq!(
            without_series(
                "はじめての言語ゲーム (講談社現代新書 2004)",
                &["講談社現代新書 ; 2004"]
            ),
            "はじめての言語ゲーム"
        );
        assert_eq!(
            without_series("十戒 (講談社文庫 ゆ 10-4)", &["講談社文庫 ; ゆ10-4"]),
            "十戒"
        );
        assert_eq!(
            without_series(
                "リーダブルコード : より良いコードを書くためのシンプルで実践的なテクニック (Theory in practice)",
                &["THEORY/IN/PRACTICE"]
            ),
            "リーダブルコード : より良いコードを書くためのシンプルで実践的なテクニック"
        );
    }

    #[test]
    fn keeps_a_parenthesis_no_source_states_as_a_series() {
        assert_eq!(
            without_series("坊っちゃん (上)", &["新潮文庫"]),
            "坊っちゃん (上)"
        );
        assert_eq!(
            without_series("はじめての言語ゲーム (講談社現代新書 2004)", &[]),
            "はじめての言語ゲーム (講談社現代新書 2004)"
        );
        assert_eq!(without_series("入門 (第2部)", &["入門"]), "入門 (第2部)");
        assert_eq!(
            without_series("(講談社文庫)", &["講談社文庫"]),
            "(講談社文庫)"
        );
    }
}
