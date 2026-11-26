//! The shelf: which books a query selects, in what order, and which fields and tags it offers.
//!
//! The core carries no locale. The runtime ranks the texts one field holds once
//! (`collation_texts`, then `collate`), and the core orders books by those ranks. Which values are
//! compared, which of a book's values counts, where books without a value go, and how ties break
//! stay here.

mod field;

use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};
use std::fmt;

use unicode_normalization::UnicodeNormalization;

use self::field::{EDITION_TEXTS, Field, STANDARD, Value};
use crate::identity::isbn13;
use crate::model::{
    CustomField, Edition, OwnershipFilter, RangeKind, ShelfField, ShelfOverview, ShelfQuery,
    ShelfRange, ShelfRecord, ShelfRequest, ShelfSelection, ShelfTag, ShelfView, WishFilter,
};
use crate::text::{code_unit_order, fold, is_space, trim};

/// Books that tie on the sort field are ordered by this field's ranks, then by path.
const TITLE: &str = "title";

/// Whether an optional stored text holds anything; an empty text counts as absent.
fn present(value: Option<&str>) -> bool {
    value.is_some_and(|value| !value.is_empty())
}

/// The key that tells tags apart: folded, without a leading `#`.
fn tag_key(tag: &str) -> String {
    let mut key = fold(tag);
    if key.starts_with('#') {
        key.remove(0);
    }
    key
}

/// A tag as the shelf shows it: trimmed, without a leading `#` or `＃`.
fn tag_name(tag: &str) -> String {
    let tag = trim(tag);
    tag.strip_prefix(['#', '＃']).unwrap_or(tag).to_owned()
}

/// A book with the facts the shelf matches on, read once when the shelf opens.
struct Book {
    record: ShelfRecord,
    archived: bool,
    /// Positions of the editions the book holds that are not archived.
    editions: Vec<usize>,
    owned: bool,
    /// Folded texts a search word may be part of.
    words: Vec<String>,
    isbns: Vec<String>,
    tags: Vec<String>,
    authors: Vec<String>,
    publishers: Vec<String>,
}

fn search_texts(record: &ShelfRecord, tags: &[String], current: &[&Edition]) -> Vec<String> {
    let custom = record
        .custom_fields
        .iter()
        .flat_map(|value| [value.field.name(), value.text.as_str()]);
    let editions = current.iter().flat_map(|edition| {
        EDITION_TEXTS
            .iter()
            .filter_map(|field| field.detail(edition))
    });
    std::iter::once(record.title.as_str())
        .chain(record.authors.iter().map(String::as_str))
        .chain(record.finished_on.as_deref())
        .chain(tags.iter().map(String::as_str))
        .chain(custom)
        .chain(editions)
        .filter(|text| !text.is_empty())
        .map(fold)
        .collect()
}

impl Book {
    fn new(record: ShelfRecord) -> Self {
        let editions: Vec<usize> = (0..record.editions.len())
            .filter(|index| !present(record.editions[*index].archived_at.as_deref()))
            .collect();
        let current: Vec<&Edition> = editions
            .iter()
            .map(|index| &record.editions[*index])
            .collect();
        let tags: Vec<String> = record.tags.iter().map(|tag| tag_key(tag)).collect();
        let words = search_texts(&record, &tags, &current);
        let isbns = current
            .iter()
            .flat_map(|edition| edition.isbns.clone())
            .collect();
        let publishers = current
            .iter()
            .filter_map(|edition| edition.details.publisher.as_deref())
            .map(fold)
            .collect();
        let owned = current.iter().any(|edition| edition.owned);
        let authors = record.authors.iter().map(|name| fold(name)).collect();
        Self {
            archived: present(record.archived_at.as_deref()),
            editions,
            owned,
            words,
            isbns,
            tags,
            authors,
            publishers,
            record,
        }
    }

    fn current(&self) -> impl Iterator<Item = &Edition> {
        self.editions
            .iter()
            .map(|index| &self.record.editions[*index])
    }
}

/// One word of a search.
enum Word {
    /// An ISBN matches the editions that carry it.
    Isbn(String),
    /// A word with `#` matches that tag only.
    Tag(String),
    /// Any other word matches part of a field, or, when it is digits, part of an ISBN.
    Part {
        needle: String,
        digits: Option<String>,
    },
}

impl Word {
    fn new(word: &str) -> Self {
        if let Some(isbn) = isbn13(word) {
            return Self::Isbn(isbn);
        }
        let folded = fold(word);
        let needle = folded.strip_prefix('#').unwrap_or(&folded).to_owned();
        if !needle.is_empty() && folded.starts_with('#') {
            return Self::Tag(needle);
        }
        let digits: String = needle
            .chars()
            .filter(|character| *character != '-')
            .collect();
        let digits = (!digits.is_empty() && digits.bytes().all(|byte| byte.is_ascii_digit()))
            .then_some(digits);
        Self::Part { needle, digits }
    }

    fn matches(&self, book: &Book) -> bool {
        match self {
            Self::Isbn(isbn) => book.isbns.contains(isbn),
            Self::Tag(key) => book.tags.contains(key),
            Self::Part { needle, digits } => {
                book.words.iter().any(|text| text.contains(needle.as_str()))
                    || digits.as_ref().is_some_and(|digits| {
                        book.isbns.iter().any(|isbn| isbn.contains(digits.as_str()))
                    })
            }
        }
    }
}

/// Whether a value lies within a range. A number compares with the numbers of the bounds; a text
/// compares by code units with their texts.
fn includes(value: &Value, range: &ShelfRange) -> bool {
    match value {
        Value::Number(number) => {
            let bound = |text: &str, number: Option<f64>, open: f64| {
                if text.is_empty() {
                    open
                } else {
                    number.unwrap_or(f64::NAN)
                }
            };
            *number >= bound(&range.from.text, range.from.number, f64::NEG_INFINITY)
                && *number <= bound(&range.through.text, range.through.number, f64::INFINITY)
        }
        Value::Text(text) => {
            (range.from.text.is_empty() || code_unit_order(text, &range.from.text).is_ge())
                && (range.through.text.is_empty()
                    || code_unit_order(text, &range.through.text).is_le())
        }
    }
}

/// A query read once for every book.
struct Criteria<'q> {
    query: &'q ShelfQuery,
    words: Vec<Word>,
    tags: Vec<String>,
    author: Option<String>,
    publisher: Option<String>,
    /// The range, unless both of its ends are open.
    range: Option<(Field<'q>, &'q ShelfRange)>,
}

impl<'q> Criteria<'q> {
    fn new(query: &'q ShelfQuery) -> Self {
        let text: String = query.text.nfkc().collect();
        Self {
            query,
            words: text
                .split(is_space)
                .filter(|word| !word.is_empty())
                .map(Word::new)
                .collect(),
            tags: query.tags.iter().map(|tag| tag_key(tag)).collect(),
            author: query.author.as_deref().map(fold),
            publisher: query.publisher.as_deref().map(fold),
            range: query
                .range
                .as_ref()
                .filter(|range| !range.from.text.is_empty() || !range.through.text.is_empty())
                .map(|range| (Field::parse(&range.key), range)),
        }
    }

    fn states(&self, book: &Book) -> bool {
        let ownership = match self.query.ownership {
            OwnershipFilter::Any => true,
            OwnershipFilter::Owned => book.owned,
            OwnershipFilter::Unowned => !book.owned,
        };
        let wish = match self.query.wish {
            WishFilter::Any => true,
            WishFilter::Wanted => book.record.wanted,
            WishFilter::Unwanted => !book.record.wanted,
        };
        let status = book.record.reading_status.as_deref();
        let reading = match self.query.reading.as_str() {
            "unset" => status.is_none(),
            "any" => true,
            reading => status == Some(reading),
        };
        ownership && wish && reading
    }

    fn facets(&self, book: &Book) -> bool {
        self.tags.iter().all(|tag| book.tags.contains(tag))
            && self
                .author
                .as_ref()
                .is_none_or(|name| book.authors.contains(name))
            && self
                .publisher
                .as_ref()
                .is_none_or(|publisher| book.publishers.contains(publisher))
            && self.range.is_none_or(|(field, range)| {
                field
                    .values(book)
                    .iter()
                    .any(|value| includes(value, range))
            })
    }

    fn admits(&self, book: &Book) -> bool {
        !book.archived
            && self.states(book)
            && self.facets(book)
            && self.words.iter().all(|word| word.matches(book))
    }
}

/// A value as sorting compares it: numbers by value before texts by their rank.
#[derive(Clone, Copy)]
enum Rank {
    Number(f64),
    Text(u32),
}

impl Rank {
    fn order(self, other: Self) -> Ordering {
        match (self, other) {
            (Self::Number(left), Self::Number(right)) => {
                left.partial_cmp(&right).unwrap_or(Ordering::Equal)
            }
            (Self::Number(_), Self::Text(_)) => Ordering::Less,
            (Self::Text(_), Self::Number(_)) => Ordering::Greater,
            (Self::Text(left), Self::Text(right)) => left.cmp(&right),
        }
    }
}

/// The value a book sorts by: its least value ascending, its greatest descending.
fn pick(ranks: &[Rank], descending: bool) -> Option<Rank> {
    let wanted = if descending {
        Ordering::Greater
    } else {
        Ordering::Less
    };
    ranks.iter().copied().reduce(|choice, rank| {
        if rank.order(choice) == wanted {
            rank
        } else {
            choice
        }
    })
}

/// Why the shelf cannot answer.
#[derive(Debug, PartialEq, Eq)]
pub enum ShelfError {
    /// The sort field or the title has not been ranked.
    NotCollated,
    /// The ranks do not match the texts of the field.
    Ranks,
}

impl fmt::Display for ShelfError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::NotCollated => "the sort field and the title must be collated first",
            Self::Ranks => "the ranks must follow the collation texts one for one",
        })
    }
}

impl std::error::Error for ShelfError {}

/// Kinds of a field the user added, one bit each.
const fn kind_bit(field: &CustomField) -> u8 {
    match field {
        CustomField::Text { .. } => 1,
        CustomField::Date { .. } => 2,
        CustomField::Number { .. } => 4,
        CustomField::Boolean { .. } => 8,
        CustomField::Choice { .. } => 16,
    }
}

/// A field the user added takes a range only when every current book stores it as the same date
/// or number kind.
const fn custom_range(kinds: u8) -> Option<RangeKind> {
    match kinds {
        2 => Some(RangeKind::Date),
        4 => Some(RangeKind::Number),
        _ => None,
    }
}

/// The books of one shelf, kept while the user changes the query.
pub struct ShelfIndex {
    books: Vec<Book>,
    /// For each collated field, each book's values as ranks.
    collations: HashMap<String, Vec<Vec<Rank>>>,
}

impl ShelfIndex {
    #[must_use]
    pub fn new(request: ShelfRequest) -> Self {
        Self {
            books: request.books.into_iter().map(Book::new).collect(),
            collations: HashMap::new(),
        }
    }

    fn current(&self) -> impl Iterator<Item = &Book> {
        self.books.iter().filter(|book| !book.archived)
    }

    /// The distinct texts the current books hold in a field, in the order they first appear. The
    /// runtime ranks them for `collate`.
    #[must_use]
    pub fn collation_texts(&self, key: &str) -> Vec<String> {
        let field = Field::parse(key);
        let mut seen = HashSet::new();
        let mut texts = Vec::new();
        for value in self.current().flat_map(|book| field.values(book)) {
            if let Value::Text(text) = value
                && seen.insert(text.clone())
            {
                texts.push(text);
            }
        }
        texts
    }

    /// Takes the rank of each collation text of a field, in order; texts that compare equal share
    /// a rank.
    ///
    /// # Errors
    /// Fails when the ranks do not match the collation texts one for one.
    pub fn collate(&mut self, key: &str, ranks: &[u32]) -> Result<(), ShelfError> {
        let texts = self.collation_texts(key);
        if texts.len() != ranks.len() {
            return Err(ShelfError::Ranks);
        }
        let rank_of: HashMap<String, u32> = texts.into_iter().zip(ranks.iter().copied()).collect();
        let field = Field::parse(key);
        let ranked = self
            .books
            .iter()
            .map(|book| {
                if book.archived {
                    return Vec::new();
                }
                field
                    .values(book)
                    .into_iter()
                    .map(|value| match value {
                        Value::Number(number) => Rank::Number(number),
                        Value::Text(text) => Rank::Text(rank_of[&text]),
                    })
                    .collect()
            })
            .collect();
        self.collations.insert(key.to_owned(), ranked);
        Ok(())
    }

    fn order(
        &self,
        (left, left_value): (usize, Option<Rank>),
        (right, right_value): (usize, Option<Rank>),
        titles: &[Vec<Rank>],
        descending: bool,
    ) -> Ordering {
        let by_value = match (left_value, right_value) {
            (None, None) => Ordering::Equal,
            (None, Some(_)) => return Ordering::Greater,
            (Some(_), None) => return Ordering::Less,
            (Some(left), Some(right)) if descending => right.order(left),
            (Some(left), Some(right)) => left.order(right),
        };
        let by_title = || match (titles[left].first(), titles[right].first()) {
            (Some(left), Some(right)) => left.order(*right),
            _ => Ordering::Equal,
        };
        by_value.then_with(by_title).then_with(|| {
            code_unit_order(
                &self.books[left].record.path,
                &self.books[right].record.path,
            )
        })
    }

    /// The current books the query admits, ordered by the sort field. Books without a value come
    /// last in either direction; ties go by title, then by path.
    ///
    /// # Errors
    /// Fails unless the sort field and the title were collated.
    pub fn select(&self, query: &ShelfQuery) -> Result<ShelfSelection, ShelfError> {
        let (Some(values), Some(titles)) =
            (self.collations.get(&query.sort), self.collations.get(TITLE))
        else {
            return Err(ShelfError::NotCollated);
        };
        let criteria = Criteria::new(query);
        let mut chosen: Vec<(usize, Option<Rank>)> = (0..self.books.len())
            .filter(|index| criteria.admits(&self.books[*index]))
            .map(|index| (index, pick(&values[index], query.descending)))
            .collect();
        chosen.sort_by(|left, right| self.order(*left, *right, titles, query.descending));
        Ok(ShelfSelection {
            books: chosen.into_iter().map(|(index, _)| index).collect(),
            tags: criteria.tags,
        })
    }

    fn fields(&self) -> Vec<ShelfField> {
        let mut custom: Vec<(&str, u8)> = Vec::new();
        for value in self.current().flat_map(|book| &book.record.custom_fields) {
            let name = value.field.name();
            match custom.iter_mut().find(|(known, _)| *known == name) {
                Some((_, kinds)) => *kinds |= kind_bit(&value.field),
                None => custom.push((name, kind_bit(&value.field))),
            }
        }
        let standard = STANDARD.iter().map(|(key, field)| ShelfField {
            key: (*key).to_owned(),
            name: None,
            range: field.range(),
        });
        let added = custom.into_iter().map(|(name, kinds)| ShelfField {
            key: format!("custom:{name}"),
            name: Some(name.to_owned()),
            range: custom_range(kinds),
        });
        standard.chain(added).collect()
    }

    fn tags(&self) -> Vec<ShelfTag> {
        let mut seen = HashSet::new();
        self.current()
            .flat_map(|book| book.record.tags.iter().zip(&book.tags))
            .filter(|(_, key)| !key.is_empty() && seen.insert(key.as_str()))
            .map(|(tag, key)| ShelfTag {
                name: tag_name(tag),
                key: key.clone(),
            })
            .collect()
    }

    /// The fields and tags the shelf offers, and how it shows each book.
    #[must_use]
    pub fn overview(&self) -> ShelfOverview {
        let books = self
            .books
            .iter()
            .map(|book| ShelfView {
                tags: book
                    .record
                    .tags
                    .iter()
                    .zip(&book.tags)
                    .map(|(tag, key)| ShelfTag {
                        name: tag_name(tag),
                        key: key.clone(),
                    })
                    .collect(),
                editions: book.editions.clone(),
            })
            .collect();
        ShelfOverview {
            fields: self.fields(),
            tags: self.tags(),
            books,
        }
    }
}
