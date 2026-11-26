//! Values that cross the seam for the portable library: the JSON document that carries book notes
//! between vaults, and importing it.

use serde::{Deserialize, Serialize};
use tsify::Tsify;

/// One book note in the portable library. Importing names the file from `bookId` alone and never
/// carries the path the note had.
#[derive(Clone, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct PortableNote {
    pub(crate) book_id: String,
    pub(crate) markdown: String,
}

/// The notes read from a portable library, up to the first problem with the document itself.
#[derive(Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct PortableEnvelope {
    pub(crate) notes: Vec<PortableNote>,
    /// What is wrong with the document. Problems in the notes read before it come first.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[tsify(optional)]
    pub(crate) problem: Option<PortableProblem>,
}

/// What makes a portable library unusable. Positions count notes from zero.
#[derive(Debug, PartialEq, Serialize, Tsify)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum PortableProblem {
    NotJson,
    /// The library, or the note at `position`, is not a JSON object.
    NotObject {
        #[serde(skip_serializing_if = "Option::is_none")]
        #[tsify(optional)]
        position: Option<usize>,
    },
    /// The library, or the note at `position`, has other members than `keys`.
    UnexpectedKeys {
        #[serde(skip_serializing_if = "Option::is_none")]
        #[tsify(optional)]
        position: Option<usize>,
        keys: Vec<String>,
    },
    WrongFormat {
        format: String,
    },
    VersionNotInteger,
    UnsupportedVersion {
        version: f64,
    },
    NotesNotArray,
    NoteNotText {
        position: usize,
    },
    /// The note is not a readable book note.
    UnreadableNote {
        position: usize,
    },
    /// The note still records purchases applied to it.
    CarriesPurchases {
        position: usize,
    },
    /// The note's book id is not the `bookId` it came with.
    InconsistentId {
        position: usize,
    },
    DuplicateBook {
        id: String,
    },
    DuplicateEdition {
        id: String,
    },
}

/// What the runtime read from each note of a library, in order.
#[derive(Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct PortableNotes {
    pub(crate) notes: Vec<NoteFacts>,
}

/// What the runtime read from one note.
#[derive(Deserialize, Tsify)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum NoteFacts {
    Unreadable,
    Readable {
        /// The `bookId` an imported note came with; absent when exporting.
        #[tsify(optional)]
        declared_id: Option<String>,
        book_id: String,
        edition_ids: Vec<String>,
        /// The note records purchases applied to it.
        purchases: bool,
    },
}

/// Whether the notes may travel together.
#[derive(Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct PortableVerdict {
    /// The first problem, in the notes' order.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[tsify(optional)]
    pub(crate) problem: Option<PortableProblem>,
}

/// Checked notes to write as a portable library.
#[derive(Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct PortableExport {
    pub(crate) notes: Vec<PortableNote>,
}

/// The library to import, and the book notes the scope holds now.
#[derive(Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct ImportRequest {
    pub(crate) desired: Vec<PortableNote>,
    pub(crate) present: Vec<PresentNote>,
}

/// A readable book note in the scope.
#[derive(Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct PresentNote {
    pub(crate) book_id: String,
    pub(crate) markdown: String,
    /// The note records an edition move that has not settled.
    pub(crate) moving: bool,
}

/// What importing does with the scope as it is now.
#[derive(Serialize, Tsify)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ImportPlan {
    /// The scope holds a book the library does not carry as it is, a book twice, or a move.
    Conflict,
    /// Create the books the scope lacks, in the library's order.
    Ready { missing: Vec<String> },
}
