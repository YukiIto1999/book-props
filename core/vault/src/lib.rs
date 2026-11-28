//! Catalog rules for the Vault: identity evidence, matching, the decisions they lead to, the
//! purchase changes planned from them, the management of stored books and edition moves, the
//! shelf's queries, the portable library, and bibliographic text in one spelling.

mod bibliography;
mod change;
mod identity;
mod management;
mod matching;
mod model;
mod moving;
mod portable;
mod receipt;
mod shelf;
mod text;

pub use bibliography::{
    describe_record, ndc_classes, ndc_section, ndc_subsection, plan_enrichment, plan_review,
};
pub use change::plan_change;
pub use management::{allows_step, book_options, plan_management, restore_targets};
pub use matching::inspect;
pub use model::{
    Action, Admission, AuthorRole, BibliographyRequest, BibliographyRevision, Book, BookOptions,
    BookStep, BookWrite, BooksRequest, CatalogRequest, CatalogueRecord, ChangePlan, ChangeRequest,
    CopiesRequest, CopyPlace, CustomField, Decision, DescribedRecord, Details, Edition,
    EditionOptions, EditionPatch, EditionText, EditionWrite, EnrichmentPlan, ExpiryRequest,
    ImportPlan, ImportRequest, IsbnList, LookupAnswer, ManagementCommand, ManagementPlan,
    ManagementRequest, MissingCopies, MoveBackup, MoveCopy, MoveMarker, MovePlan, MoveRequest,
    MoveSource, MoveStage, NewBook, NoteFacts, OptionsRequest, Outcome, Ownership, OwnershipFilter,
    Person, PortableEnvelope, PortableExport, PortableNote, PortableNotes, PortableProblem,
    PortableVerdict, PresentNote, Product, PurchaseKey, RangeKind, Reading, ReadingStatus, Receipt,
    ReceiptExpiry, ReceiptWrite, ReconcileRequest, Reconciliation, RestoreRequest, RestoreTargets,
    Selection, SeriesEntry, SettledShelf, ShelfBook, ShelfBound, ShelfField, ShelfOverview,
    ShelfQuery, ShelfRange, ShelfRecord, ShelfRequest, ShelfSelection, ShelfTag, ShelfValue,
    ShelfView, StatedNdc, StepRequest, WishFilter, WritePlan,
};
pub use moving::{missing_move_copies, plan_move, settle_shelf};
pub use portable::{
    check_portable_notes, decode_portable_library, encode_portable_library, plan_import,
};
pub use receipt::{admits, expired_receipts, reconcile};
pub use shelf::{ShelfError, ShelfIndex};
pub use text::calendar_date;
use tsify::{Ts, Tsify};
use wasm_bindgen::prelude::{JsError, wasm_bindgen};
/// A National Diet Library record in the stored spelling, from the JSON text of a
/// `CatalogueRecord`.
///
/// # Errors
/// Throws when the request is not a well-formed `CatalogueRecord`.
#[wasm_bindgen(js_name = describeRecord)]
pub fn describe_record_request(request: &str) -> Result<Ts<DescribedRecord>, JsError> {
    let record: CatalogueRecord = serde_json::from_str(request)?;
    Ok(describe_record(&record).into_ts()?)
}

/// What finishing the National Diet Library lookups of a book leads to, from the JSON text of a
/// `BibliographyRequest`.
///
/// # Errors
/// Throws when the request is not a well-formed `BibliographyRequest`.
#[wasm_bindgen(js_name = planEnrichment)]
pub fn plan_enrichment_request(request: &str) -> Result<Ts<EnrichmentPlan>, JsError> {
    let request: BibliographyRequest = serde_json::from_str(request)?;
    Ok(plan_enrichment(&request).into_ts()?)
}

/// The text a stored book would have in the stored spelling, from the JSON text of a
/// `BibliographyRequest`.
///
/// # Errors
/// Throws when the request is not a well-formed `BibliographyRequest`.
#[wasm_bindgen(js_name = planReview)]
pub fn plan_review_request(request: &str) -> Result<Ts<BibliographyRevision>, JsError> {
    let request: BibliographyRequest = serde_json::from_str(request)?;
    Ok(plan_review(&request).into_ts()?)
}

/// Canonical ISBN-13s of the inputs without duplicates, or the first input that is not an ISBN.
#[must_use]
pub fn normalize_isbns(values: &[String]) -> IsbnList {
    match identity::canonical_isbns(values) {
        Ok(values) => IsbnList::Valid { values },
        Err(input) => IsbnList::Invalid {
            input: input.to_owned(),
        },
    }
}

/// Whether stored ISBNs are already canonical ISBN-13s without duplicates.
#[must_use]
pub fn canonical_isbn_list(values: &[String]) -> bool {
    identity::canonical(values)
}

/// Inspects a catalog request from the runtime.
///
/// The request arrives as the JSON text of a `CatalogRequest`: one parse is faster than converting
/// every stored book across the boundary field by field. The outcome is small and returns as an
/// object.
///
/// # Errors
/// Throws when the request is not a well-formed `CatalogRequest`.
#[wasm_bindgen(js_name = inspect)]
pub fn inspect_request(request: &str) -> Result<Ts<Outcome>, JsError> {
    let request: CatalogRequest = serde_json::from_str(request)?;
    Ok(inspect(&request).into_ts()?)
}

/// Normalizes ISBNs entered or observed by the runtime.
///
/// # Errors
/// Throws when the result cannot be passed back to JavaScript.
#[wasm_bindgen(js_name = normalizeIsbns)]
pub fn normalize_isbn_values(values: Vec<String>) -> Result<Ts<IsbnList>, JsError> {
    Ok(normalize_isbns(&values).into_ts()?)
}

/// Whether the ISBNs a book note stores are canonical ISBN-13s without duplicates.
#[wasm_bindgen(js_name = isCanonicalIsbnList)]
#[must_use]
pub fn canonical_isbn_values(values: Vec<String>) -> bool {
    canonical_isbn_list(&values)
}

/// Whether an operation may start before the catalog is read: a purchase needs a well-formed key
/// issued within the retry window.
///
/// # Errors
/// Throws when the request is not a well-formed `Admission`.
#[wasm_bindgen(js_name = admits)]
pub fn admits_request(request: &str) -> Result<bool, JsError> {
    Ok(admits(&serde_json::from_str(request)?))
}

/// Plans one read of the catalog while changing it for a product.
///
/// The runtime calls this on the first read, again on a fresh read before writing, and on the
/// latest content of the book note it rewrites, passing the revision of the first plan as
/// `expected` on the later reads. The request arrives as the JSON text of a `ChangeRequest`.
///
/// # Errors
/// Throws when the request is not a well-formed `ChangeRequest`.
#[wasm_bindgen(js_name = planChange)]
pub fn plan_change_request(request: &str) -> Result<Ts<ChangePlan>, JsError> {
    let request: ChangeRequest = serde_json::from_str(request)?;
    Ok(plan_change(&request).into_ts()?)
}

/// Whether the catalog already applied a purchase, from the JSON text of a `ReconcileRequest`.
///
/// # Errors
/// Throws when the request is not a well-formed `ReconcileRequest`.
#[wasm_bindgen(js_name = reconcile)]
pub fn reconcile_request(request: &str) -> Result<Ts<Reconciliation>, JsError> {
    let request: ReconcileRequest = serde_json::from_str(request)?;
    Ok(reconcile(&request).into_ts()?)
}

/// Which receipts are past the retention period, from the JSON text of an `ExpiryRequest`.
///
/// # Errors
/// Throws when the request is not a well-formed `ExpiryRequest`.
#[wasm_bindgen(js_name = expiredReceipts)]
pub fn expired_receipts_request(request: &str) -> Result<Ts<ReceiptExpiry>, JsError> {
    let request: ExpiryRequest = serde_json::from_str(request)?;
    Ok(expired_receipts(&request).into_ts()?)
}

/// Plans a management command from the JSON text of a `ManagementRequest`.
///
/// # Errors
/// Throws when the request is not a well-formed `ManagementRequest`.
#[wasm_bindgen(js_name = planManagement)]
pub fn plan_management_request(request: &str) -> Result<Ts<ManagementPlan>, JsError> {
    let request: ManagementRequest = serde_json::from_str(request)?;
    Ok(plan_management(&request).into_ts()?)
}

/// Whether a change may be written to the latest content of its book note, from the JSON text of
/// a `StepRequest`.
///
/// # Errors
/// Throws when the request is not a well-formed `StepRequest`.
#[wasm_bindgen(js_name = allowsStep)]
pub fn allows_step_request(request: &str) -> Result<bool, JsError> {
    Ok(allows_step(&serde_json::from_str(request)?))
}

/// Plans how a recorded edition move continues, from the JSON text of a `MoveRequest`.
///
/// # Errors
/// Throws when the request is not a well-formed `MoveRequest`.
#[wasm_bindgen(js_name = planMove)]
pub fn plan_move_request(request: &str) -> Result<Ts<MovePlan>, JsError> {
    let request: MoveRequest = serde_json::from_str(request)?;
    Ok(plan_move(&request).into_ts()?)
}

/// How unsettled moves change the shelf, from the JSON text of a `BooksRequest`.
///
/// # Errors
/// Throws when the request is not a well-formed `BooksRequest`.
#[wasm_bindgen(js_name = settleShelf)]
pub fn settle_shelf_request(request: &str) -> Result<Ts<SettledShelf>, JsError> {
    let request: BooksRequest = serde_json::from_str(request)?;
    Ok(settle_shelf(&request).into_ts()?)
}

/// Which saved edition copies no book holds, from the JSON text of a `CopiesRequest`.
///
/// # Errors
/// Throws when the request is not a well-formed `CopiesRequest`.
#[wasm_bindgen(js_name = missingMoveCopies)]
pub fn missing_move_copies_request(request: &str) -> Result<Ts<MissingCopies>, JsError> {
    let request: CopiesRequest = serde_json::from_str(request)?;
    Ok(missing_move_copies(&request).into_ts()?)
}

/// The books each saved edition copy may go back to, from the JSON text of a `RestoreRequest`.
///
/// # Errors
/// Throws when the request is not a well-formed `RestoreRequest`.
#[wasm_bindgen(js_name = restoreTargets)]
pub fn restore_targets_request(request: &str) -> Result<Ts<RestoreTargets>, JsError> {
    let request: RestoreRequest = serde_json::from_str(request)?;
    Ok(restore_targets(&request).into_ts()?)
}

/// Which management commands one book takes, from the JSON text of an `OptionsRequest`.
///
/// # Errors
/// Throws when the request is not a well-formed `OptionsRequest`.
#[wasm_bindgen(js_name = bookOptions)]
pub fn book_options_request(request: &str) -> Result<Ts<BookOptions>, JsError> {
    let request: OptionsRequest = serde_json::from_str(request)?;
    Ok(book_options(&request).into_ts()?)
}

/// The calendar date a person wrote, as `YYYY-MM-DD`, or nothing when it names no real day.
#[wasm_bindgen(js_name = calendarDate)]
#[must_use]
pub fn calendar_date_value(value: &str) -> Option<String> {
    calendar_date(value)
}

/// The NDC section a book's number falls in, as its three digits and name (`007 情報科学`), or
/// nothing when the text is no NDC number.
#[wasm_bindgen(js_name = ndcSection)]
#[must_use]
pub fn ndc_section_value(value: &str) -> Option<String> {
    ndc_section(value)
}

/// The four-digit NDC class a book's number falls in, as its digits and name in context
/// (`007.6 情報科学--データ処理．情報処理`), its section when NDC9 names no such class, or
/// nothing when the text is no NDC number.
#[wasm_bindgen(js_name = ndcSubsection)]
#[must_use]
pub fn ndc_subsection_value(value: &str) -> Option<String> {
    ndc_subsection(value)
}

/// The ten NDC main classes in order, as digit and name (`0 総記`).
#[wasm_bindgen(js_name = ndcClasses)]
#[must_use]
pub fn ndc_class_names() -> Vec<String> {
    ndc_classes()
}

/// One shelf the runtime opened. Its books stay in the core while the user changes the query, so
/// each query crosses the seam alone.
#[wasm_bindgen]
pub struct OpenShelf {
    index: ShelfIndex,
}

/// Opens a shelf over the JSON text of a `ShelfRequest`.
///
/// # Errors
/// Throws when the request is not a well-formed `ShelfRequest`.
#[wasm_bindgen(js_name = openShelf)]
pub fn open_shelf(request: &str) -> Result<OpenShelf, JsError> {
    let request: ShelfRequest = serde_json::from_str(request)?;
    Ok(OpenShelf {
        index: ShelfIndex::new(request),
    })
}

#[wasm_bindgen]
impl OpenShelf {
    /// The fields and tags the shelf offers, and how it shows each book.
    ///
    /// # Errors
    /// Throws when the overview cannot be passed back to JavaScript.
    pub fn overview(&self) -> Result<Ts<ShelfOverview>, JsError> {
        Ok(self.index.overview().into_ts()?)
    }

    /// The distinct texts a field holds, for the runtime to rank in its locale.
    #[wasm_bindgen(js_name = collationTexts)]
    #[must_use]
    pub fn collation_texts(&self, key: &str) -> Vec<String> {
        self.index.collation_texts(key)
    }

    /// Takes the rank of each collation text of a field; texts that compare equal share a rank.
    ///
    /// # Errors
    /// Throws when the ranks do not follow the collation texts one for one.
    pub fn collate(&mut self, key: &str, ranks: &[u32]) -> Result<(), JsError> {
        Ok(self.index.collate(key, ranks)?)
    }

    /// The books the JSON text of a `ShelfQuery` selects, in order.
    ///
    /// # Errors
    /// Throws when the query is malformed or its sort field and the title were not collated.
    pub fn select(&self, query: &str) -> Result<Ts<ShelfSelection>, JsError> {
        let query: ShelfQuery = serde_json::from_str(query)?;
        Ok(self.index.select(&query)?.into_ts()?)
    }
}

/// Reads the JSON text of a portable library into its notes, up to the first problem with the
/// document.
///
/// # Errors
/// Throws when the result cannot be passed back to JavaScript.
#[wasm_bindgen(js_name = decodePortableLibrary)]
pub fn decode_portable_library_text(json: &str) -> Result<Ts<PortableEnvelope>, JsError> {
    Ok(decode_portable_library(json).into_ts()?)
}

/// Whether notes may travel together, from the JSON text of `PortableNotes`.
///
/// # Errors
/// Throws when the request is not well-formed `PortableNotes`.
#[wasm_bindgen(js_name = checkPortableNotes)]
pub fn check_portable_notes_request(request: &str) -> Result<Ts<PortableVerdict>, JsError> {
    let request: PortableNotes = serde_json::from_str(request)?;
    Ok(check_portable_notes(&request).into_ts()?)
}

/// The JSON text of a portable library, from the JSON text of a `PortableExport` of checked notes.
///
/// # Errors
/// Throws when the request is not a well-formed `PortableExport`.
#[wasm_bindgen(js_name = encodePortableLibrary)]
pub fn encode_portable_library_request(request: &str) -> Result<String, JsError> {
    let request: PortableExport = serde_json::from_str(request)?;
    Ok(encode_portable_library(request)?)
}

/// Plans an import from the JSON text of an `ImportRequest`.
///
/// # Errors
/// Throws when the request is not a well-formed `ImportRequest`.
#[wasm_bindgen(js_name = planImport)]
pub fn plan_import_request(request: &str) -> Result<Ts<ImportPlan>, JsError> {
    let request: ImportRequest = serde_json::from_str(request)?;
    Ok(plan_import(&request).into_ts()?)
}
