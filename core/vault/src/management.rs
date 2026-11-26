//! Which management commands the stored books accept, and the change each one writes.

use crate::model::{
    Book, BookOptions, BookStep, CustomField, Edition, EditionOptions, ManagementCommand,
    ManagementPlan, ManagementRequest, MoveCopy, MoveStage, OptionsRequest, RestoreRequest,
    RestoreTargets, StepRequest,
};
use crate::moving;

/// Decides what a management command leads to, from the books read with it.
///
/// A command for a book that is not there conflicts. Resuming or cancelling needs a move recorded
/// on the book; any other command waits while some move has not settled.
#[must_use]
pub fn plan_management(request: &ManagementRequest) -> ManagementPlan {
    let books = &request.books;
    let Some(source) = books
        .iter()
        .find(|book| book.id == request.command.book_id())
    else {
        return ManagementPlan::Conflict;
    };
    match &request.command {
        ManagementCommand::RecoverMove { .. } if source.moving() => ManagementPlan::Move {
            stages: vec![MoveStage::Resume],
        },
        ManagementCommand::RecoverMove { .. } => ManagementPlan::Conflict,
        ManagementCommand::CancelMove { .. } => moving::cancel(books, source),
        _ if books.iter().any(Book::moving) => ManagementPlan::Pending,
        ManagementCommand::Move {
            edition_id,
            destination_id,
            ..
        } => moving::start(books, source, edition_id, destination_id),
        command => step(request, source, command).map_or(ManagementPlan::Conflict, |step| {
            ManagementPlan::Write { step }
        }),
    }
}

fn step(
    request: &ManagementRequest,
    source: &Book,
    command: &ManagementCommand,
) -> Option<BookStep> {
    let books = &request.books;
    match command {
        ManagementCommand::AddEdition { value, .. } => add_edition(books, source, value),
        ManagementCommand::EditEdition {
            baseline, value, ..
        } => edit_edition(books, source, baseline, value),
        ManagementCommand::UpdateCustomField {
            baseline, value, ..
        } => (source.archived_at.is_none() && (baseline.is_some() || value.is_some())).then(|| {
            BookStep::UpdateCustomField {
                baseline: baseline.clone(),
                value: value.clone(),
            }
        }),
        ManagementCommand::Archive { edition_id, .. } => {
            archive(source, edition_id.as_deref(), Some(&request.stamp))
        }
        ManagementCommand::Restore { edition_id, .. } => {
            archive(source, edition_id.as_deref(), None)
        }
        ManagementCommand::RestoreMoveCopy { edition_id, .. } => {
            restore_copy(books, source, edition_id, request.copy.as_ref())
        }
        ManagementCommand::Move { .. }
        | ManagementCommand::RecoverMove { .. }
        | ManagementCommand::CancelMove { .. } => None,
    }
}

/// Another edition of the book shares an ISBN with the edition.
pub(crate) fn collides(book: &Book, edition: &Edition) -> bool {
    book.editions.iter().any(|other| {
        other.id != edition.id && other.isbns.iter().any(|isbn| edition.isbns.contains(isbn))
    })
}

/// The book holds the edition, or another edition with one of its ISBNs.
fn clashes(book: &Book, edition: &Edition) -> bool {
    book.has_edition(&edition.id) || collides(book, edition)
}

/// Neither archived nor part of an unsettled move.
const fn open(book: &Book) -> bool {
    book.archived_at.is_none() && !book.moving()
}

/// A new edition needs an unarchived book, and no book may hold it or one of its ISBNs.
fn add_edition(books: &[Book], source: &Book, value: &Edition) -> Option<BookStep> {
    let refused = source.archived_at.is_some()
        || value.archived_at.is_some()
        || books.iter().any(|book| clashes(book, value));
    (!refused).then(|| BookStep::AddEdition {
        edition: Box::new(value.clone()),
    })
}

/// An edit keeps the edition's id and archive, and gives it no ISBN another edition has.
fn edit_edition(
    books: &[Book],
    source: &Book,
    baseline: &Edition,
    value: &Edition,
) -> Option<BookStep> {
    let refused = source.archived_at.is_some()
        || baseline.id != value.id
        || baseline.archived_at != value.archived_at
        || books.iter().any(|book| collides(book, value));
    (!refused).then(|| BookStep::EditEdition {
        baseline: Box::new(baseline.clone()),
        edition: Box::new(value.clone()),
    })
}

/// Archiving keeps an earlier archive time; restoring clears it. An edition of an archived book
/// stays as it is.
fn archive(source: &Book, edition_id: Option<&str>, stamp: Option<&str>) -> Option<BookStep> {
    let before = match edition_id {
        Some(_) if source.archived_at.is_some() => return None,
        Some(id) => source.edition(id)?.archived_at.clone(),
        None => source.archived_at.clone(),
    };
    let archived_at = stamp.map(|now| before.clone().unwrap_or_else(|| now.to_owned()));
    Some(BookStep::SetArchivedAt {
        edition_id: edition_id.map(str::to_owned),
        before,
        archived_at,
    })
}

/// A saved copy goes back only to an unarchived book of its move.
fn takes_back(book: &Book, source_id: &str, destination_id: &str) -> bool {
    (book.id == source_id || book.id == destination_id) && book.archived_at.is_none()
}

/// A saved copy goes back to either book of its move, into an unarchived book, while no book
/// holds the edition or one of its ISBNs.
fn restore_copy(
    books: &[Book],
    source: &Book,
    edition_id: &str,
    copy: Option<&MoveCopy>,
) -> Option<BookStep> {
    let copy = copy.filter(|copy| takes_back(source, &copy.source_id, &copy.destination_id))?;
    let edition = &copy.edition;
    let refused = edition.id != edition_id
        || edition.archived_at.is_some()
        || books
            .iter()
            .any(|book| book.moving() || clashes(book, edition));
    (!refused).then(|| BookStep::RestoreEdition {
        edition: Box::new(edition.clone()),
    })
}

/// The books each saved copy may go back to: its source, then its destination, while present and
/// unarchived.
#[must_use]
pub fn restore_targets(request: &RestoreRequest) -> RestoreTargets {
    let targets = request
        .copies
        .iter()
        .map(|copy| {
            [&copy.source_id, &copy.destination_id]
                .into_iter()
                .filter(|id| {
                    request.books.iter().any(|book| {
                        book.id == **id && takes_back(book, &copy.source_id, &copy.destination_id)
                    })
                })
                .cloned()
                .collect()
        })
        .collect();
    RestoreTargets { targets }
}

/// Which management commands to offer for a book. A book with an unsettled move can only resume
/// or cancel it, an archived book and an archived edition can only be restored, and an unarchived
/// edition may move to any other unarchived book.
#[must_use]
pub fn book_options(request: &OptionsRequest) -> BookOptions {
    let books = &request.books;
    let Some(book) = books.iter().find(|book| book.id == request.book_id) else {
        return BookOptions::Missing;
    };
    if book.moving() {
        return BookOptions::Moving;
    }
    if book.archived_at.is_some() {
        return BookOptions::Archived;
    }
    let destinations: Vec<String> = books
        .iter()
        .filter(|other| other.id != book.id && other.archived_at.is_none())
        .map(|other| other.id.clone())
        .collect();
    let editions = book
        .editions
        .iter()
        .map(|edition| {
            let archived = edition.archived_at.is_some();
            EditionOptions {
                id: edition.id.clone(),
                archived,
                destinations: if archived {
                    Vec::new()
                } else {
                    destinations.clone()
                },
            }
        })
        .collect();
    BookOptions::Open { editions }
}

/// Whether the change may be written to the latest content of its book note.
#[must_use]
pub fn allows_step(request: &StepRequest) -> bool {
    let book = &request.latest;
    match &request.step {
        BookStep::SetArchivedAt {
            edition_id, before, ..
        } => !book.moving() && archive_unchanged(book, edition_id.as_deref(), before.as_ref()),
        BookStep::AddEdition { edition } => open(book) && !clashes(book, edition),
        BookStep::EditEdition { baseline, edition } => {
            open(book) && book.edition(&edition.id) == Some(&**baseline)
        }
        BookStep::UpdateCustomField { baseline, value } => {
            open(book) && fields_unchanged(&book.custom_fields, baseline.as_ref(), value.as_ref())
        }
        BookStep::RestoreEdition { edition } => open(book) && !clashes(book, edition),
        BookStep::MarkMove => open(book),
        BookStep::CopyEdition { edition } => open(book) && !collides(book, edition),
        BookStep::RecordBackup { marker }
        | BookStep::ClearMove { marker }
        | BookStep::CancelMove { marker } => moving::settles(book, &request.step, marker),
    }
}

/// The archive time is still the one read with the command.
fn archive_unchanged(book: &Book, edition_id: Option<&str>, before: Option<&String>) -> bool {
    let current = match edition_id {
        Some(id) => match book.edition(id) {
            Some(edition) if book.archived_at.is_none() => &edition.archived_at,
            _ => return false,
        },
        None => &book.archived_at,
    };
    current.as_ref() == before
}

/// The field to replace is still as read, and no other field takes the new name.
fn fields_unchanged(
    fields: &[CustomField],
    baseline: Option<&CustomField>,
    value: Option<&CustomField>,
) -> bool {
    let index = baseline.and_then(|old| fields.iter().position(|field| field.name() == old.name()));
    let unchanged = baseline.is_none_or(|old| index.and_then(|at| fields.get(at)) == Some(old));
    let unique = value.is_none_or(|new| {
        !fields
            .iter()
            .enumerate()
            .any(|(at, field)| Some(at) != index && field.name() == new.name())
    });
    unchanged && unique
}
