//! Planning a change to the catalog for a product: replayed purchases, the revision the user
//! confirmed, and the book or edition to write.

use crate::matching::inspect;
use crate::model::{
    Action, Book, BookWrite, ChangePlan, ChangeRequest, Decision, Edition, EditionPatch,
    EditionWrite, NewBook, Outcome, Product, ReceiptWrite, WritePlan,
};
use crate::receipt::{Replay, replay};

/// Decides what one read of the catalog leads to.
///
/// Without `expected` this is the first read: a replayed purchase answers at once, then a pending
/// edition move makes the catalog unavailable, and an outcome that writes nothing is observed or
/// needs input. With `expected`, a later read writes only when its revision still equals the one
/// planned on the first read; a pending move comes before a replay there, as the first read
/// already found no replay.
#[must_use]
pub fn plan_change(request: &ChangeRequest) -> ChangePlan {
    let books = &request.catalog.books;
    let replayed = || {
        replay(
            books,
            request.purchase.as_ref(),
            request.input_hash.as_deref(),
        )
        .map(replay_plan)
    };
    let pending = books.iter().any(Book::moving);
    let Some(expected) = request.expected.as_deref() else {
        if let Some(plan) = replayed() {
            return plan;
        }
        if pending {
            return ChangePlan::Unavailable;
        }
        return first_read(request, inspect(&request.catalog));
    };
    if pending {
        return ChangePlan::Unavailable;
    }
    let outcome = inspect(&request.catalog);
    if let Some(plan) = replayed() {
        return plan;
    }
    if revision(request.catalog.action, &outcome) != expected {
        return ChangePlan::Conflict;
    }
    write_plan(request, &outcome)
}

fn replay_plan(replay: Replay<'_>) -> ChangePlan {
    match replay {
        Replay::Applied(receipt) => ChangePlan::Replayed {
            book_id: receipt.book_id.clone(),
            edition_id: receipt.edition_id.clone(),
        },
        Replay::Conflict => ChangePlan::Conflict,
    }
}

fn first_read(request: &ChangeRequest, outcome: Outcome) -> ChangePlan {
    if request.catalog.action == Action::Inspect || matches!(outcome.decision, Decision::None) {
        return ChangePlan::Observed { outcome };
    }
    if !writes(&outcome.decision) {
        return ChangePlan::NeedsInput { outcome };
    }
    write_plan(request, &outcome)
}

const fn writes(decision: &Decision) -> bool {
    matches!(
        decision,
        Decision::CreateBook { .. } | Decision::AddEdition { .. } | Decision::Update { .. }
    )
}

const fn kind(decision: &Decision) -> &'static str {
    match decision {
        Decision::None => "none",
        Decision::InvalidIsbn { .. } => "invalidIsbn",
        Decision::InsufficientEvidence { .. } => "insufficientEvidence",
        Decision::ConflictingEvidence => "conflictingEvidence",
        Decision::ChooseBook { .. } => "chooseBook",
        Decision::ChooseEdition { .. } => "chooseEdition",
        Decision::CreateBook { .. } => "createBook",
        Decision::AddEdition { .. } => "addEdition",
        Decision::Update { .. } => "update",
    }
}

/// What must not change between the decision the user confirmed and the write: the kind of change,
/// the book, the edition unless only the wish changes, the wish the purchase or wish change
/// replaces, and the edition's ownership before an update.
fn revision(action: Action, outcome: &Outcome) -> String {
    let wish_action = matches!(action, Action::SetWish | Action::ClearWish);
    let edition = (!wish_action)
        .then_some(outcome.edition_id.as_deref())
        .flatten();
    let wish = (wish_action || action == Action::Purchase).then_some(outcome.wanted);
    let ownership = match outcome.decision {
        Decision::Update { owned_before, .. } => owned_before,
        _ => None,
    };
    serde_json::json!([
        kind(&outcome.decision),
        outcome.book_id,
        edition,
        wish,
        ownership
    ])
    .to_string()
}

/// The book to create or the change to apply, planned against the books in the request.
fn write_plan(request: &ChangeRequest, outcome: &Outcome) -> ChangePlan {
    let target = outcome
        .book_id
        .as_deref()
        .and_then(|id| request.catalog.books.iter().find(|book| book.id == id));
    let added = || {
        new_edition(
            &request.catalog.product,
            &outcome.isbns,
            &request.new_edition_id,
        )
    };
    let (wanted, edition) = match &outcome.decision {
        Decision::CreateBook {
            wanted,
            record_edition,
        } => (*wanted, record_edition.then(added)),
        Decision::AddEdition { wanted_after, .. } => (*wanted_after, Some(added())),
        Decision::Update {
            wanted_after,
            owned_after: Some(owned),
            edition_patch,
            ..
        } => {
            let Some(stored) = stored_edition(target, outcome.edition_id.as_deref()) else {
                return ChangePlan::Conflict;
            };
            let patch = edition_patch.as_deref();
            (*wanted_after, Some(updated_edition(stored, *owned, patch)))
        }
        Decision::Update { wanted_after, .. } => (*wanted_after, None),
        _ => return ChangePlan::Conflict,
    };
    let book_id = target.map_or_else(|| request.new_book_id.clone(), |book| book.id.clone());
    let edition_id = edition.as_ref().map(|edition| edition.id.clone());
    let receipt = receipt(request, &book_id, edition_id.as_deref());
    let new_book = matches!(outcome.decision, Decision::CreateBook { .. })
        .then(|| new_book(request, &book_id, wanted, edition.clone(), receipt.clone()));
    ChangePlan::Write(Box::new(WritePlan {
        revision: revision(request.catalog.action, outcome),
        book_id,
        edition_id,
        change: BookWrite {
            wanted,
            edition,
            receipt,
        },
        new_book,
    }))
}

fn stored_edition<'a>(book: Option<&'a Book>, edition_id: Option<&str>) -> Option<&'a Edition> {
    let edition_id = edition_id?;
    book?
        .editions
        .iter()
        .find(|edition| edition.id == edition_id)
}

/// The receipt for a purchase that settles on an edition.
fn receipt(
    request: &ChangeRequest,
    book_id: &str,
    edition_id: Option<&str>,
) -> Option<ReceiptWrite> {
    let purchase = request.purchase.as_ref()?;
    let input_hash = request
        .input_hash
        .as_deref()
        .filter(|hash| !hash.is_empty())?;
    let edition_id = edition_id.filter(|id| !id.is_empty())?;
    Some(ReceiptWrite {
        request_id: purchase.request_id.clone(),
        client_id: purchase.client_id.clone(),
        input_hash: input_hash.to_owned(),
        applied_at_ms: request.now,
        book_id: book_id.to_owned(),
        edition_id: edition_id.to_owned(),
    })
}

/// An owned edition with the product's ISBNs and its non-empty edition facts.
fn new_edition(product: &Product, isbns: &[String], id: &str) -> EditionWrite {
    let value = |value: Option<&String>| value.filter(|value| !value.is_empty()).cloned();
    let details = &product.details;
    EditionWrite {
        id: id.to_owned(),
        owned: true,
        isbns: isbns.to_vec(),
        label: value(product.label.as_ref()),
        publisher: value(details.publisher.as_ref()),
        published_on: value(details.published_on.as_ref()),
        cover: value(details.cover.as_ref()),
        purchased_on: value(details.purchased_on.as_ref()),
        purchased_from: value(details.purchased_from.as_ref()),
    }
}

fn new_book(
    request: &ChangeRequest,
    id: &str,
    wanted: bool,
    edition: Option<EditionWrite>,
    receipt: Option<ReceiptWrite>,
) -> NewBook {
    let product = &request.catalog.product;
    NewBook {
        id: id.to_owned(),
        title: product.title.trim_matches(is_js_whitespace).to_owned(),
        authors: product.authors.clone(),
        wanted,
        editions: edition.into_iter().collect(),
        applied_purchases: receipt.into_iter().collect(),
    }
}

/// The characters JavaScript's `String.prototype.trim` removes: Unicode white space except U+0085,
/// and the byte order mark.
fn is_js_whitespace(character: char) -> bool {
    character == '\u{feff}' || (character.is_whitespace() && character != '\u{85}')
}

/// The stored edition with the new ownership and only the values the product fills in.
fn updated_edition(stored: &Edition, owned: bool, patch: Option<&EditionPatch>) -> EditionWrite {
    let mut edition = EditionWrite {
        id: stored.id.clone(),
        owned,
        isbns: stored.isbns.clone(),
        label: None,
        publisher: None,
        published_on: None,
        cover: None,
        purchased_on: None,
        purchased_from: None,
    };
    if let Some(patch) = patch {
        edition.isbns.extend(patch.isbns.iter().cloned());
        edition.label.clone_from(&patch.label);
        edition.publisher.clone_from(&patch.publisher);
        edition.published_on.clone_from(&patch.published_on);
        edition.cover.clone_from(&patch.cover);
        edition.purchased_on.clone_from(&patch.purchased_on);
        edition.purchased_from.clone_from(&patch.purchased_from);
    }
    edition
}
