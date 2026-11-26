//! The fields the shelf reads from a book, and the values each field holds.

use super::Book;
use crate::model::{CustomField, Edition, RangeKind, ShelfRecord};
use crate::text::date_key;

/// A field named by a key.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Field<'k> {
    Title,
    Author,
    FinishedOn,
    Label,
    Isbn,
    Publisher,
    PublishedOn,
    Cover,
    PurchasedOn,
    PurchasedFrom,
    Custom(&'k str),
    /// A key that names no field; it holds no values.
    Unknown,
}

/// The standard fields and their keys, in the order the shelf shows them.
pub(super) const STANDARD: [(&str, Field<'static>); 10] = [
    ("title", Field::Title),
    ("author", Field::Author),
    ("finishedOn", Field::FinishedOn),
    ("label", Field::Label),
    ("isbn", Field::Isbn),
    ("publisher", Field::Publisher),
    ("publishedOn", Field::PublishedOn),
    ("cover", Field::Cover),
    ("purchasedOn", Field::PurchasedOn),
    ("purchasedFrom", Field::PurchasedFrom),
];

/// The edition fields a search reads.
pub(super) const EDITION_TEXTS: [Field<'static>; 6] = [
    Field::Label,
    Field::Publisher,
    Field::PublishedOn,
    Field::PurchasedOn,
    Field::PurchasedFrom,
    Field::Cover,
];

/// A value a field holds: dates as `YYYY-MM-DD` text.
pub(super) enum Value {
    Number(f64),
    Text(String),
}

fn text(value: &str) -> Value {
    Value::Text(value.to_owned())
}

fn custom(record: &ShelfRecord, name: &str) -> Vec<Value> {
    let Some(value) = record
        .custom_fields
        .iter()
        .find(|value| value.field.name() == name)
    else {
        return Vec::new();
    };
    match &value.field {
        CustomField::Date { value: day, .. } => {
            date_key(day).map(Value::Text).into_iter().collect()
        }
        CustomField::Number { value: number, .. } => vec![Value::Number(*number)],
        _ => vec![text(&value.text)],
    }
}

impl<'k> Field<'k> {
    pub(super) fn parse(key: &'k str) -> Self {
        STANDARD.iter().find(|(name, _)| *name == key).map_or_else(
            || {
                key.strip_prefix("custom:")
                    .map_or(Self::Unknown, Self::Custom)
            },
            |(_, field)| *field,
        )
    }

    /// Standard date fields take a range of dates.
    pub(super) const fn range(self) -> Option<RangeKind> {
        match self {
            Self::FinishedOn | Self::PublishedOn | Self::PurchasedOn => Some(RangeKind::Date),
            _ => None,
        }
    }

    /// The text an edition stores for this field.
    pub(super) fn detail(self, edition: &Edition) -> Option<&str> {
        let details = &edition.details;
        match self {
            Self::Label => edition.label.as_deref(),
            Self::Publisher => details.publisher.as_deref(),
            Self::PublishedOn => details.published_on.as_deref(),
            Self::Cover => details.cover.as_deref(),
            Self::PurchasedOn => details.purchased_on.as_deref(),
            Self::PurchasedFrom => details.purchased_from.as_deref(),
            _ => None,
        }
    }

    /// The values the book holds in this field; edition fields read the current editions.
    pub(super) fn values(self, book: &Book) -> Vec<Value> {
        let record = &book.record;
        match self {
            Self::Title => vec![text(&record.title)],
            Self::Author => record.authors.iter().map(|name| text(name)).collect(),
            Self::FinishedOn => record
                .finished_on
                .as_deref()
                .and_then(date_key)
                .map(Value::Text)
                .into_iter()
                .collect(),
            Self::Isbn => book
                .current()
                .flat_map(|edition| &edition.isbns)
                .map(|isbn| text(isbn))
                .collect(),
            Self::PublishedOn | Self::PurchasedOn => book
                .current()
                .filter_map(|edition| self.detail(edition).and_then(date_key))
                .map(Value::Text)
                .collect(),
            Self::Label | Self::Publisher | Self::Cover | Self::PurchasedFrom => book
                .current()
                .filter_map(|edition| self.detail(edition))
                .filter(|value| !value.is_empty())
                .map(text)
                .collect(),
            Self::Custom(name) => custom(record, name),
            Self::Unknown => Vec::new(),
        }
    }
}
