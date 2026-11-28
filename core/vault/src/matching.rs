//! Matching a product to a stored book and edition, and deciding the state change.

use crate::identity::{
    canonical_isbns, distinct_editions, normalized, normalized_title, same_authors, same_label,
};
use crate::model::{
    Action, Book, CatalogRequest, Decision, Edition, EditionPatch, Outcome, Ownership, Product,
    Selection, SeriesEntry,
};

/// Evaluates catalog evidence and decides the state change without performing Vault I/O. The
/// product is compared and written in the stored spelling.
#[must_use]
pub fn inspect(request: &CatalogRequest) -> Outcome {
    evaluate(request, &request.product.normalized())
}

/// Evaluates catalog evidence for a product already in the stored spelling.
pub(crate) fn evaluate(request: &CatalogRequest, product: &Product) -> Outcome {
    let isbns = match canonical_isbns(&product.isbns) {
        Ok(isbns) => isbns,
        Err(input) => {
            return Outcome::undetermined(Decision::InvalidIsbn {
                input: input.to_owned(),
            });
        }
    };
    let inspect_only = request.action == Action::Inspect;
    let book = match locate_book(
        &request.books,
        product,
        &isbns,
        request.selection.as_ref(),
        request.action,
    ) {
        Ok(book) => book,
        Err(reason) => return Outcome::undetermined(reason),
    };
    let Some(book) = book else {
        return unknown_book(request, product, isbns);
    };
    if book.archived_at.is_some() {
        return Outcome::undetermined(Decision::ConflictingEvidence);
    }
    let label = product
        .label
        .as_deref()
        .map(normalized)
        .filter(|value| !value.is_empty());
    Evidence {
        request,
        product,
        book,
        isbns,
        label,
        inspect_only,
    }
    .outcome()
}

fn locate_book<'a>(
    books: &'a [Book],
    product: &Product,
    isbns: &[String],
    selection: Option<&Selection>,
    action: Action,
) -> Result<Option<&'a Book>, Decision> {
    let inspect_only = action == Action::Inspect;
    let title = normalized_title(&product.title);
    let named = !title.is_empty()
        && product
            .authors
            .iter()
            .any(|author| !normalized(author).is_empty());
    if selection.is_none() && !named && isbns.is_empty() {
        return Err(insufficient_evidence(books, action));
    }
    let visible_books = || {
        books
            .iter()
            .filter(|book| !inspect_only || book.archived_at.is_none())
    };
    let mut exact = visible_books().filter(|book| {
        book.editions
            .iter()
            .any(|edition| edition.isbns.iter().any(|isbn| isbns.contains(isbn)))
    });
    if let Some(selection) = selection {
        if exact.any(|book| book.id != selection.book_id) {
            return Err(Decision::ConflictingEvidence);
        }
        if selection.book_id == "new" {
            return Ok(None);
        }
        return visible_books()
            .find(|book| book.id == selection.book_id)
            .map(Some)
            .ok_or(Decision::ConflictingEvidence);
    }
    let named_books = || {
        visible_books().filter(|book| {
            named
                && normalized_title(&book.title) == title
                && same_authors(&book.authors, &product.authors)
        })
    };
    if let Some(book) = exact.next() {
        let mut names = named_books();
        let different_book = names
            .next()
            .is_some_and(|first| first.id != book.id && !names.any(|other| other.id == book.id));
        if exact.next().is_some() || different_book {
            return Err(Decision::ConflictingEvidence);
        }
        return Ok(Some(book));
    }
    let mut matches = named_books();
    let first = matches.next();
    if let Some(first) = first
        && let Some(second) = matches.next()
    {
        return Err(Decision::ChooseBook {
            book_ids: unarchived_ids([first, second].into_iter().chain(matches)),
            new_book: creates_book(action),
        });
    }
    Ok(first)
}

/// Whether the action may record the product as a book not stored yet.
const fn creates_book(action: Action) -> bool {
    matches!(
        action,
        Action::Purchase | Action::RecordOwnership | Action::SetWish
    )
}

/// Whether the action may record the product as an edition its book does not hold yet.
const fn creates_edition(action: Action) -> bool {
    matches!(action, Action::Purchase | Action::RecordOwnership)
}

/// The ids of the books the user may pick: an archived book takes no product.
fn unarchived_ids<'a>(books: impl IntoIterator<Item = &'a Book>) -> Vec<String> {
    books
        .into_iter()
        .filter(|book| book.archived_at.is_none())
        .map(|book| book.id.clone())
        .collect()
}

/// Nothing names the book: the user may pick any unarchived book, or a new one when the action
/// creates books.
fn insufficient_evidence(books: &[Book], action: Action) -> Decision {
    Decision::InsufficientEvidence {
        book_ids: unarchived_ids(books),
        new_book: creates_book(action),
    }
}

/// The outcome when no stored book is the product. A wish records the product as an unowned
/// edition when it has an ISBN, so the book stays identifiable by that ISBN after its title and
/// authors change.
fn unknown_book(request: &CatalogRequest, product: &Product, isbns: Vec<String>) -> Outcome {
    let action = request.action;
    let decision = match action {
        _ if !creates_book(action) => Decision::None,
        _ if product.title.trim().is_empty() => insufficient_evidence(&request.books, action),
        Action::SetWish => Decision::CreateBook {
            wanted: true,
            record_edition: !isbns.is_empty(),
        },
        _ => Decision::CreateBook {
            wanted: false,
            record_edition: true,
        },
    };
    Outcome {
        ownership: Ownership::Unowned,
        isbns,
        ..Outcome::undetermined(decision)
    }
}

/// The edition evidence cannot settle on one edition.
struct Ambiguous;

/// What the product says about one active stored book.
struct Evidence<'a> {
    request: &'a CatalogRequest,
    product: &'a Product,
    book: &'a Book,
    isbns: Vec<String>,
    label: Option<String>,
    inspect_only: bool,
}

impl<'a> Evidence<'a> {
    fn outcome(self) -> Outcome {
        let book = self.book;
        let action = self.request.action;
        let wish_action = matches!(action, Action::SetWish | Action::ClearWish);
        let selected = self
            .request
            .selection
            .as_ref()
            .filter(|_| !wish_action)
            .and_then(|selection| selection.edition_id.as_deref());
        let Ok(edition) = self.edition(selected) else {
            return self.undetermined(wish_action);
        };
        let active: Vec<_> = book
            .editions
            .iter()
            .filter(|edition| edition.archived_at.is_none())
            .collect();
        let label = self.label.as_deref();
        let ownership = ownership(edition, &active, selected == Some("new"), label);
        let decision = if selected == Some("new") && creates_edition(action) {
            Decision::AddEdition {
                wanted_before: book.wanted,
                wanted_after: action == Action::RecordOwnership && book.wanted,
            }
        } else {
            decision(
                self.request,
                self.product,
                book,
                edition,
                &active,
                label,
                &self.isbns,
            )
        };
        Outcome {
            ownership,
            wanted: book.wanted,
            book_id: Some(book.id.clone()),
            edition_id: edition.map(|edition| edition.id.clone()),
            decision,
            isbns: self.isbns,
        }
    }

    fn visible(&self, edition: &Edition) -> bool {
        !self.inspect_only || edition.archived_at.is_none()
    }

    fn has_isbn(&self, edition: &Edition) -> bool {
        edition.isbns.iter().any(|isbn| self.isbns.contains(isbn))
    }

    fn has_label(&self, edition: &Edition) -> bool {
        self.label.as_ref().is_some_and(|candidate| {
            edition
                .label
                .as_deref()
                .is_some_and(|stored| same_label(candidate, &normalized(stored)))
        })
    }

    /// The edition the evidence names; `None` when it names no stored edition.
    fn edition(&self, selected: Option<&str>) -> Result<Option<&'a Edition>, Ambiguous> {
        let mut known = self.book.editions.iter().filter(|edition| {
            self.visible(edition) && (self.has_isbn(edition) || self.has_label(edition))
        });
        match selected {
            Some("new") if known.next().is_none() => Ok(None),
            Some("new") => Err(Ambiguous),
            Some(id) => self.chosen(id).map(Some),
            None => {
                let first = known.next();
                if known.next().is_some()
                    || first.is_some_and(|edition| edition.archived_at.is_some())
                {
                    return Err(Ambiguous);
                }
                Ok(first)
            }
        }
    }

    /// The edition the user chose, unless an ISBN points at another one.
    fn chosen(&self, id: &str) -> Result<&'a Edition, Ambiguous> {
        if self
            .book
            .editions
            .iter()
            .any(|edition| self.visible(edition) && self.has_isbn(edition) && edition.id != id)
        {
            return Err(Ambiguous);
        }
        self.book
            .editions
            .iter()
            .find(|edition| edition.id == id && edition.archived_at.is_none())
            .ok_or(Ambiguous)
    }

    fn undetermined(&self, wish_action: bool) -> Outcome {
        let plan = if wish_action {
            wish_change(self.book, self.request.action == Action::SetWish)
        } else {
            Decision::ConflictingEvidence
        };
        Outcome {
            wanted: self.book.wanted,
            book_id: Some(self.book.id.clone()),
            ..Outcome::undetermined(plan)
        }
    }
}

fn ownership(
    edition: Option<&Edition>,
    active: &[&Edition],
    new_selected: bool,
    label: Option<&str>,
) -> Ownership {
    let other_owned = active.iter().any(|edition| edition.owned);
    match (edition, other_owned) {
        (Some(known), _) if known.owned => Ownership::SameEdition,
        (_, false) => Ownership::Unowned,
        (Some(_), true) => Ownership::OtherEdition,
        (None, true) if new_selected || new_revision(active, label) => Ownership::OtherEdition,
        (None, true) => Ownership::UnknownEdition,
    }
}

fn new_revision(editions: &[&Edition], label: Option<&str>) -> bool {
    editions.is_empty()
        || label.is_some_and(|candidate| {
            editions.iter().all(|edition| {
                edition
                    .label
                    .as_deref()
                    .is_some_and(|label| distinct_editions(candidate, &normalized(label)))
            })
        })
}

fn decision(
    request: &CatalogRequest,
    product: &Product,
    book: &Book,
    edition: Option<&Edition>,
    editions: &[&Edition],
    label: Option<&str>,
    isbns: &[String],
) -> Decision {
    let action = request.action;
    let after = match action {
        Action::Inspect => return Decision::None,
        Action::Purchase | Action::ClearWish => false,
        Action::SetWish => true,
        Action::RecordOwnership | Action::CancelOwnership => book.wanted,
    };
    // A wish names no edition, but its ISBN is what identifies the book once the library rewrites
    // its title and authors: a book without an active edition keeps the product as an unowned one.
    // Where the book holds editions, telling which one the product is would need the user.
    if action == Action::SetWish && edition.is_none() && editions.is_empty() && !isbns.is_empty() {
        return Decision::AddEdition {
            wanted_before: book.wanted,
            wanted_after: true,
        };
    }
    if matches!(action, Action::SetWish | Action::ClearWish) {
        return wish_change(book, after);
    }
    if let Some(edition) = edition {
        return Decision::Update {
            wanted_before: book.wanted,
            wanted_after: after,
            owned_before: Some(edition.owned),
            owned_after: Some(action != Action::CancelOwnership),
            edition_patch: if matches!(action, Action::Purchase | Action::RecordOwnership) {
                edition_patch(edition, product, isbns)
            } else {
                None
            },
        };
    }
    if creates_edition(action) && new_revision(editions, label) {
        return Decision::AddEdition {
            wanted_before: book.wanted,
            wanted_after: after,
        };
    }
    Decision::ChooseEdition {
        edition_ids: editions.iter().map(|edition| edition.id.clone()).collect(),
        new_edition: creates_edition(action),
    }
}

/// A change of the book's wish alone.
const fn wish_change(book: &Book, wanted_after: bool) -> Decision {
    Decision::Update {
        wanted_before: book.wanted,
        wanted_after,
        owned_before: None,
        owned_after: None,
        edition_patch: None,
    }
}

/// The source value, trimmed, when the stored value is blank.
fn fill(old: Option<&str>, source: Option<&str>) -> Option<String> {
    old.filter(|value| !value.trim().is_empty())
        .is_none()
        .then_some(source)
        .flatten()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

fn edition_patch(old: &Edition, source: &Product, isbns: &[String]) -> Option<Box<EditionPatch>> {
    let (stored, found) = (&old.details, &source.details);
    let patch = EditionPatch {
        isbns: isbns
            .iter()
            .filter(|isbn| !old.isbns.contains(isbn))
            .cloned()
            .collect(),
        label: fill(old.label.as_deref(), source.label.as_deref()),
        publisher: fill(stored.publisher.as_deref(), found.publisher.as_deref()),
        published_on: fill(
            stored.published_on.as_deref(),
            found.published_on.as_deref(),
        ),
        cover: fill(stored.cover.as_deref(), found.cover.as_deref()),
        purchased_on: fill(
            stored.purchased_on.as_deref(),
            found.purchased_on.as_deref(),
        ),
        purchased_from: fill(
            stored.purchased_from.as_deref(),
            found.purchased_from.as_deref(),
        ),
        series: product_series(&old.series, source, isbns),
    };
    (!patch.isbns.is_empty()
        || [
            &patch.label,
            &patch.publisher,
            &patch.published_on,
            &patch.cover,
            &patch.purchased_on,
            &patch.purchased_from,
        ]
        .into_iter()
        .any(Option::is_some)
        || !patch.series.is_empty())
    .then(|| Box::new(patch))
}

/// The series the product states, for each of its ISBNs that has none yet.
fn product_series(stored: &[SeriesEntry], source: &Product, isbns: &[String]) -> Vec<SeriesEntry> {
    let Some(name) = source.series.as_deref() else {
        return Vec::new();
    };
    isbns
        .iter()
        .filter(|isbn| !stored.iter().any(|entry| entry.isbn == **isbn))
        .map(|isbn| SeriesEntry {
            isbn: isbn.clone(),
            name: name.to_owned(),
        })
        .collect()
}
