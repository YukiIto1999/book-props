//! Values that cross the seam between the Vault runtime and the catalog rules.
//!
//! The serde names are the wire contract: the TypeScript declarations are generated from them.

use serde::{Deserialize, Serialize};
use tsify::Tsify;

/// What the caller intends to do with the product it observed.
#[derive(Clone, Copy, PartialEq, Eq, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub enum Action {
    Inspect,
    Purchase,
    RecordOwnership,
    SetWish,
    ClearWish,
    CancelOwnership,
}

/// A product to match against the books stored in the Vault.
#[derive(Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct CatalogRequest {
    pub(crate) action: Action,
    pub(crate) product: Product,
    pub(crate) books: Vec<Book>,
    #[tsify(optional)]
    pub(crate) selection: Option<Selection>,
}

/// The book, and optionally the edition, the user chose for an ambiguous product.
#[derive(Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct Selection {
    pub(crate) book_id: String,
    #[tsify(optional)]
    pub(crate) edition_id: Option<String>,
}

/// Bibliographic evidence for the product.
#[derive(Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct Product {
    #[serde(default)]
    pub(crate) title: String,
    #[serde(default)]
    pub(crate) authors: Vec<String>,
    #[serde(default)]
    pub(crate) isbns: Vec<String>,
    #[tsify(optional)]
    pub(crate) label: Option<String>,
    #[serde(default)]
    pub(crate) details: Details,
}

/// A book stored in the Vault.
#[derive(Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct Book {
    pub(crate) id: String,
    pub(crate) title: String,
    pub(crate) authors: Vec<String>,
    pub(crate) wanted: bool,
    #[tsify(optional)]
    pub(crate) archived_at: Option<String>,
    pub(crate) editions: Vec<Edition>,
}

/// An edition of a stored book.
#[derive(Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct Edition {
    pub(crate) id: String,
    #[tsify(optional)]
    pub(crate) label: Option<String>,
    pub(crate) owned: bool,
    pub(crate) isbns: Vec<String>,
    #[tsify(optional)]
    pub(crate) archived_at: Option<String>,
    #[serde(default)]
    pub(crate) details: Details,
}

/// Edition facts that only fill gaps; they never identify an edition.
#[derive(Default, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct Details {
    #[tsify(optional)]
    pub(crate) publisher: Option<String>,
    #[tsify(optional)]
    pub(crate) published_on: Option<String>,
    #[tsify(optional)]
    pub(crate) cover: Option<String>,
    #[tsify(optional)]
    pub(crate) purchased_on: Option<String>,
    #[tsify(optional)]
    pub(crate) purchased_from: Option<String>,
}

/// Values the product adds to an edition that lacks them.
#[derive(Default, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct EditionPatch {
    #[serde(skip_serializing_if = "Vec::is_empty")]
    #[tsify(optional)]
    pub(crate) isbns: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) publisher: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) published_on: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) cover: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) purchased_on: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) purchased_from: Option<String>,
}

/// How the product relates to what the user already owns.
#[derive(Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub enum Ownership {
    SameEdition,
    OtherEdition,
    UnknownEdition,
    Unowned,
    Undetermined,
}

/// What to confirm with the user, or what to write.
#[derive(Serialize, Tsify)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Decision {
    None,
    InvalidIsbn {
        input: String,
    },
    InsufficientEvidence,
    ConflictingEvidence,
    ChooseBook {
        book_ids: Vec<String>,
    },
    ChooseEdition {
        edition_ids: Vec<String>,
    },
    CreateBook {
        wanted: bool,
        record_edition: bool,
    },
    AddEdition {
        wanted_before: bool,
        wanted_after: bool,
    },
    Update {
        wanted_before: bool,
        wanted_after: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        owned_before: Option<bool>,
        #[serde(skip_serializing_if = "Option::is_none")]
        owned_after: Option<bool>,
        #[serde(skip_serializing_if = "Option::is_none")]
        edition_patch: Option<Box<EditionPatch>>,
    },
}

/// The catalog's judgement of a product, without any Vault I/O.
#[derive(Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct Outcome {
    pub(crate) ownership: Ownership,
    pub(crate) wanted: bool,
    pub(crate) book_id: Option<String>,
    pub(crate) edition_id: Option<String>,
    pub(crate) decision: Decision,
    pub(crate) isbns: Vec<String>,
}

impl Outcome {
    pub(crate) fn undetermined(decision: Decision) -> Self {
        Self {
            ownership: Ownership::Undetermined,
            wanted: false,
            book_id: None,
            edition_id: None,
            decision,
            isbns: Vec::new(),
        }
    }
}

/// ISBNs in canonical ISBN-13 form, or the first input that is not an ISBN.
#[derive(Serialize, Tsify)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum IsbnList {
    Valid { values: Vec<String> },
    Invalid { input: String },
}
