//! Catalog rules for the Vault: identity evidence, matching, and the decisions they lead to.

mod identity;
mod matching;
mod model;

pub use matching::inspect;
pub use model::{
    Action, Book, CatalogRequest, Decision, Details, Edition, EditionPatch, IsbnList, Outcome,
    Ownership, Product, Selection,
};
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
