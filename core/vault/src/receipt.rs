//! Purchase keys, applied-purchase receipts, and how long each is honoured.

use crate::model::{
    Action, Admission, Book, ExpiryRequest, PurchaseKey, Receipt, ReceiptExpiry, ReconcileRequest,
    Reconciliation,
};

const DAY_MS: i64 = 24 * 60 * 60 * 1000;
/// How long after issuing a purchase key the browser may send or retry it.
const RETRY_WINDOW_MS: i64 = DAY_MS;
/// How long a receipt stays after it was applied: past the retry window, with a margin.
const RECEIPT_RETENTION_MS: i64 = 7 * RETRY_WINDOW_MS;
/// The largest integer a JavaScript number holds exactly.
const MAX_SAFE_INTEGER: f64 = 9_007_199_254_740_991.0;

/// Whether the operation may start: a purchase needs a well-formed key issued within the retry
/// window.
#[must_use]
pub fn admits(request: &Admission) -> bool {
    request.action != Action::Purchase
        || request
            .purchase
            .as_ref()
            .is_some_and(|key| valid_key(key, request.now))
}

fn valid_key(key: &PurchaseKey, now: i64) -> bool {
    let Some(issued_at) = key.issued_at else {
        return false;
    };
    let age = now as f64 - issued_at;
    is_uuid(&key.client_id)
        && is_uuid(&key.request_id)
        && issued_at.fract() == 0.0
        && issued_at.abs() <= MAX_SAFE_INTEGER
        && (0.0..=RETRY_WINDOW_MS as f64).contains(&age)
}

/// A lowercase RFC 9562 UUID of versions 1 to 8.
fn is_uuid(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 36
        && bytes.iter().enumerate().all(|(index, &byte)| match index {
            8 | 13 | 18 | 23 => byte == b'-',
            14 => (b'1'..=b'8').contains(&byte),
            19 => matches!(byte, b'8' | b'9' | b'a' | b'b'),
            _ => byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte),
        })
}

/// A purchase request the catalog has seen before.
pub(crate) enum Replay<'a> {
    /// One book records the request with the same contents.
    Applied(&'a Receipt),
    /// The contents differ, or more than one book records the request.
    Conflict,
}

/// Finds the receipt for the purchase key among the books.
pub(crate) fn replay<'a>(
    books: &'a [Book],
    purchase: Option<&PurchaseKey>,
    input_hash: Option<&str>,
) -> Option<Replay<'a>> {
    let purchase = purchase?;
    let input_hash = input_hash.filter(|hash| !hash.is_empty())?;
    let mut found = None;
    for book in books {
        let Some(receipt) = book.applied_purchases.iter().find(|receipt| {
            receipt.client_id == purchase.client_id && receipt.request_id == purchase.request_id
        }) else {
            continue;
        };
        if found.is_some() || receipt.input_hash != input_hash {
            return Some(Replay::Conflict);
        }
        found = Some(receipt);
    }
    found.map(Replay::Applied)
}

/// Whether the catalog already applied the purchase.
#[must_use]
pub fn reconcile(request: &ReconcileRequest) -> Reconciliation {
    match replay(
        &request.books,
        Some(&request.purchase),
        Some(&request.input_hash),
    ) {
        Some(Replay::Applied(receipt)) => Reconciliation::Replayed {
            book_id: receipt.book_id.clone(),
            edition_id: receipt.edition_id.clone(),
        },
        Some(Replay::Conflict) => Reconciliation::Conflict,
        None => Reconciliation::Unknown,
    }
}

/// Which receipts are past the retention period. A receipt whose time the runtime could not read
/// is kept.
#[must_use]
pub fn expired_receipts(request: &ExpiryRequest) -> ReceiptExpiry {
    let before = (request.now - RECEIPT_RETENTION_MS) as f64;
    ReceiptExpiry {
        expired: request
            .applied_at_ms
            .iter()
            .map(|applied_at| applied_at.is_some_and(|at| at < before))
            .collect(),
    }
}
