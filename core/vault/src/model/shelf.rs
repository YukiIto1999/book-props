//! Values that cross the seam for the shelf: the books it shows, a query over them, and what the
//! query selects.

use serde::{Deserialize, Serialize};
use tsify::Tsify;
use wasm_bindgen::prelude::wasm_bindgen;

use super::{CustomField, Edition};

#[wasm_bindgen(typescript_custom_section)]
const FIELD_KEY: &str = r#"
/** A field the shelf shows, sorts by, or limits to a range: a standard field, or `custom:` and the name of a field the user added. */
export type FieldKey =
  | "title"
  | "author"
  | "finishedOn"
  | "label"
  | "isbn"
  | "publisher"
  | "publishedOn"
  | "cover"
  | "purchasedOn"
  | "purchasedFrom"
  | `custom:${string}`;
"#;

/// The books one shelf shows, in the runtime's order.
#[derive(Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct ShelfRequest {
    pub(crate) books: Vec<ShelfRecord>,
}

/// A book as the shelf reads it.
#[derive(Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct ShelfRecord {
    /// Where the runtime keeps the book; it orders books that tie on everything else.
    pub(crate) path: String,
    pub(crate) title: String,
    pub(crate) authors: Vec<String>,
    #[serde(default)]
    pub(crate) wanted: bool,
    #[tsify(optional)]
    pub(crate) archived_at: Option<String>,
    #[tsify(optional)]
    pub(crate) reading_status: Option<String>,
    #[tsify(optional)]
    pub(crate) finished_on: Option<String>,
    #[serde(default)]
    pub(crate) tags: Vec<String>,
    #[serde(default)]
    pub(crate) custom_fields: Vec<ShelfValue>,
    pub(crate) editions: Vec<Edition>,
}

/// A field the user added, with the text the runtime shows for its value. Search matches that
/// text, and sorting compares it unless the value is a number or a date.
#[derive(Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct ShelfValue {
    pub(crate) field: CustomField,
    pub(crate) text: String,
}

/// Which books the shelf shows, and in what order.
#[derive(Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct ShelfQuery {
    /// Words a book must all match: a word with `#` names a tag, an ISBN names an edition, and
    /// any other word matches part of a field.
    pub(crate) text: String,
    pub(crate) ownership: OwnershipFilter,
    pub(crate) wish: WishFilter,
    /// `any`, `unset`, or the reading status a book must have.
    pub(crate) reading: String,
    /// Tags a book must all have, as entered.
    pub(crate) tags: Vec<String>,
    #[tsify(optional)]
    pub(crate) author: Option<String>,
    #[tsify(optional)]
    pub(crate) publisher: Option<String>,
    #[tsify(optional)]
    pub(crate) range: Option<ShelfRange>,
    #[tsify(type = "FieldKey")]
    pub(crate) sort: String,
    pub(crate) descending: bool,
}

/// Whether a book must hold a current edition the user owns.
#[derive(Clone, Copy, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub enum OwnershipFilter {
    Any,
    Owned,
    Unowned,
}

/// Whether a book must be on the wish list.
#[derive(Clone, Copy, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub enum WishFilter {
    Any,
    Wanted,
    Unwanted,
}

/// The values of one field a book must have one of.
#[derive(Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct ShelfRange {
    #[tsify(type = "FieldKey")]
    pub(crate) key: String,
    pub(crate) from: ShelfBound,
    pub(crate) through: ShelfBound,
}

/// One end of a range as entered. An empty text leaves that end open; a number field compares
/// the number the runtime read from the text, and no number matches no value.
#[derive(Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct ShelfBound {
    pub(crate) text: String,
    #[tsify(optional)]
    pub(crate) number: Option<f64>,
}

/// What the shelf offers before any query: its fields, its tags, and each book's view.
#[derive(Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct ShelfOverview {
    /// Standard fields first, then the fields the user added, in the order the shelf shows them.
    pub(crate) fields: Vec<ShelfField>,
    /// The distinct tags of the current books, in the order they first appear.
    pub(crate) tags: Vec<ShelfTag>,
    /// For each requested book in order, its tags and current editions.
    pub(crate) books: Vec<ShelfView>,
}

/// A field the shelf can show and sort by.
#[derive(Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct ShelfField {
    #[tsify(type = "FieldKey")]
    pub(crate) key: String,
    /// The name the user gave the field; absent for a standard field.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[tsify(optional)]
    pub(crate) name: Option<String>,
    /// How a range of the field is entered; absent when the field takes no range.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[tsify(optional)]
    pub(crate) range: Option<RangeKind>,
}

/// The kind of value a range is entered as.
#[derive(Clone, Copy, PartialEq, Eq, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub enum RangeKind {
    Date,
    Number,
}

/// A tag as the shelf shows it, and the key that tells tags apart.
#[derive(Clone, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct ShelfTag {
    pub(crate) name: String,
    pub(crate) key: String,
}

/// How the shelf shows one book.
#[derive(Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct ShelfView {
    /// The book's tags in its order.
    pub(crate) tags: Vec<ShelfTag>,
    /// Positions of the editions the book currently holds.
    pub(crate) editions: Vec<usize>,
}

/// The books a query selects, in order.
#[derive(Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct ShelfSelection {
    /// Positions of the selected books in the request.
    pub(crate) books: Vec<usize>,
    /// The key of each tag in the query, in its order.
    pub(crate) tags: Vec<String>,
}
