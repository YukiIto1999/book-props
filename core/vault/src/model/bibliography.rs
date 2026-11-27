//! Values that cross the seam for bibliographic text: the people and series a book names, a
//! National Diet Library record as the runtime read it, and the revisions planned from it.

use serde::{Deserialize, Serialize};
use tsify::Tsify;

use super::Book;

/// A person named on a book, and the role they played when it is not plain authorship.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct Person {
    pub(crate) name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[tsify(optional)]
    pub(crate) role: Option<String>,
}

/// The role an author of a book played, stored apart from the author list.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct AuthorRole {
    pub(crate) name: String,
    pub(crate) role: String,
}

/// The series or label a source states for one ISBN of an edition.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct SeriesEntry {
    pub(crate) isbn: String,
    pub(crate) name: String,
}

/// One National Diet Library record as the runtime read it, before normalisation.
#[derive(Clone, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct CatalogueRecord {
    pub(crate) title: String,
    /// The catalogue forms of the creators, such as `Boswell, Dustin`.
    #[serde(default)]
    pub(crate) creators: Vec<String>,
    /// The responsibility statement, such as `Dustin Boswell, Trevor Foucher 著,角征典 訳`.
    #[serde(default)]
    #[tsify(optional)]
    pub(crate) statement: Option<String>,
    /// The publishers in record order; a distributor carries `(発売)`.
    #[serde(default)]
    pub(crate) publishers: Vec<String>,
    #[serde(default)]
    pub(crate) series: Vec<String>,
    /// The edition statement, such as `第2版`.
    #[serde(default)]
    #[tsify(optional)]
    pub(crate) edition: Option<String>,
    /// The NDC numbers the record states, each with the NDC edition it follows.
    #[serde(default)]
    pub(crate) ndc: Vec<StatedNdc>,
}

/// One NDC number a record states, such as NDC10 `007.64`, with the edition it follows; no
/// edition when the record names none (`dcndl:NDC`).
#[derive(Clone, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct StatedNdc {
    #[serde(default)]
    #[tsify(optional)]
    pub(crate) edition: Option<u32>,
    pub(crate) number: String,
}

/// A record in the stored spelling, as a product the registration screen can fill in. An author
/// entry carries a role other than plain authorship in parentheses: `島田 浩二 (訳)`.
#[derive(Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct DescribedRecord {
    pub(crate) title: String,
    pub(crate) authors: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[tsify(optional)]
    pub(crate) publisher: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[tsify(optional)]
    pub(crate) label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[tsify(optional)]
    pub(crate) series: Option<String>,
    /// The NDC number of the record, from the newest NDC edition it states.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[tsify(optional)]
    pub(crate) classification: Option<String>,
}

/// What the National Diet Library answered for one ISBN; no record when it has none.
#[derive(Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct LookupAnswer {
    pub(crate) isbn: String,
    #[serde(default)]
    #[tsify(optional)]
    pub(crate) record: Option<CatalogueRecord>,
}

/// A book with the answers fetched so far for its ISBNs.
#[derive(Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct BibliographyRequest {
    pub(crate) book: Book,
    #[serde(default)]
    pub(crate) answers: Vec<LookupAnswer>,
}

/// What finishing the lookups a book waits for leads to.
#[derive(Serialize, Tsify)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum EnrichmentPlan {
    /// The book waits for no lookup.
    None,
    /// Fetch these ISBNs, then plan again with the answers.
    Lookup {
        isbns: Vec<String>,
    },
    Write {
        revision: Box<BibliographyRevision>,
    },
}

/// The bibliographic text of one edition to write; an absent value stays as it is.
#[derive(Debug, Default, PartialEq, Eq, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct EditionText {
    pub(crate) id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[tsify(optional)]
    pub(crate) publisher: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[tsify(optional)]
    pub(crate) label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[tsify(optional)]
    pub(crate) series: Option<Vec<SeriesEntry>>,
}

/// The bibliographic text of one book to write; an absent value stays as it is.
#[derive(Debug, Default, PartialEq, Eq, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct BibliographyRevision {
    #[serde(skip_serializing_if = "Option::is_none")]
    #[tsify(optional)]
    pub(crate) title: Option<String>,
    /// The author list and the roles kept beside it; both change together.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[tsify(optional)]
    pub(crate) authors: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[tsify(optional)]
    pub(crate) author_roles: Option<Vec<AuthorRole>>,
    /// The NDC number for a book that has none; a number the book has always stays.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[tsify(optional)]
    pub(crate) classification: Option<String>,
    pub(crate) editions: Vec<EditionText>,
    /// The revision ends the lookups the book waited for, and removes their record.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    #[tsify(optional)]
    pub(crate) ends_lookups: bool,
}
