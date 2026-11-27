//! Bibliographic text in one spelling whatever source it came from: products from the extension,
//! store pages, and the registration screen, and records from the National Diet Library, which is
//! the authority for the title, authors, publisher, series, and classification of a book with an
//! ISBN.

mod classification;
mod lookup;
mod names;
mod review;
mod series;
mod text;

pub(crate) use classification::ndc_number;
pub use classification::{ndc_classes, ndc_section};
pub use lookup::plan_enrichment;
pub(crate) use lookup::{WrittenEdition, pending_lookup};
pub(crate) use names::{author_key, author_keys, name_key};
pub use review::plan_review;
pub(crate) use text::{tidy, tidy_title};

use std::cmp::Reverse;

use crate::model::{
    AuthorRole, CatalogueRecord, DescribedRecord, Details, Person, Product, StatedNdc,
};

fn present(value: Option<&str>) -> Option<String> {
    value.map(tidy).filter(|value| !value.is_empty())
}

fn roles(people: &[Person]) -> Vec<AuthorRole> {
    people
        .iter()
        .filter_map(|person| {
            person.role.as_ref().map(|role| AuthorRole {
                name: person.name.clone(),
                role: role.clone(),
            })
        })
        .collect()
}

impl Product {
    /// The product in the stored spelling: authors split from their roles, and a trailing series
    /// taken off the title when the product states that series.
    pub(crate) fn normalized(&self) -> Self {
        let people = names::people(&self.authors);
        let series = present(self.series.as_deref());
        let tidied = tidy_title(&self.title);
        let title = match series.as_deref() {
            Some(name) => series::without_series(&tidied, &[name]).to_owned(),
            None => tidied,
        };
        Self {
            title,
            authors: people.iter().map(|person| person.name.clone()).collect(),
            isbns: self.isbns.clone(),
            label: present(self.label.as_deref()),
            details: Details {
                publisher: present(self.details.publisher.as_deref()),
                ..self.details.clone()
            },
            series,
            classification: self.classification.as_deref().and_then(ndc_number),
            roles: roles(&people),
        }
    }

    /// The people the product names, with their roles.
    pub(crate) fn people(&self) -> Vec<Person> {
        self.authors
            .iter()
            .map(|name| Person {
                name: name.clone(),
                role: self
                    .roles
                    .iter()
                    .find(|role| role.name == *name)
                    .map(|role| role.role.clone()),
            })
            .collect()
    }
}

/// A National Diet Library record in the stored spelling.
pub(crate) struct Described {
    pub(crate) title: String,
    pub(crate) people: Vec<Person>,
    pub(crate) publisher: Option<String>,
    pub(crate) label: Option<String>,
    pub(crate) series: Option<String>,
    pub(crate) classification: Option<String>,
}

/// The publisher of a record: the first one not marked as the distributor with `(発売)`.
fn publisher(publishers: &[String]) -> Option<String> {
    let tidied: Vec<String> = publishers.iter().map(|name| tidy(name)).collect();
    let distributor = |name: &&String| {
        name.ends_with("(発売)") || name.ends_with("(発売元)") || name.ends_with(" 発売")
    };
    tidied
        .iter()
        .find(|name| !distributor(name))
        .or_else(|| tidied.first())
        .map(|name| {
            name.trim_end_matches("(発売)")
                .trim_end_matches("(発売元)")
                .trim()
                .to_owned()
        })
        .filter(|name| !name.is_empty())
}

/// The NDC number of a record: the readable one of the newest NDC edition it states, a number
/// whose edition the record does not name coming last, and the first of equals.
fn classification(stated: &[StatedNdc]) -> Option<String> {
    stated
        .iter()
        .filter_map(|entry| Some((entry.edition, ndc_number(&entry.number)?)))
        .min_by_key(|(edition, _)| Reverse(*edition))
        .map(|(_, number)| number)
}

pub(crate) fn describe(record: &CatalogueRecord) -> Described {
    Described {
        title: tidy_title(&record.title),
        people: names::record_people(&record.creators, record.statement.as_deref()),
        publisher: publisher(&record.publishers),
        label: present(record.edition.as_deref()),
        series: record.series.iter().find_map(|name| present(Some(name))),
        classification: classification(&record.ndc),
    }
}

/// A National Diet Library record in the stored spelling, for the registration screen.
#[must_use]
pub fn describe_record(record: &CatalogueRecord) -> DescribedRecord {
    let described = describe(record);
    DescribedRecord {
        title: described.title,
        authors: described.people.iter().map(names::entry).collect(),
        publisher: described.publisher,
        label: described.label,
        series: described.series,
        classification: described.classification,
    }
}

#[cfg(test)]
mod tests {
    use super::{describe_record, publisher};
    use crate::model::{CatalogueRecord, Details, Product, StatedNdc};

    fn texts(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| (*value).to_owned()).collect()
    }

    #[test]
    fn keeps_the_publisher_and_drops_the_distributor() {
        assert_eq!(
            publisher(&texts(&["オライリー・ジャパン", "オーム社 (発売)"])).as_deref(),
            Some("オライリー・ジャパン")
        );
        assert_eq!(
            publisher(&texts(&["KADOKAWA (発売)"])).as_deref(),
            Some("KADOKAWA")
        );
        assert_eq!(publisher(&[]), None);
    }

    #[test]
    fn describes_a_record_in_the_stored_spelling() {
        let record = CatalogueRecord {
            title: "リーダブルコード : より良いコードを書くためのシンプルで実践的なテクニック"
                .to_owned(),
            creators: texts(&["Boswell, Dustin", "Foucher, Trevor", "角, 征典"]),
            statement: Some("Dustin Boswell, Trevor Foucher 著,角征典 訳".to_owned()),
            publishers: texts(&["オライリー・ジャパン", "オーム社 (発売)"]),
            series: texts(&["THEORY/IN/PRACTICE"]),
            edition: None,
            ndc: vec![StatedNdc {
                edition: Some(9),
                number: "007.64".to_owned(),
            }],
        };
        let described = describe_record(&record);
        assert_eq!(
            described.authors,
            ["Dustin Boswell", "Trevor Foucher", "角 征典 (訳)"]
        );
        assert_eq!(described.publisher.as_deref(), Some("オライリー・ジャパン"));
        assert_eq!(described.series.as_deref(), Some("THEORY/IN/PRACTICE"));
        assert_eq!(described.classification.as_deref(), Some("007.64"));
    }

    #[test]
    fn takes_the_number_of_the_newest_ndc_edition() {
        let stated = |entries: &[(Option<u32>, &str)]| CatalogueRecord {
            title: "十戒".to_owned(),
            creators: Vec::new(),
            statement: None,
            publishers: Vec::new(),
            series: Vec::new(),
            edition: None,
            ndc: entries
                .iter()
                .map(|(edition, number)| StatedNdc {
                    edition: *edition,
                    number: (*number).to_owned(),
                })
                .collect(),
        };
        let chosen =
            |entries: &[(Option<u32>, &str)]| describe_record(&stated(entries)).classification;
        assert_eq!(
            chosen(&[(Some(9), "913.8"), (Some(10), "913.6")]).as_deref(),
            Some("913.6")
        );
        assert_eq!(
            chosen(&[(Some(10), "Y84"), (Some(9), "913.8")]).as_deref(),
            Some("913.8")
        );
        assert_eq!(chosen(&[(Some(8), "389")]).as_deref(), Some("389"));
        assert_eq!(
            chosen(&[(None, "389.1"), (Some(6), "389")]).as_deref(),
            Some("389")
        );
        assert_eq!(chosen(&[(None, "389.1")]).as_deref(), Some("389.1"));
        assert_eq!(chosen(&[]), None);
    }

    #[test]
    fn normalises_a_product_from_a_store() {
        let product = Product {
            title: "はじめての言語ゲーム (講談社現代新書 2004)".to_owned(),
            authors: texts(&["島田 浩二（翻訳）", "トレバ-・フォシェ"]),
            isbns: texts(&["9784062880046"]),
            label: Some("　".to_owned()),
            details: Details {
                publisher: Some("オライリー・ジャパン ".to_owned()),
                ..Details::default()
            },
            series: Some("講談社現代新書 ; 2004".to_owned()),
            classification: Some("１６１．１".to_owned()),
            roles: Vec::new(),
        }
        .normalized();
        assert_eq!(product.title, "はじめての言語ゲーム");
        assert_eq!(product.authors, ["島田 浩二", "トレバー・フォシェ"]);
        assert_eq!(product.roles.len(), 1);
        assert_eq!(product.label, None);
        assert_eq!(
            product.details.publisher.as_deref(),
            Some("オライリー・ジャパン")
        );
        assert_eq!(product.classification.as_deref(), Some("161.1"));
    }
}
