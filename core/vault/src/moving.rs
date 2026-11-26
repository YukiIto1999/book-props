//! Moving an edition from one book to another.
//!
//! The source records a marker before anything else changes, the destination receives the
//! edition, the source lets it go while recording its content with the marker, and the marker is
//! cleared last. Whatever stage was interrupted, the markers found later tell how to continue or
//! cancel, and the shelf shows each edition once in the meantime.

use crate::management::collides;
use crate::model::{
    Book, BookStep, BooksRequest, CopiesRequest, ManagementPlan, MissingCopies, MoveMarker,
    MovePlan, MoveRequest, MoveSource, MoveStage, SettledShelf, ShelfBook,
};

/// A move needs two different unarchived books, an unarchived edition that no third book holds,
/// and a destination without another edition sharing its ISBNs.
pub(crate) fn start(
    books: &[Book],
    source: &Book,
    edition_id: &str,
    destination_id: &str,
) -> ManagementPlan {
    let destination = books.iter().find(|book| book.id == destination_id);
    let allowed = match (destination, source.edition(edition_id)) {
        (Some(destination), Some(edition)) => {
            source.id != destination.id
                && source.archived_at.is_none()
                && edition.archived_at.is_none()
                && destination.archived_at.is_none()
                && !collides(destination, edition)
                && !held_elsewhere(books, source, edition_id)
        }
        _ => false,
    };
    if !allowed {
        return ManagementPlan::Conflict;
    }
    ManagementPlan::Move {
        stages: vec![MoveStage::KeepCopy, MoveStage::MarkMove, MoveStage::Resume],
    }
}

/// A book other than the source holds the edition.
fn held_elsewhere(books: &[Book], source: &Book, edition_id: &str) -> bool {
    books
        .iter()
        .any(|book| book.id != source.id && book.has_edition(edition_id))
}

/// Cancelling keeps the edition on the source, putting back the recorded content if the source
/// already let it go. It waits while another book holds the edition.
pub(crate) fn cancel(books: &[Book], source: &Book) -> ManagementPlan {
    let Some(marker) = &source.pending_move else {
        return ManagementPlan::Conflict;
    };
    if held_elsewhere(books, source, &marker.edition_id) {
        return ManagementPlan::Pending;
    }
    let stages = if marker.backup.is_some() {
        vec![MoveStage::KeepCopy, MoveStage::CancelMove]
    } else {
        vec![MoveStage::CancelMove]
    };
    ManagementPlan::Move { stages }
}

/// Decides how the move recorded on the source continues.
///
/// The move waits while the destination is missing, archived or moving itself, while the source
/// is archived or no longer records the same move, and while the edition is archived. The edition
/// comes from the source until the source lets it go, then from the recorded backup; a source
/// holding both is inconsistent and waits too.
#[must_use]
pub fn plan_move(request: &MoveRequest) -> MovePlan {
    let MoveRequest {
        books,
        source,
        latest,
    } = request;
    let Some(marker) = &source.pending_move else {
        return MovePlan::Pending;
    };
    let destination_open = books
        .iter()
        .find(|book| book.id == marker.destination_id)
        .is_some_and(|book| book.archived_at.is_none() && !book.moving());
    let source_open = source.archived_at.is_none()
        && latest.archived_at.is_none()
        && latest.pending_move.as_ref() == Some(marker);
    if !destination_open || !source_open {
        return MovePlan::Pending;
    }
    let (edition, from) = match (latest.edition(&marker.edition_id), &marker.backup) {
        (Some(edition), None) => (edition, MoveSource::Source),
        (None, Some(backup)) => (&backup.edition, MoveSource::Backup),
        _ => return MovePlan::Pending,
    };
    if edition.archived_at.is_some() {
        return MovePlan::Pending;
    }
    let mut stages = vec![MoveStage::KeepCopy, MoveStage::CopyEdition];
    if matches!(from, MoveSource::Source) {
        stages.push(MoveStage::RecordBackup);
    }
    stages.push(MoveStage::ClearMove);
    MovePlan::Continue { from, stages }
}

/// Whether a step that settles the move may be written to the latest source: the source still
/// records the same move, and the edition is where the step expects it.
pub(crate) fn settles(book: &Book, step: &BookStep, marker: &MoveMarker) -> bool {
    if book.pending_move.as_ref() != Some(marker) {
        return false;
    }
    let held = book.has_edition(&marker.edition_id);
    match step {
        BookStep::ClearMove { .. } => !held,
        BookStep::CancelMove { .. } => match &marker.backup {
            Some(backup) => !held && !collides(book, &backup.edition),
            None => held,
        },
        _ => true,
    }
}

/// Which books the shelf shows differently while moves settle: an edition being copied shows only
/// on its source, and a source that already let it go shows the recorded content.
#[must_use]
pub fn settle_shelf(request: &BooksRequest) -> SettledShelf {
    let markers: Vec<&MoveMarker> = request
        .books
        .iter()
        .filter_map(|book| book.pending_move.as_ref())
        .collect();
    let books = request
        .books
        .iter()
        .filter_map(|book| {
            let hidden: Vec<String> = markers
                .iter()
                .filter(|marker| marker.destination_id == book.id)
                .map(|marker| marker.edition_id.clone())
                .collect();
            let backup = book.pending_move.as_ref().is_some_and(|marker| {
                marker.backup.is_some() && !book.has_edition(&marker.edition_id)
            });
            (!hidden.is_empty() || backup).then(|| ShelfBook {
                id: book.id.clone(),
                hidden,
                backup,
            })
        })
        .collect();
    SettledShelf {
        moving: !markers.is_empty(),
        books,
    }
}

/// Which saved copies no book holds, either as an edition or as a recorded move.
#[must_use]
pub fn missing_move_copies(request: &CopiesRequest) -> MissingCopies {
    let held = |edition_id: &String| {
        request.books.iter().any(|book| {
            book.has_edition(edition_id)
                || book
                    .pending_move
                    .as_ref()
                    .is_some_and(|marker| &marker.edition_id == edition_id)
        })
    };
    MissingCopies {
        missing: request.edition_ids.iter().map(|id| !held(id)).collect(),
    }
}
