//! The one spelling Book Props stores bibliographic text in: one width, one spacing, one long
//! vowel mark, one wave dash, and one subtitle separator.
//!
//! Full NFKC is not applied to stored text: it would also rewrite characters a title means, such
//! as circled numbers or `㈱`. Only the width variants that sites spell differently are folded.

use unicode_normalization::UnicodeNormalization;

use crate::text::is_space;

/// The subtitle separator stored between a title and its subtitle, as the National Diet Library
/// writes it.
pub(crate) const SEPARATOR: &str = " : ";

/// Stands for a full-width colon until the subtitle pass, which always reads it as a separator.
const WIDE_COLON: char = '\u{e000}';

pub(crate) const fn is_katakana(character: char) -> bool {
    matches!(character, '\u{30a1}'..='\u{30fa}' | 'ー')
}

/// Kana, ideographs, and Japanese punctuation: characters only Japanese text uses.
pub(crate) const fn is_japanese(character: char) -> bool {
    matches!(
        character,
        '\u{3000}'..='\u{30ff}' | '\u{3400}'..='\u{4dbf}' | '\u{4e00}'..='\u{9fff}' | '\u{f900}'..='\u{faff}'
    )
}

const fn is_half_width_kana(character: char) -> bool {
    matches!(character, '\u{ff61}'..='\u{ff9f}')
}

/// One character in its stored width, or `None` when the character is dropped.
fn narrow(character: char) -> Option<char> {
    match character {
        '\u{200b}'..='\u{200f}' | '\u{2060}' => None,
        '\u{ff5e}' | '\u{301c}' | '\u{223c}' | '\u{2053}' => Some('〜'),
        '\u{ff01}'..='\u{ff5d}' => char::from_u32(u32::from(character) - 0xfee0),
        character if is_space(character) => Some(' '),
        character => Some(character),
    }
}

/// Folds widths, keeping a run of half-width katakana together so a voiced mark joins its kana.
fn widths(text: &str) -> Vec<char> {
    let mut result = Vec::with_capacity(text.len());
    let mut kana = String::new();
    for character in text.chars() {
        if is_half_width_kana(character) {
            kana.push(character);
            continue;
        }
        if !kana.is_empty() {
            result.extend(kana.nfkc());
            kana.clear();
        }
        result.extend(narrow(character));
    }
    result.extend(kana.nfkc());
    result
}

/// Collapses runs of spaces into one and trims both ends.
fn spaces(characters: &[char]) -> Vec<char> {
    let mut result: Vec<char> = Vec::with_capacity(characters.len());
    for &character in characters {
        if character == ' ' && result.last().is_none_or(|last| *last == ' ') {
            continue;
        }
        result.push(character);
    }
    if result.last() == Some(&' ') {
        result.pop();
    }
    result
}

const fn is_hyphen(character: char) -> bool {
    matches!(
        character,
        '-' | '\u{2010}' | '\u{2011}' | '\u{2212}' | '\u{2013}'
    )
}

/// What may follow a long vowel mark: more katakana, a name separator, a space, the end, or
/// closing punctuation. A digit or a Latin letter after the hyphen means it joins two words.
fn ends_vowel(next: Option<char>) -> bool {
    next.is_none_or(|next| {
        is_katakana(next)
            || matches!(
                next,
                '・' | ' ' | ')' | ']' | '」' | '』' | '】' | ',' | '、' | '。' | '!' | '?'
            )
    })
}

/// A hyphen or minus written after katakana for the long vowel becomes `ー`; a tilde next to
/// Japanese text becomes the wave dash.
fn marks(characters: &mut [char]) {
    for index in 0..characters.len() {
        let previous = index.checked_sub(1).map(|at| characters[at]);
        let next = characters.get(index + 1).copied();
        let character = characters[index];
        if is_hyphen(character) && previous.is_some_and(is_katakana) && ends_vowel(next) {
            characters[index] = 'ー';
        } else if character == '~'
            && (previous.is_some_and(is_japanese) || next.is_some_and(is_japanese))
        {
            characters[index] = '〜';
        }
    }
}

/// Bibliographic text in the stored spelling: full-width ASCII as ASCII, half-width katakana as
/// full-width, spaces collapsed and trimmed, the long vowel as `ー`, and wave dashes as `〜`.
pub(crate) fn tidy(text: &str) -> String {
    let mut characters = spaces(&widths(text));
    marks(&mut characters);
    characters.into_iter().collect()
}

const fn is_dash(character: char) -> bool {
    matches!(character, '―' | '—' | '─' | '━')
}

/// Where a subtitle starts and how long its mark is, or where a closing mark ends the title.
enum Mark {
    Separator(usize),
    Closing,
}

/// Where the title's body ends: before a trailing ` (…)` such as a label, or at the end.
fn body_end(characters: &[char]) -> usize {
    if characters.last() != Some(&')') {
        return characters.len();
    }
    characters
        .iter()
        .rposition(|character| *character == '(')
        .filter(|open| *open > 0 && characters[open - 1] == ' ')
        .map_or(characters.len(), |open| open - 1)
}

/// Reads the subtitle mark at `index`, if any.
fn mark_at(characters: &[char], index: usize, opened: Option<char>) -> Option<Mark> {
    let character = characters[index];
    let end = body_end(characters).max(index + 1);
    let at_end = characters[index + 1..end]
        .iter()
        .all(|next| is_dash(*next) || *next == '〜');
    if opened.is_some_and(|open| open == character || is_dash(open) && is_dash(character)) && at_end
    {
        return Some(Mark::Closing);
    }
    let previous = index.checked_sub(1).map(|at| characters[at]);
    let next = characters.get(index + 1).copied();
    match character {
        WIDE_COLON => Some(Mark::Separator(1)),
        ':' if previous == Some(' ') || next == Some(' ') => Some(Mark::Separator(1)),
        dash if is_dash(dash) && index > 0 && !at_end => {
            let run = characters[index..]
                .iter()
                .take_while(|next| is_dash(**next))
                .count();
            Some(Mark::Separator(run))
        }
        '〜' if previous == Some(' ') && index > 1 && !at_end => Some(Mark::Separator(1)),
        _ => None,
    }
}

/// Whether a wave dash at `index` opens a subtitle that a closing wave dash ends the title's body
/// with.
fn wave_pair(characters: &[char], index: usize) -> bool {
    let end = body_end(characters);
    characters[index] == '〜'
        && index > 0
        && end > index + 2
        && characters[end - 1] == '〜'
        && !characters[index + 1..end - 1].contains(&'〜')
}

/// The title in the stored spelling, with every subtitle separator written as [`SEPARATOR`]:
/// colons (a full-width colon anywhere, an ASCII colon next to a space), dashes such as `―`, and
/// a wave dash that opens a subtitle after a space or pairs with a wave dash ending the title.
/// The closing dash of a subtitle written between two dashes is dropped.
pub(crate) fn tidy_title(text: &str) -> String {
    let marked: String = text
        .chars()
        .map(|character| {
            if character == '：' {
                WIDE_COLON
            } else {
                character
            }
        })
        .collect();
    let characters: Vec<char> = tidy(&marked).chars().collect();
    let mut result = String::with_capacity(characters.len() + 4);
    let mut opened = None;
    let mut index = 0;
    while index < characters.len() {
        let character = characters[index];
        let mark = if wave_pair(&characters, index) && opened.is_none() {
            Some(Mark::Separator(1))
        } else {
            mark_at(&characters, index, opened)
        };
        match mark {
            Some(Mark::Closing) => {}
            Some(Mark::Separator(length)) if !result.trim_end().is_empty() => {
                let kept = result.trim_end().len();
                result.truncate(kept);
                result.push_str(SEPARATOR);
                opened = Some(character);
                index += length;
                while characters.get(index) == Some(&' ') {
                    index += 1;
                }
                continue;
            }
            _ => result.push(if character == WIDE_COLON {
                ':'
            } else {
                character
            }),
        }
        index += 1;
    }
    if result.ends_with(SEPARATOR) {
        result.truncate(result.len() - SEPARATOR.len());
    }
    result
}

#[cfg(test)]
mod tests {
    use super::{tidy, tidy_title};

    #[test]
    fn folds_widths_and_spaces_but_not_other_compatibility_characters() {
        assert_eq!(tidy("　Ｃ言語　入門　"), "C言語 入門");
        assert_eq!(tidy("ｶﾞｲﾄﾞﾌﾞｯｸ"), "ガイドブック");
        assert_eq!(
            tidy("ビジュアル情報処理［改訂新版］"),
            "ビジュアル情報処理[改訂新版]"
        );
        assert_eq!(tidy("㈱ポケモン ①"), "㈱ポケモン ①");
        assert_eq!(tidy("島田　浩二（翻訳）"), "島田 浩二(翻訳)");
    }

    #[test]
    fn writes_the_long_vowel_after_katakana_as_the_long_vowel_mark() {
        assert_eq!(tidy("トレバ-・フォシェ"), "トレバー・フォシェ");
        assert_eq!(tidy("スティ-ブン・バ-ド"), "スティーブン・バード");
        assert_eq!(tidy("エドワ-ド・ロ-パ-"), "エドワード・ローパー");
        assert_eq!(
            tidy("エドワード・ブルック=ヒッチング"),
            "エドワード・ブルック=ヒッチング"
        );
        assert_eq!(tidy("Kenny Baas-Schwegler"), "Kenny Baas-Schwegler");
        assert_eq!(
            tidy("ビジュアル情報処理-CG・画像処理入門-"),
            "ビジュアル情報処理-CG・画像処理入門-"
        );
        assert_eq!(tidy("ポケモン-2024"), "ポケモン-2024");
    }

    #[test]
    fn unifies_wave_dashes() {
        assert_eq!(tidy("1～3巻"), "1〜3巻");
        assert_eq!(tidy("入門∼基礎"), "入門〜基礎");
        assert_eq!(tidy("招待 ~不確実性"), "招待 〜不確実性");
        assert_eq!(tidy("~/.config"), "~/.config");
    }

    #[test]
    fn writes_every_subtitle_separator_the_same_way() {
        assert_eq!(
            tidy_title("1から学ぶ大人の数学教室：円周率から微積分まで"),
            "1から学ぶ大人の数学教室 : 円周率から微積分まで"
        );
        assert_eq!(
            tidy_title("Bluetoothテクノロジーへの招待： 仕様開発者による手引き"),
            "Bluetoothテクノロジーへの招待 : 仕様開発者による手引き"
        );
        assert_eq!(
            tidy_title("Clean Coder : プロフェッショナルプログラマへの道"),
            "Clean Coder : プロフェッショナルプログラマへの道"
        );
        assert_eq!(
            tidy_title("Clean Code: A Handbook"),
            "Clean Code : A Handbook"
        );
        assert_eq!(
            tidy_title("マルコフ連鎖モンテカルロ法入門―例からはじめるＭＣＭＣの基礎"),
            "マルコフ連鎖モンテカルロ法入門 : 例からはじめるMCMCの基礎"
        );
        assert_eq!(
            tidy_title("レトリックと詭弁 ─禁断の議論術講座"),
            "レトリックと詭弁 : 禁断の議論術講座"
        );
        assert_eq!(
            tidy_title("エンジニアリング組織論への招待 ~不確実性に向き合う思考"),
            "エンジニアリング組織論への招待 : 不確実性に向き合う思考"
        );
        assert_eq!(
            tidy_title("システム開発と「具体と抽象」〜問題発見と問題解決を往復する〜"),
            "システム開発と「具体と抽象」 : 問題発見と問題解決を往復する"
        );
        assert_eq!(tidy_title("副題 ―例から学ぶ―"), "副題 : 例から学ぶ");
        assert_eq!(
            tidy_title("フロスト・クラック ~連続狙撃犯人の推理~ (電撃文庫)"),
            "フロスト・クラック : 連続狙撃犯人の推理 (電撃文庫)"
        );
        assert_eq!(
            tidy_title("具体と抽象〜往復する〜 (新書)"),
            "具体と抽象 : 往復する (新書)"
        );
    }

    #[test]
    fn keeps_colons_and_dashes_that_do_not_open_a_subtitle() {
        assert_eq!(
            tidy_title("Re:ゼロから始める異世界生活"),
            "Re:ゼロから始める異世界生活"
        );
        assert_eq!(tidy_title("1〜3巻セット"), "1〜3巻セット");
        assert_eq!(tidy_title("Tidy First？"), "Tidy First?");
        assert_eq!(tidy_title("―はじめに"), "―はじめに");
        assert_eq!(tidy_title("坊っちゃん (上)"), "坊っちゃん (上)");
    }
}
