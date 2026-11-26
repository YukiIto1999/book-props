//! Values that cross the seam for managing stored books and moving editions between them.

use serde::{Deserialize, Serialize};
use tsify::Tsify;

use super::{Book, Edition};

/// A field the user added to a book: its name, kind, and value.
#[derive(Clone, PartialEq, Serialize, Deserialize, Tsify)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum CustomField {
    Text {
        name: String,
        value: String,
    },
    Date {
        name: String,
        value: String,
    },
    Number {
        name: String,
        value: f64,
    },
    Boolean {
        name: String,
        value: bool,
    },
    Choice {
        name: String,
        value: String,
        choices: Vec<String>,
    },
}

impl CustomField {
    pub(crate) fn name(&self) -> &str {
        match self {
            Self::Text { name, .. }
            | Self::Date { name, .. }
            | Self::Number { name, .. }
            | Self::Boolean { name, .. }
            | Self::Choice { name, .. } => name,
        }
    }
}

/// An edition move recorded on the book the edition leaves.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct MoveMarker {
    pub(crate) edition_id: String,
    pub(crate) destination_id: String,
    /// The runtime's digest of the edition's content when the move began.
    pub(crate) digest: String,
    /// The moved edition, recorded once the source no longer holds it.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[tsify(optional)]
    pub(crate) backup: Option<Box<MoveBackup>>,
}

/// The content of a moved edition, kept on the source while the move settles.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct MoveBackup {
    /// The content exactly as recorded; two markers are the same move only with the same text.
    pub(crate) signature: String,
    pub(crate) edition: Edition,
}

/// A management command the user gave for one book.
#[derive(Deserialize, Tsify)]
#[serde(
    tag = "action",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ManagementCommand {
    EditEdition {
        book_id: String,
        baseline: Box<Edition>,
        value: Box<Edition>,
    },
    AddEdition {
        book_id: String,
        value: Box<Edition>,
    },
    UpdateCustomField {
        book_id: String,
        #[tsify(optional)]
        baseline: Option<CustomField>,
        #[tsify(optional)]
        value: Option<CustomField>,
    },
    Archive {
        book_id: String,
        #[tsify(optional)]
        edition_id: Option<String>,
    },
    Restore {
        book_id: String,
        #[tsify(optional)]
        edition_id: Option<String>,
    },
    Move {
        book_id: String,
        edition_id: String,
        destination_id: String,
    },
    RestoreMoveCopy {
        book_id: String,
        edition_id: String,
    },
    RecoverMove {
        book_id: String,
    },
    CancelMove {
        book_id: String,
    },
}

impl ManagementCommand {
    pub(crate) fn book_id(&self) -> &str {
        match self {
            Self::EditEdition { book_id, .. }
            | Self::AddEdition { book_id, .. }
            | Self::UpdateCustomField { book_id, .. }
            | Self::Archive { book_id, .. }
            | Self::Restore { book_id, .. }
            | Self::Move { book_id, .. }
            | Self::RestoreMoveCopy { book_id, .. }
            | Self::RecoverMove { book_id }
            | Self::CancelMove { book_id } => book_id,
        }
    }
}

/// A command and the books it was read with.
#[derive(Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct ManagementRequest {
    pub(crate) command: ManagementCommand,
    pub(crate) books: Vec<Book>,
    /// The runtime clock as an archive records it; the core never reads or formats time.
    pub(crate) stamp: String,
    /// The copy saved outside the Vault for the edition a `restoreMoveCopy` command names.
    #[tsify(optional)]
    pub(crate) copy: Option<MoveCopy>,
}

/// An edition saved outside the Vault while it moved between two books.
#[derive(Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct MoveCopy {
    pub(crate) source_id: String,
    pub(crate) destination_id: String,
    pub(crate) edition: Edition,
}

/// What a management command leads to.
#[derive(Serialize, Tsify)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ManagementPlan {
    Conflict,
    /// An edition move has not settled; nothing changes until it does.
    Pending,
    /// One change to the book the command names.
    Write {
        step: BookStep,
    },
    /// The stages of an edition move, in order.
    Move {
        stages: Vec<MoveStage>,
    },
}

/// A change to one book note. The runtime checks it against the latest content of the note just
/// before writing.
#[derive(Clone, Serialize, Deserialize, Tsify)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum BookStep {
    /// Archive or restore the book, or one of its editions.
    SetArchivedAt {
        #[serde(skip_serializing_if = "Option::is_none")]
        #[tsify(optional)]
        edition_id: Option<String>,
        /// The archive time read with the command; the write applies only while it holds.
        #[serde(skip_serializing_if = "Option::is_none")]
        #[tsify(optional)]
        before: Option<String>,
        /// The archive time to write; absent to restore.
        #[serde(skip_serializing_if = "Option::is_none")]
        #[tsify(optional)]
        archived_at: Option<String>,
    },
    AddEdition {
        edition: Box<Edition>,
    },
    EditEdition {
        baseline: Box<Edition>,
        edition: Box<Edition>,
    },
    UpdateCustomField {
        #[serde(skip_serializing_if = "Option::is_none")]
        #[tsify(optional)]
        baseline: Option<CustomField>,
        #[serde(skip_serializing_if = "Option::is_none")]
        #[tsify(optional)]
        value: Option<CustomField>,
    },
    /// Put back an edition saved outside the Vault.
    RestoreEdition {
        edition: Box<Edition>,
    },
    /// Record on the source that one of its editions starts moving.
    MarkMove,
    /// Write the moving edition to the destination.
    CopyEdition {
        edition: Box<Edition>,
    },
    /// Remove the edition from the source and record its content with the move.
    RecordBackup {
        marker: MoveMarker,
    },
    /// Settle the move on the source once the edition left it.
    ClearMove {
        marker: MoveMarker,
    },
    /// Settle the move on the source by keeping the edition there.
    CancelMove {
        marker: MoveMarker,
    },
}

/// The latest content of a book note and the change about to be written to it.
#[derive(Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct StepRequest {
    pub(crate) latest: Book,
    pub(crate) step: BookStep,
}

/// One stage of an edition move. The runtime runs the stages in order and stops at the first that
/// does not land.
#[derive(Clone, Copy, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub enum MoveStage {
    /// Save the edition's content outside the Vault before a note changes.
    KeepCopy,
    /// `BookStep::MarkMove` on the source.
    MarkMove,
    /// Continue from the marker on the source: `planMove`.
    Resume,
    /// `BookStep::CopyEdition` on the destination.
    CopyEdition,
    /// `BookStep::RecordBackup` on the source.
    RecordBackup,
    /// `BookStep::ClearMove` on the source.
    ClearMove,
    /// `BookStep::CancelMove` on the source.
    CancelMove,
}

/// The books as read while resuming a move, and the source as read again just now.
#[derive(Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct MoveRequest {
    pub(crate) books: Vec<Book>,
    /// The source as the move knew it; its marker names the move.
    pub(crate) source: Book,
    /// The latest content of the source note.
    pub(crate) latest: Book,
}

/// How a recorded move continues.
#[derive(Serialize, Tsify)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum MovePlan {
    /// The move cannot continue now; the marker stays for a later attempt.
    Pending,
    Continue {
        /// Where the edition's content comes from.
        from: MoveSource,
        stages: Vec<MoveStage>,
    },
}

/// Where the content of a moving edition is read from.
#[derive(Clone, Copy, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub enum MoveSource {
    /// The edition still in the source note.
    Source,
    /// The backup recorded with the marker after the source let the edition go.
    Backup,
}

/// The books the shelf shows.
#[derive(Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct BooksRequest {
    pub(crate) books: Vec<Book>,
}

/// How unsettled moves change what the shelf shows.
#[derive(Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct SettledShelf {
    /// Some move has not settled.
    pub(crate) moving: bool,
    /// The books whose editions the shelf shows differently from their notes.
    pub(crate) books: Vec<ShelfBook>,
}

/// A book whose shelf entry differs from its note while a move settles.
#[derive(Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct ShelfBook {
    pub(crate) id: String,
    /// Editions still being copied here, shown only on the source until the move settles.
    pub(crate) hidden: Vec<String>,
    /// Show the edition recorded with this book's marker, which the note no longer holds.
    pub(crate) backup: bool,
}

/// Editions saved outside the Vault, to check against the books.
#[derive(Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct CopiesRequest {
    pub(crate) books: Vec<Book>,
    pub(crate) edition_ids: Vec<String>,
}

/// For each saved edition in request order, whether no book holds or is moving it.
#[derive(Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct MissingCopies {
    pub(crate) missing: Vec<bool>,
}

/// The books of the moves whose editions were saved outside the Vault.
#[derive(Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct RestoreRequest {
    pub(crate) books: Vec<Book>,
    pub(crate) copies: Vec<CopyPlace>,
}

/// The two books of the move an edition was saved outside the Vault for.
#[derive(Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct CopyPlace {
    pub(crate) source_id: String,
    pub(crate) destination_id: String,
}

/// For each saved copy in request order, the books it may go back to: its source, then its
/// destination.
#[derive(Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct RestoreTargets {
    pub(crate) targets: Vec<Vec<String>>,
}

/// The book to offer management commands for, and the books read with it.
#[derive(Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct OptionsRequest {
    pub(crate) books: Vec<Book>,
    pub(crate) book_id: String,
}

/// Which management commands the user may give for one book.
#[derive(Serialize, Tsify)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum BookOptions {
    /// No book has the id.
    Missing,
    /// The book records an unsettled move, which can only be resumed or cancelled.
    Moving,
    /// The book is archived and can only be restored.
    Archived,
    /// The book can be archived and take custom fields and editions; each of its editions in note
    /// order lists what it takes.
    Open { editions: Vec<EditionOptions> },
}

/// What one edition of an open book takes.
#[derive(Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct EditionOptions {
    pub(crate) id: String,
    /// The edition is archived and can only be restored; otherwise it can be edited and archived.
    pub(crate) archived: bool,
    /// The books the edition may move to.
    pub(crate) destinations: Vec<String>,
}
