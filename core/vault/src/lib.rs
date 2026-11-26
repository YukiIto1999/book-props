//! Catalog rules for the Vault: identity evidence, matching, the decisions they lead to, and the
//! purchase changes planned from them.

mod change;
mod identity;
mod matching;
mod model;
mod receipt;

pub use change::plan_change;
pub use matching::inspect;
pub use model::{
    Action, Admission, Book, BookWrite, CatalogRequest, ChangePlan, ChangeRequest, Decision,
    Details, Edition, EditionPatch, EditionWrite, ExpiryRequest, IsbnList, NewBook, Outcome,
    Ownership, Product, PurchaseKey, Receipt, ReceiptExpiry, ReconcileRequest, Reconciliation,
    Selection, WritePlan,
};
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
