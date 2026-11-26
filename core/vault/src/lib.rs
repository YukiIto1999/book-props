//! Catalog rules for the Vault: identity evidence, matching, the decisions they lead to, the
//! purchase changes planned from them, and the management of stored books and edition moves.

mod change;
mod identity;
mod management;
mod matching;
mod model;
mod moving;
mod receipt;

pub use change::plan_change;
pub use management::{allows_step, plan_management};
pub use matching::inspect;
pub use model::{
    Action, Admission, Book, BookStep, BookWrite, BooksRequest, CatalogRequest, ChangePlan,
    ChangeRequest, CopiesRequest, CustomField, Decision, Details, Edition, EditionPatch,
    EditionWrite, ExpiryRequest, IsbnList, ManagementCommand, ManagementPlan, ManagementRequest,
    MissingCopies, MoveBackup, MoveCopy, MoveMarker, MovePlan, MoveRequest, MoveSource, MoveStage,
    NewBook, Outcome, Ownership, Product, PurchaseKey, Receipt, ReceiptExpiry, ReceiptWrite,
    ReconcileRequest, Reconciliation, Selection, SettledShelf, ShelfBook, StepRequest, WritePlan,
};
pub use moving::{missing_move_copies, plan_move, settle_shelf};
pub use receipt::{admits, expired_receipts, reconcile};
use tsify::{Ts, Tsify};
use wasm_bindgen::prelude::{JsError, wasm_bindgen};

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
