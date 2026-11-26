//! Values that cross the seam between the Vault runtime and the catalog rules.
//!
//! The serde names are the wire contract: the TypeScript declarations are generated from them.

mod management;
mod portable;
mod shelf;

pub use management::{
    BookOptions, BookStep, BooksRequest, CopiesRequest, CopyPlace, CustomField, EditionOptions,
    ManagementCommand, ManagementPlan, ManagementRequest, MissingCopies, MoveBackup, MoveCopy,
    MoveMarker, MovePlan, MoveRequest, MoveSource, MoveStage, OptionsRequest, RestoreRequest,
    RestoreTargets, SettledShelf, ShelfBook, StepRequest,
};
pub use portable::{
    ImportPlan, ImportRequest, NoteFacts, PortableEnvelope, PortableExport, PortableNote,
    PortableNotes, PortableProblem, PortableVerdict, PresentNote,
};
use serde::{Deserialize, Serialize};
pub use shelf::{
    OwnershipFilter, RangeKind, ShelfBound, ShelfField, ShelfOverview, ShelfQuery, ShelfRange,
    ShelfRecord, ShelfRequest, ShelfSelection, ShelfTag, ShelfValue, ShelfView, WishFilter,
};
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
    /// Purchases already applied to this book, kept to recognise a retried request.
    pub(crate) applied_purchases: Vec<Receipt>,
    /// The edition move recorded on this book that has not settled.
    #[tsify(optional)]
    pub(crate) pending_move: Option<MoveMarker>,
    /// Fields the user added to the book; only management needs them.
    #[serde(default)]
    pub(crate) custom_fields: Vec<CustomField>,
}

impl Book {
    pub(crate) fn edition(&self, id: &str) -> Option<&Edition> {
        self.editions.iter().find(|edition| edition.id == id)
    }

    pub(crate) fn has_edition(&self, id: &str) -> bool {
        self.edition(id).is_some()
    }

    pub(crate) const fn moving(&self) -> bool {
        self.pending_move.is_some()
    }
}

/// An edition of a stored book.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct Edition {
    pub(crate) id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[tsify(optional)]
    pub(crate) label: Option<String>,
    pub(crate) owned: bool,
    pub(crate) isbns: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[tsify(optional)]
    pub(crate) archived_at: Option<String>,
    #[serde(default)]
    pub(crate) details: Details,
}

/// Edition facts that only fill gaps; they never identify an edition.
#[derive(Clone, Default, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct Details {
    #[serde(skip_serializing_if = "Option::is_none")]
    #[tsify(optional)]
    pub(crate) publisher: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[tsify(optional)]
    pub(crate) published_on: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[tsify(optional)]
    pub(crate) cover: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[tsify(optional)]
    pub(crate) purchased_on: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
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
///
/// A decision that asks the user to pick a book or an edition lists the picks the action allows:
/// the runtime only renders them.
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
    /// The product names no book; the user may pick any unarchived book.
    InsufficientEvidence {
        book_ids: Vec<String>,
        /// The action may record the product as a book not stored yet.
        new_book: bool,
    },
    ConflictingEvidence,
    /// Several books match the product; the user may pick an unarchived one among them.
    ChooseBook {
        book_ids: Vec<String>,
        /// The action may record the product as a book not stored yet.
        new_book: bool,
    },
    /// The book's unarchived editions do not settle on one; the user may pick one of them.
    ChooseEdition {
        edition_ids: Vec<String>,
        /// The action may record the product as an edition the book does not hold yet.
        new_edition: bool,
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

/// The idempotency key the browser attaches to a purchase.
#[derive(Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct PurchaseKey {
    pub(crate) client_id: String,
    pub(crate) request_id: String,
    /// Milliseconds since the epoch; `null` when JavaScript held no finite number.
    #[tsify(type = "number")]
    pub(crate) issued_at: Option<f64>,
}

/// The record that a purchase request was applied, as stored with the book it changed. Recognising
/// a retried request needs no time, so the stored time stays with the runtime.
#[derive(Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct Receipt {
    pub(crate) request_id: String,
    pub(crate) client_id: String,
    /// The runtime's fingerprint of the request contents.
    pub(crate) input_hash: String,
    pub(crate) book_id: String,
    pub(crate) edition_id: String,
}

/// The record to store for a purchase this change applies.
#[derive(Clone, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct ReceiptWrite {
    pub(crate) request_id: String,
    pub(crate) client_id: String,
    pub(crate) input_hash: String,
    /// When the purchase was applied, in milliseconds since the epoch: the runtime clock it sent.
    pub(crate) applied_at_ms: i64,
    pub(crate) book_id: String,
    pub(crate) edition_id: String,
}

/// Whether an operation may start, checked before the catalog is read.
#[derive(Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct Admission {
    pub(crate) action: Action,
    #[tsify(optional)]
    pub(crate) purchase: Option<PurchaseKey>,
    /// The runtime clock in milliseconds since the epoch.
    pub(crate) now: i64,
}

/// One read of the catalog while changing it for a product.
#[derive(Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct ChangeRequest {
    pub(crate) catalog: CatalogRequest,
    #[tsify(optional)]
    pub(crate) purchase: Option<PurchaseKey>,
    /// The runtime's fingerprint of the request contents; present with a purchase key.
    #[tsify(optional)]
    pub(crate) input_hash: Option<String>,
    /// The revision planned on the first read. Absent on the first read itself.
    #[tsify(optional)]
    pub(crate) expected: Option<String>,
    /// The runtime clock in milliseconds since the epoch, stamped on a new receipt.
    pub(crate) now: i64,
    /// The id a new book takes.
    pub(crate) new_book_id: String,
    /// The id a new edition takes.
    pub(crate) new_edition_id: String,
}

/// What the runtime does with one read of the catalog.
#[derive(Serialize, Tsify)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[tsify(missing_as_null)]
pub enum ChangePlan {
    /// The same request was applied before.
    Replayed {
        book_id: String,
        edition_id: String,
    },
    Conflict,
    Unavailable,
    /// Nothing to write; the outcome only reports the catalog.
    Observed {
        outcome: Outcome,
    },
    /// The user must resolve the outcome before anything is written.
    NeedsInput {
        outcome: Outcome,
    },
    Write(Box<WritePlan>),
}

/// The book or change to write, and the revision that must still hold when it is written.
#[derive(Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct WritePlan {
    pub(crate) revision: String,
    pub(crate) book_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[tsify(optional)]
    pub(crate) edition_id: Option<String>,
    /// The wish, edition, and receipt the book holds after the write.
    pub(crate) change: BookWrite,
    /// The book note to create; absent when an existing book changes.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[tsify(optional)]
    pub(crate) new_book: Option<NewBook>,
}

/// A book note to create.
#[derive(Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct NewBook {
    pub(crate) id: String,
    pub(crate) title: String,
    pub(crate) authors: Vec<String>,
    pub(crate) wanted: bool,
    pub(crate) editions: Vec<EditionWrite>,
    pub(crate) applied_purchases: Vec<ReceiptWrite>,
}

/// The wish, and optionally the edition and receipt, to write to one book.
#[derive(Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct BookWrite {
    pub(crate) wanted: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[tsify(optional)]
    pub(crate) edition: Option<EditionWrite>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[tsify(optional)]
    pub(crate) receipt: Option<ReceiptWrite>,
}

/// An edition to add, or the ownership and blank values to write to a stored edition.
#[derive(Clone, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct EditionWrite {
    pub(crate) id: String,
    pub(crate) owned: bool,
    pub(crate) isbns: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[tsify(optional)]
    pub(crate) label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[tsify(optional)]
    pub(crate) publisher: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[tsify(optional)]
    pub(crate) published_on: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[tsify(optional)]
    pub(crate) cover: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[tsify(optional)]
    pub(crate) purchased_on: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[tsify(optional)]
    pub(crate) purchased_from: Option<String>,
}

/// Whether a purchase was applied before, asked after the browser lost the answer.
#[derive(Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct ReconcileRequest {
    pub(crate) purchase: PurchaseKey,
    pub(crate) input_hash: String,
    pub(crate) books: Vec<Book>,
}

/// What the catalog records about a purchase request.
#[derive(Serialize, Tsify)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Reconciliation {
    Replayed {
        book_id: String,
        edition_id: String,
    },
    Conflict,
    /// No book records the request.
    Unknown,
}

/// When each stored receipt was applied, to check against the retention period.
#[derive(Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct ExpiryRequest {
    /// Milliseconds since the epoch, in the runtime's order of receipts; `null` when the runtime
    /// cannot read the stored time.
    #[tsify(type = "(number | null)[]")]
    pub(crate) applied_at_ms: Vec<Option<f64>>,
    /// The runtime clock in milliseconds since the epoch.
    pub(crate) now: i64,
}

/// For each receipt in request order, whether it is past the retention period.
#[derive(Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct ReceiptExpiry {
    pub(crate) expired: Vec<bool>,
}
