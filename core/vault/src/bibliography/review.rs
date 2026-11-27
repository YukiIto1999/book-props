//! Proposals to bring a stored book's text into the stored spelling, for the user to review: the
//! normalisation every new record gets, and, when fetched, the National Diet Library's record.

use std::collections::HashMap;

use super::lookup::current_people;
use super::series::without_series;
use super::{Described, describe, names, present, roles, tidy_title};
use crate::model::{
    AuthorRole, BibliographyRequest, BibliographyRevision, Book, Edition, EditionText, Person,
    SeriesEntry,
};

/// The people a stored author list names in the stored spelling. A role kept beside the list
/// stays with its name; a role written into an entry is split off it.
fn normalized_people(book: &Book) -> Vec<Person> {
    let mut people: Vec<Person> = Vec::new();
    for person in current_people(book) {
        let kept = person.role;
        for parsed in names::people(&[person.name]) {
            let key = names::name_key(&parsed.name);
            if people
                .iter()
                .any(|known| names::name_key(&known.name) == key)
            {
                continue;
            }
            let role = kept.clone().or(parsed.role);
            people.push(Person {
                name: parsed.name,
                role,
            });
        }
    }
    people
}

/// The editions in the order their records speak for the book: unarchived ones first.
fn speaking_order(book: &Book) -> impl Iterator<Item = &Edition> {
    let active = book
        .editions
        .iter()
        .filter(|edition| edition.archived_at.is_none());
    let archived = book
        .editions
        .iter()
        .filter(|edition| edition.archived_at.is_some());
    active.chain(archived)
}

fn first_record<'d>(
    edition: &Edition,
    records: &'d HashMap<&str, Described>,
) -> Option<&'d Described> {
    edition
        .isbns
        .iter()
        .find_map(|isbn| records.get(isbn.as_str()))
}

fn revised_series(edition: &Edition, records: &HashMap<&str, Described>) -> Vec<SeriesEntry> {
    edition
        .isbns
        .iter()
        .filter_map(|isbn| {
            let stated = records
                .get(isbn.as_str())
                .and_then(|found| found.series.clone());
            let kept = edition
                .series
                .iter()
                .find(|entry| entry.isbn == *isbn)
                .and_then(|entry| present(Some(&entry.name)));
            stated.or(kept).map(|name| SeriesEntry {
                isbn: isbn.clone(),
                name,
            })
        })
        .collect()
}

fn revised_edition(edition: &Edition, records: &HashMap<&str, Described>) -> Option<EditionText> {
    let found = first_record(edition, records);
    let current_publisher = present(edition.details.publisher.as_deref());
    let publisher = found
        .and_then(|found| found.publisher.clone())
        .or_else(|| current_publisher.clone());
    let current_label = present(edition.label.as_deref());
    let label = current_label
        .clone()
        .or_else(|| found.and_then(|found| found.label.clone()));
    let series = revised_series(edition, records);
    let text = EditionText {
        id: edition.id.clone(),
        publisher: (publisher.as_deref() != edition.details.publisher.as_deref())
            .then_some(publisher)
            .flatten(),
        label: (label.as_deref() != edition.label.as_deref())
            .then_some(label)
            .flatten(),
        series: (series != edition.series).then_some(series),
    };
    (text
        != EditionText {
            id: edition.id.clone(),
            ..EditionText::default()
        })
    .then_some(text)
}

fn stored_role(book: &Book, name: &str) -> Option<String> {
    book.author_roles
        .iter()
        .find(|role| role.name == name)
        .map(|role| role.role.clone())
}

fn kept_roles(book: &Book) -> Vec<AuthorRole> {
    book.authors
        .iter()
        .filter_map(|name| {
            stored_role(book, name).map(|role| AuthorRole {
                name: name.clone(),
                role,
            })
        })
        .collect()
}

/// The NDC number for a book that has none: the first one a record states, taking the records in
/// the order they speak for the book.
fn classification(book: &Book, records: &HashMap<&str, Described>) -> Option<String> {
    if !book.unclassified() {
        return None;
    }
    speaking_order(book)
        .flat_map(|edition| &edition.isbns)
        .find_map(|isbn| records.get(isbn.as_str())?.classification.clone())
}

/// The text a stored book would have in the stored spelling. With records, the record of the
/// first ISBN that has one gives the title and authors, and each ISBN's record gives its edition's
/// publisher and series and fills a blank edition statement, and a book without an NDC number
/// gets the first one they state; without one, a title ending in a series stated for one of the
/// book's ISBNs loses that series. Only values that change appear.
#[must_use]
pub fn plan_review(request: &BibliographyRequest) -> BibliographyRevision {
    let book = &request.book;
    let records: HashMap<&str, Described> = request
        .answers
        .iter()
        .filter_map(|answer| Some((answer.isbn.as_str(), describe(answer.record.as_ref()?))))
        .collect();
    let primary = speaking_order(book).find_map(|edition| first_record(edition, &records));
    let mut people = normalized_people(book);
    let title = match primary {
        Some(found) if !found.title.is_empty() => found.title.clone(),
        _ => {
            let series: Vec<&str> = book
                .editions
                .iter()
                .flat_map(|edition| edition.series.iter().map(|entry| entry.name.as_str()))
                .chain(records.values().filter_map(|found| found.series.as_deref()))
                .collect();
            without_series(&tidy_title(&book.title), &series).to_owned()
        }
    };
    if let Some(found) = primary.filter(|found| !found.people.is_empty()) {
        people.clone_from(&found.people);
    }
    let names: Vec<String> = people.iter().map(|person| person.name.clone()).collect();
    let author_roles = roles(&people);
    let authors_change = names != book.authors || author_roles != kept_roles(book);
    BibliographyRevision {
        title: (title != book.title && !title.is_empty()).then_some(title),
        authors: authors_change.then_some(names),
        author_roles: authors_change.then_some(author_roles),
        classification: classification(book, &records),
        editions: book
            .editions
            .iter()
            .filter_map(|edition| revised_edition(edition, &records))
            .collect(),
        ends_lookups: false,
    }
}
