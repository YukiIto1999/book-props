//! Lookups a write leaves for the National Diet Library: what the write left in each field the
//! library's record may replace, and the revision once the record arrives. A field the user
//! changed after the write no longer holds what the write left, so the record does not replace it.

use serde::{Deserialize, Serialize};

use super::{Described, describe, roles};
use crate::model::{
    BibliographyRequest, BibliographyRevision, Book, Edition, EditionText, EditionWrite,
    EnrichmentPlan, Person, SeriesEntry,
};

/// What a write left in one field the record may replace; no value when it left the field blank.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "field",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
enum Written {
    Title {
        value: String,
    },
    Authors {
        people: Vec<Person>,
    },
    Publisher {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        value: Option<String>,
    },
    Label {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        value: Option<String>,
    },
    Series {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        value: Option<String>,
    },
}

/// One lookup a book waits for: the ISBN to look up, the edition it fills, and what was written.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Lookup {
    isbn: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    edition_id: Option<String>,
    written: Vec<Written>,
}

/// The lookups a stored record names; an unreadable record names none.
fn decode(text: &str) -> Vec<Lookup> {
    serde_json::from_str(text).unwrap_or_default()
}

/// The edition a write leaves, and the stored edition it updates when it is not new.
pub(crate) struct WrittenEdition<'a> {
    pub(crate) edition: &'a EditionWrite,
    pub(crate) stored: Option<&'a Edition>,
}

fn series_of<'a>(series: &'a [SeriesEntry], isbn: &str) -> Option<&'a str> {
    series
        .iter()
        .find(|entry| entry.isbn == isbn)
        .map(|entry| entry.name.as_str())
}

fn blank(value: Option<&String>) -> bool {
    value.is_none_or(|value| value.trim().is_empty())
}

/// A field of an updated edition counts when the write filled it or left it blank.
fn updated(written: Option<&String>, stored: Option<&String>) -> Option<Option<String>> {
    match written {
        Some(value) => Some(Some(value.clone())),
        None if blank(stored) => Some(None),
        None => None,
    }
}

fn edition_fields(isbn: &str, written: &WrittenEdition<'_>) -> Vec<Written> {
    let edition = written.edition;
    let series = series_of(&edition.series, isbn).map(str::to_owned);
    let Some(stored) = written.stored else {
        return vec![
            Written::Publisher {
                value: edition.publisher.clone(),
            },
            Written::Label {
                value: edition.label.clone(),
            },
            Written::Series { value: series },
        ];
    };
    let publisher = updated(
        edition.publisher.as_ref(),
        stored.details.publisher.as_ref(),
    )
    .map(|value| Written::Publisher { value });
    let label = updated(edition.label.as_ref(), stored.label.as_ref())
        .map(|value| Written::Label { value });
    let series = series_of(&stored.series, isbn)
        .is_none()
        .then_some(Written::Series { value: series });
    [publisher, label, series].into_iter().flatten().collect()
}

/// The lookups a book waits for after a write: those it waited for before, with this write's
/// lookup in place of an earlier one for the same ISBN and edition. `None` when nothing the write
/// left may be replaced.
pub(crate) fn pending_lookup(
    target: Option<&Book>,
    isbn: &str,
    new_book: Option<(&str, Vec<Person>)>,
    edition: Option<&WrittenEdition<'_>>,
) -> Option<String> {
    let mut written = Vec::new();
    if let Some((title, people)) = new_book {
        written.push(Written::Title {
            value: title.to_owned(),
        });
        written.push(Written::Authors { people });
    }
    if let Some(edition) = edition {
        written.extend(edition_fields(isbn, edition));
    }
    if written.is_empty() {
        return None;
    }
    let edition_id = edition.map(|edition| edition.edition.id.clone());
    let mut lookups = target
        .and_then(|book| book.pending_lookup.as_deref())
        .map(decode)
        .unwrap_or_default();
    lookups.retain(|lookup| lookup.isbn != isbn || lookup.edition_id != edition_id);
    lookups.push(Lookup {
        isbn: isbn.to_owned(),
        edition_id,
        written,
    });
    serde_json::to_string(&lookups).ok()
}

/// The people a book names now, with the roles kept beside its author list.
pub(crate) fn current_people(book: &Book) -> Vec<Person> {
    book.authors
        .iter()
        .map(|name| Person {
            name: name.clone(),
            role: book
                .author_roles
                .iter()
                .find(|role| role.name == *name)
                .map(|role| role.role.clone()),
        })
        .collect()
}

fn edition_text<'r>(revision: &'r mut BibliographyRevision, id: &str) -> &'r mut EditionText {
    let index = match revision.editions.iter().position(|text| text.id == id) {
        Some(index) => index,
        None => {
            revision.editions.push(EditionText {
                id: id.to_owned(),
                ..EditionText::default()
            });
            revision.editions.len() - 1
        }
    };
    &mut revision.editions[index]
}

/// The value to write when the field still holds what was written and the record says otherwise.
fn replacement(
    current: Option<&str>,
    written: Option<&str>,
    found: Option<&str>,
) -> Option<String> {
    let current = current.filter(|value| !value.trim().is_empty());
    (current == written && found.is_some() && found != current)
        .then(|| found.map(str::to_owned))
        .flatten()
}

fn revise_book(
    book: &Book,
    field: &Written,
    found: &Described,
    revision: &mut BibliographyRevision,
) {
    match field {
        Written::Title { value }
            if book.title == *value && !found.title.is_empty() && found.title != book.title =>
        {
            revision.title = Some(found.title.clone());
        }
        Written::Authors { people }
            if current_people(book) == *people
                && !found.people.is_empty()
                && found.people != *people =>
        {
            revision.authors = Some(
                found
                    .people
                    .iter()
                    .map(|person| person.name.clone())
                    .collect(),
            );
            revision.author_roles = Some(roles(&found.people));
        }
        _ => {}
    }
}

fn revise_edition(
    edition: &Edition,
    isbn: &str,
    field: &Written,
    found: &Described,
    revision: &mut BibliographyRevision,
) {
    match field {
        Written::Publisher { value } => {
            let current = edition.details.publisher.as_deref();
            if let Some(publisher) =
                replacement(current, value.as_deref(), found.publisher.as_deref())
            {
                edition_text(revision, &edition.id).publisher = Some(publisher);
            }
        }
        Written::Label { value } => {
            if let Some(label) = replacement(
                edition.label.as_deref(),
                value.as_deref(),
                found.label.as_deref(),
            ) {
                edition_text(revision, &edition.id).label = Some(label);
            }
        }
        Written::Series { value } => {
            let current = series_of(&edition.series, isbn);
            if let Some(name) = replacement(current, value.as_deref(), found.series.as_deref()) {
                let mut series: Vec<SeriesEntry> = edition
                    .series
                    .iter()
                    .filter(|entry| entry.isbn != isbn)
                    .cloned()
                    .collect();
                series.push(SeriesEntry {
                    isbn: isbn.to_owned(),
                    name,
                });
                edition_text(revision, &edition.id).series = Some(series);
            }
        }
        _ => {}
    }
}

/// What finishing the lookups of a book leads to: the ISBNs still to fetch, or the revision that
/// replaces each field still holding what its write left with the library's record, gives a book
/// without an NDC number the first one a record states, and removes the record of the lookups.
/// An ISBN the library has no record for leaves its fields as written.
#[must_use]
pub fn plan_enrichment(request: &BibliographyRequest) -> EnrichmentPlan {
    let book = &request.book;
    let Some(text) = book.pending_lookup.as_deref() else {
        return EnrichmentPlan::None;
    };
    let lookups = decode(text);
    let mut missing: Vec<String> = Vec::new();
    for lookup in &lookups {
        let answered = request
            .answers
            .iter()
            .any(|answer| answer.isbn == lookup.isbn);
        if !answered && !missing.contains(&lookup.isbn) {
            missing.push(lookup.isbn.clone());
        }
    }
    if !missing.is_empty() {
        return EnrichmentPlan::Lookup { isbns: missing };
    }
    let mut revision = BibliographyRevision {
        ends_lookups: true,
        ..BibliographyRevision::default()
    };
    for lookup in &lookups {
        let Some(record) = request
            .answers
            .iter()
            .find(|answer| answer.isbn == lookup.isbn)
            .and_then(|answer| answer.record.as_ref())
        else {
            continue;
        };
        let found = describe(record);
        let edition = lookup.edition_id.as_deref().and_then(|id| book.edition(id));
        for field in &lookup.written {
            revise_book(book, field, &found, &mut revision);
            if let Some(edition) = edition {
                revise_edition(edition, &lookup.isbn, field, &found, &mut revision);
            }
        }
        if revision.classification.is_none() && book.unclassified() {
            revision.classification = found.classification;
        }
    }
    EnrichmentPlan::Write {
        revision: Box::new(revision),
    }
}
