//! People named on a book: author names in their stored spelling, the role each one played, the
//! National Diet Library's catalogue forms, and the key that compares two spellings of a name.

use unicode_normalization::UnicodeNormalization;

use super::text::{is_japanese, is_katakana, tidy};
use crate::model::Person;

/// Role words as sources write them, and the role Book Props stores. `None` is plain authorship,
/// which is not stored.
const ROLES: &[(&str, Option<&str>)] = &[
    ("著", None),
    ("著者", None),
    ("作者", None),
    ("共著", None),
    ("author", None),
    ("訳", Some("訳")),
    ("翻訳", Some("訳")),
    ("共訳", Some("訳")),
    ("translator", Some("訳")),
    ("監訳", Some("監訳")),
    ("監修", Some("監修")),
    ("編", Some("編")),
    ("編集", Some("編")),
    ("編者", Some("編")),
    ("editor", Some("編")),
    ("編著", Some("編著")),
    ("編訳", Some("編訳")),
    ("責任編集", Some("責任編集")),
    ("原作", Some("原作")),
    ("原著", Some("原著")),
    ("原案", Some("原案")),
    ("作", Some("作")),
    ("文", Some("文")),
    ("絵", Some("絵")),
    ("画", Some("画")),
    ("作画", Some("作画")),
    ("漫画", Some("漫画")),
    ("まんが", Some("漫画")),
    ("イラスト", Some("イラスト")),
    ("illustrator", Some("イラスト")),
    ("写真", Some("写真")),
    ("解説", Some("解説")),
    ("構成", Some("構成")),
];

/// Role words that may follow a name without a space. Shorter words such as `作` or `絵` also end
/// given names, so they count as roles only after a space or inside brackets.
const JOINED_ROLES: &[&str] = &[
    "責任編集",
    "イラスト",
    "翻訳",
    "共訳",
    "監訳",
    "監修",
    "編著",
    "編訳",
    "共著",
    "原作",
    "著",
    "訳",
    "編",
];

/// A word or words joined by `・` or `,` that all name roles, as the stored role; `Some(None)` for
/// plain authorship.
fn role_of(text: &str) -> Option<Option<String>> {
    let words: Vec<&str> = text
        .split(['・', ',', '、', '/'])
        .map(str::trim)
        .map(|word| word.trim_start_matches("ほか").trim_start_matches('他'))
        .filter(|word| !word.is_empty())
        .collect();
    if words.is_empty() {
        return None;
    }
    let mut roles: Vec<&str> = Vec::new();
    for word in words {
        let lower = word.to_lowercase();
        let (_, role) = ROLES.iter().find(|(spelling, _)| *spelling == lower)?;
        if let Some(role) = role
            && !roles.contains(role)
        {
            roles.push(role);
        }
    }
    Some((!roles.is_empty()).then(|| roles.join("・")))
}

fn closing_pair(character: char) -> Option<char> {
    match character {
        ')' => Some('('),
        ']' => Some('['),
        '】' => Some('【'),
        '〕' => Some('〔'),
        _ => None,
    }
}

/// Splits a bracketed role off the end, as in `島田 浩二(翻訳)` or `Kent Beck (Author)`.
fn bracketed(text: &str) -> Option<(&str, Option<String>)> {
    let open = closing_pair(text.chars().last()?)?;
    let start = text.rfind(open)?;
    let close = text.len() - text.chars().last()?.len_utf8();
    let role = role_of(&text[start + open.len_utf8()..close])?;
    let name = text[..start].trim();
    (!name.is_empty()).then_some((name, role))
}

/// Splits a role word written after a space, as in `島田浩二 訳`.
fn spaced(text: &str) -> Option<(&str, Option<String>)> {
    let (name, word) = text.rsplit_once(' ')?;
    let word = word.trim_start_matches('[').trim_end_matches(']');
    if !word.chars().any(is_japanese) {
        return None;
    }
    let role = role_of(word)?;
    let name = name
        .trim()
        .trim_end_matches("ほか")
        .trim_end_matches('他')
        .trim();
    (!name.is_empty()).then_some((name, role))
}

/// Splits a role word written straight after a name, as in `角征典訳` or `Robert C. Martin著`.
fn joined(text: &str) -> Option<(&str, Option<String>)> {
    let text = text.trim_end_matches(']');
    let word = JOINED_ROLES.iter().find(|word| text.ends_with(**word))?;
    let name = text[..text.len() - word.len()].trim_end_matches('[').trim();
    let name = name.trim_end_matches("ほか").trim_end_matches('他').trim();
    if name.chars().count() < 2 {
        return None;
    }
    Some((name, role_of(word)?))
}

/// A name and the role written with it, or the whole text with no role.
fn split_role(text: &str) -> (&str, Option<Option<String>>) {
    bracketed(text)
        .or_else(|| spaced(text))
        .or_else(|| joined(text))
        .map_or((text, None), |(name, role)| (name, Some(role)))
}

const COMPANY: &[&str] = &[
    "inc",
    "inc.",
    "ltd",
    "ltd.",
    "llc",
    "co",
    "co.",
    "corp",
    "corp.",
    "company",
    "corporation",
    "press",
    "books",
];

/// Whether `text` reads as a person's or group's name rather than part of one: Japanese text, or
/// Latin text of at least two words that does not name a company.
fn standalone(text: &str) -> bool {
    if text.chars().any(is_japanese) {
        return true;
    }
    let words: Vec<String> = text.split(' ').map(str::to_lowercase).collect();
    words.len() >= 2 && !words.iter().any(|word| COMPANY.contains(&word.as_str()))
}

/// Splits names written together with `/` or `&` when every part is a name of its own, as in
/// `菊池 たけし/F.E.A.R.` or `元宮秀介&ワンナップ`; `Simon & Schuster` stays one name.
fn combined(text: &str) -> Vec<&str> {
    let parts: Vec<&str> = text.split(['/', '&']).map(str::trim).collect();
    let japanese = parts.iter().any(|part| part.chars().any(is_japanese));
    let names = parts.len() > 1
        && parts.iter().all(|part| !part.is_empty())
        && (japanese || parts.iter().all(|part| standalone(part)));
    if names { parts } else { vec![text] }
}

/// The people a list of author entries names, in order and without repeats: each entry in the
/// stored spelling, combined names split, and a role written with a name kept apart from it.
pub(crate) fn people(entries: &[String]) -> Vec<Person> {
    let mut result: Vec<Person> = Vec::with_capacity(entries.len());
    for entry in entries {
        let tidied = tidy(entry);
        let (whole, shared) = split_role(&tidied);
        for part in combined(whole) {
            let (name, own) = split_role(part);
            let role = own.or_else(|| shared.clone()).flatten();
            add(&mut result, name, role);
        }
    }
    result
}

/// Adds a person unless the list already names them; a role fills one the list lacks.
fn add(list: &mut Vec<Person>, name: &str, role: Option<String>) {
    if name.is_empty() {
        return;
    }
    let key = name_key(name);
    if let Some(known) = list.iter_mut().find(|person| name_key(&person.name) == key) {
        if known.role.is_none() {
            known.role = role;
        }
        return;
    }
    list.push(Person {
        name: name.to_owned(),
        role,
    });
}

/// The key that compares two spellings of a name or publisher: width, case, spaces, `・`, and
/// dots do not tell them apart, nor does a long vowel written as a hyphen.
pub(crate) fn name_key(text: &str) -> String {
    tidy(text)
        .nfkc()
        .flat_map(char::to_lowercase)
        .filter(|character| !matches!(character, ' ' | '・' | '･' | '.'))
        .collect()
}

/// The comparison key of each person an author list names, sorted.
pub(crate) fn author_keys(entries: &[String]) -> Vec<String> {
    let mut keys: Vec<String> = people(entries)
        .iter()
        .map(|person| name_key(&person.name))
        .collect();
    keys.sort_unstable();
    keys
}

/// The comparison key of the first person an author entry names, without the role written with
/// them.
pub(crate) fn author_key(entry: &str) -> String {
    people(&[entry.to_owned()])
        .first()
        .map_or_else(|| name_key(entry), |person| name_key(&person.name))
}

fn is_life_dates(part: &str) -> bool {
    !part.is_empty()
        && part.chars().any(|character| character.is_ascii_digit())
        && part
            .chars()
            .all(|character| character.is_ascii_digit() || matches!(character, '-' | '?' | ' '))
}

fn only_katakana(text: &str) -> bool {
    text.chars()
        .all(|character| is_katakana(character) || matches!(character, '・' | ' '))
}

/// A name from the National Diet Library's catalogue form `Family, Given (fuller form), 1951-`
/// in display order: `Given Family` for Latin names, `Given・Family` for names written only in
/// katakana, and `Family Given` with one space for other Japanese names.
pub(crate) fn catalogue_name(form: &str) -> String {
    let tidied = tidy(form);
    let parts: Vec<&str> = tidied
        .split(',')
        .map(str::trim)
        .filter(|part| !part.is_empty() && !is_life_dates(part))
        .collect();
    let [family, given, rest @ ..] = parts.as_slice() else {
        return parts
            .first()
            .map_or_else(String::new, |name| (*name).to_owned());
    };
    let given = given.split(" (").next().unwrap_or(given).trim();
    let name = if family.chars().any(is_japanese) || given.chars().any(is_japanese) {
        if only_katakana(family) && only_katakana(given) {
            format!("{given}・{family}")
        } else {
            format!("{family} {given}")
        }
    } else {
        [given, family]
            .into_iter()
            .chain(rest.iter().copied())
            .collect::<Vec<_>>()
            .join(" ")
    };
    tidy(&name)
}

/// The people a responsibility statement names with their roles, such as
/// `Mark Richards, Neal Ford 著,島田浩二 訳`. A name without a role takes the role written after
/// the names it is listed with.
pub(crate) fn statement_people(statement: &str) -> Vec<Person> {
    let tidied = tidy(statement);
    let entries: Vec<(&str, Option<Option<String>>)> = tidied
        .split([',', ';', '、'])
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
        .map(split_role)
        .collect();
    let mut result = Vec::with_capacity(entries.len());
    let mut following: Option<String> = None;
    for (name, role) in entries.into_iter().rev() {
        if let Some(role) = role {
            following = role;
        }
        result.push(Person {
            name: name.to_owned(),
            role: following.clone(),
        });
    }
    result.reverse();
    result
}

/// The authors of a National Diet Library record: the catalogue names in display order, each with
/// the role the responsibility statement gives the same person. A statement name matches a
/// catalogue name by its key, or by position when the rest are spelled differently but as many;
/// statement names the catalogue lacks follow when every catalogue name matched.
pub(crate) fn record_people(creators: &[String], statement: Option<&str>) -> Vec<Person> {
    let mut people: Vec<Person> = Vec::with_capacity(creators.len());
    for creator in creators {
        let name = catalogue_name(creator);
        add(&mut people, &name, None);
    }
    let stated = statement.map(statement_people).unwrap_or_default();
    let mut used = vec![false; stated.len()];
    let mut unmatched = Vec::new();
    for (index, person) in people.iter_mut().enumerate() {
        let key = name_key(&person.name);
        match stated
            .iter()
            .enumerate()
            .find(|(at, named)| !used[*at] && name_key(&named.name) == key)
        {
            Some((at, named)) => {
                used[at] = true;
                person.role.clone_from(&named.role);
            }
            None => unmatched.push(index),
        }
    }
    let rest: Vec<usize> = (0..stated.len()).filter(|at| !used[*at]).collect();
    if unmatched.len() == rest.len() {
        for (index, at) in unmatched.iter().zip(&rest) {
            people[*index].role.clone_from(&stated[*at].role);
        }
    } else if unmatched.is_empty() {
        for at in rest {
            add(&mut people, &stated[at].name, stated[at].role.clone());
        }
    }
    people
}

/// An author entry carrying its role, as a product passes it on: `島田 浩二 (訳)`.
pub(crate) fn entry(person: &Person) -> String {
    match &person.role {
        Some(role) => format!("{} ({role})", person.name),
        None => person.name.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::{author_keys, catalogue_name, name_key, people, record_people, statement_people};
    use crate::model::Person;

    fn person(name: &str, role: Option<&str>) -> Person {
        Person {
            name: name.to_owned(),
            role: role.map(str::to_owned),
        }
    }

    fn list(entries: &[&str]) -> Vec<String> {
        entries.iter().map(|entry| (*entry).to_owned()).collect()
    }

    #[test]
    fn splits_roles_off_author_names() {
        assert_eq!(
            people(&list(&["島田 浩二（翻訳）"])),
            [person("島田 浩二", Some("訳"))]
        );
        assert_eq!(
            people(&list(&["Kent Beck (Author)"])),
            [person("Kent Beck", None)]
        );
        assert_eq!(
            people(&list(&["島田浩二 訳"])),
            [person("島田浩二", Some("訳"))]
        );
        assert_eq!(people(&list(&["角征典訳"])), [person("角征典", Some("訳"))]);
        assert_eq!(
            people(&list(&["山田 太郎 (監修)"])),
            [person("山田 太郎", Some("監修"))]
        );
        assert_eq!(
            people(&list(&["赤川 朗 イラスト"])),
            [person("赤川 朗", Some("イラスト"))]
        );
    }

    #[test]
    fn keeps_names_that_only_end_like_a_role() {
        assert_eq!(people(&list(&["山田 健作"])), [person("山田 健作", None)]);
        assert_eq!(people(&list(&["佐藤理絵"])), [person("佐藤理絵", None)]);
        assert_eq!(
            people(&list(&["岩波書店辞典編集部"])),
            [person("岩波書店辞典編集部", None)]
        );
        assert_eq!(
            people(&list(&["坊っちゃん (上)"])),
            [person("坊っちゃん (上)", None)]
        );
    }

    #[test]
    fn splits_names_written_together_only_when_each_is_a_name() {
        assert_eq!(
            people(&list(&["菊池 たけし/F.E.A.R."])),
            [person("菊池 たけし", None), person("F.E.A.R.", None)]
        );
        assert_eq!(
            people(&list(&["元宮秀介＆ワンナップ"])),
            [person("元宮秀介", None), person("ワンナップ", None)]
        );
        assert_eq!(
            people(&list(&["北沢慶/グループSNE"])),
            [person("北沢慶", None), person("グループSNE", None)]
        );
        assert_eq!(
            people(&list(&["Simon & Schuster"])),
            [person("Simon & Schuster", None)]
        );
        assert_eq!(people(&list(&["AT&T Press"])), [person("AT&T Press", None)]);
        assert_eq!(
            people(&list(&["Mark Richards & Neal Ford"])),
            [person("Mark Richards", None), person("Neal Ford", None)]
        );
    }

    #[test]
    fn compares_spellings_of_the_same_name() {
        assert_eq!(name_key("角 征典"), name_key("角征典"));
        assert_eq!(
            name_key("トレバ-・フォシェ"),
            name_key("トレバー・フォシェ")
        );
        assert_eq!(
            name_key("トレバー フォシェ"),
            name_key("トレバー・フォシェ")
        );
        assert_eq!(name_key("Robert C.Martin"), name_key("Robert C Martin"));
        assert_eq!(
            name_key("オライリー・ジャパン"),
            name_key("オライリージャパン")
        );
        assert_ne!(name_key("角 征典"), name_key("角谷 信太郎"));
        assert_eq!(
            author_keys(&list(&["角 征典", "島田 浩二（翻訳）"])),
            author_keys(&list(&["島田浩二", "角征典"]))
        );
    }

    #[test]
    fn writes_catalogue_names_in_display_order() {
        assert_eq!(catalogue_name("Boswell, Dustin"), "Dustin Boswell");
        assert_eq!(catalogue_name("Richards, Mark (W. Mark)"), "Mark Richards");
        assert_eq!(catalogue_name("Martin, Robert C"), "Robert C Martin");
        assert_eq!(catalogue_name("角, 征典"), "角 征典");
        assert_eq!(catalogue_name("藤本, ひとみ, 1951-"), "藤本 ひとみ");
        assert_eq!(catalogue_name("橋爪, 大三郎, 1948-"), "橋爪 大三郎");
        assert_eq!(
            catalogue_name("ポランニー, マイケル, 1891-1976"),
            "マイケル・ポランニー"
        );
        assert_eq!(catalogue_name("岩波書店辞典編集部"), "岩波書店辞典編集部");
    }

    #[test]
    fn reads_roles_from_a_responsibility_statement() {
        assert_eq!(
            statement_people("Mark Richards, Neal Ford 著,島田浩二 訳"),
            [
                person("Mark Richards", None),
                person("Neal Ford", None),
                person("島田浩二", Some("訳"))
            ]
        );
        assert_eq!(
            statement_people("Robert C. Martin著 ; 角征典訳"),
            [
                person("Robert C. Martin", None),
                person("角征典", Some("訳"))
            ]
        );
    }

    #[test]
    fn gives_catalogue_names_the_roles_of_the_statement() {
        let creators = list(&["Richards, Mark (W. Mark)", "Ford, Neal", "島田, 浩二"]);
        assert_eq!(
            record_people(&creators, Some("Mark Richards, Neal Ford 著,島田浩二 訳")),
            [
                person("Mark Richards", None),
                person("Neal Ford", None),
                person("島田 浩二", Some("訳"))
            ]
        );
        let creators = list(&["Boswell, Dustin", "Foucher, Trevor", "角, 征典"]);
        assert_eq!(
            record_people(
                &creators,
                Some("ダスティン・ボズウェル, トレバー・フォシェ 著,角征典 訳")
            ),
            [
                person("Dustin Boswell", None),
                person("Trevor Foucher", None),
                person("角 征典", Some("訳"))
            ]
        );
        let creators = list(&["菊池, たけし, 1968-"]);
        assert_eq!(
            record_people(
                &creators,
                Some("菊池たけし, ファーイースト・アミューズメント・リサーチ 著")
            ),
            [
                person("菊池 たけし", None),
                person("ファーイースト・アミューズメント・リサーチ", None)
            ]
        );
        assert_eq!(
            record_people(&list(&["橋爪, 大三郎, 1948-"]), None),
            [person("橋爪 大三郎", None)]
        );
    }
}
