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

/// Which receipts are past the retention period. A receipt whose time cannot be read is kept.
#[must_use]
pub fn expired_receipts(request: &ExpiryRequest) -> ReceiptExpiry {
    let before = request.now - RECEIPT_RETENTION_MS;
    ReceiptExpiry {
        expired: request
            .receipts
            .iter()
            .map(|receipt| parse_instant(&receipt.applied_at).is_some_and(|at| at < before))
            .collect(),
    }
}

/// The instant as JavaScript's `Date.prototype.toISOString` writes it.
pub(crate) fn format_instant(epoch_ms: i64) -> String {
    let days = epoch_ms.div_euclid(DAY_MS);
    let time = epoch_ms.rem_euclid(DAY_MS);
    let (year, month, day) = civil_from_days(days);
    let year = if (0..=9999).contains(&year) {
        format!("{year:04}")
    } else {
        format!(
            "{}{:06}",
            if year < 0 { '-' } else { '+' },
            year.unsigned_abs()
        )
    };
    format!(
        "{year}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z",
        time / 3_600_000,
        time / 60_000 % 60,
        time / 1000 % 60,
        time % 1000
    )
}

/// Milliseconds since the epoch of `YYYY-MM-DDTHH:MM:SS[.sss]Z`, read as JavaScript's
/// `Date.parse` reads it: a day past the end of its month runs into the next month, and
/// `24:00:00` is the end of the day.
pub(crate) fn parse_instant(text: &str) -> Option<i64> {
    let bytes = text.as_bytes();
    let millis_present = match bytes.len() {
        20 => false,
        24 => true,
        _ => return None,
    };
    let separators: &[(usize, u8)] = if millis_present {
        &[
            (4, b'-'),
            (7, b'-'),
            (10, b'T'),
            (13, b':'),
            (16, b':'),
            (19, b'.'),
            (23, b'Z'),
        ]
    } else {
        &[
            (4, b'-'),
            (7, b'-'),
            (10, b'T'),
            (13, b':'),
            (16, b':'),
            (19, b'Z'),
        ]
    };
    if separators
        .iter()
        .any(|&(index, separator)| bytes[index] != separator)
    {
        return None;
    }
    let number = |start: usize, end: usize| {
        bytes[start..end].iter().try_fold(0_i64, |value, &byte| {
            byte.is_ascii_digit()
                .then(|| value * 10 + i64::from(byte - b'0'))
        })
    };
    let (year, month, day) = (number(0, 4)?, number(5, 7)?, number(8, 10)?);
    let (hour, minute, second) = (number(11, 13)?, number(14, 16)?, number(17, 19)?);
    let millis = if millis_present { number(20, 23)? } else { 0 };
    let end_of_day = hour == 24 && minute == 0 && second == 0 && millis == 0;
    let in_range = (1..=12).contains(&month)
        && (1..=31).contains(&day)
        && (hour < 24 || end_of_day)
        && minute < 60
        && second < 60;
    in_range.then(|| {
        (days_from_civil(year, month) + day - 1) * DAY_MS
            + hour * 3_600_000
            + minute * 60_000
            + second * 1000
            + millis
    })
}

/// Days since 1970-01-01 of the first day of the month (proleptic Gregorian calendar).
fn days_from_civil(year: i64, month: i64) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = year.div_euclid(400);
    let year_of_era = year.rem_euclid(400);
    let day_of_year = (153 * (month + if month > 2 { -3 } else { 9 }) + 2) / 5;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

/// The year, month, and day of a day count since 1970-01-01.
fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let days = days + 719_468;
    let era = days.div_euclid(146_097);
    let day_of_era = days.rem_euclid(146_097);
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let shifted_month = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * shifted_month + 2) / 5 + 1;
    let month = if shifted_month < 10 {
        shifted_month + 3
    } else {
        shifted_month - 9
    };
    let year = year_of_era + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

#[cfg(test)]
mod tests {
    use super::{format_instant, parse_instant};

    #[test]
    fn instants_read_and_write_as_javascript_dates_do() {
        // Values observed from V8's Date.parse and Date.prototype.toISOString.
        for (text, expected) in [
            ("2024-02-30T00:00:00Z", Some(1_709_251_200_000)),
            ("2024-02-31T00:00:00Z", Some(1_709_337_600_000)),
            ("2023-02-29T00:00:00Z", Some(1_677_628_800_000)),
            ("2024-04-31T00:00:00Z", Some(1_714_521_600_000)),
            ("2024-01-01T24:00:00Z", Some(1_704_153_600_000)),
            ("2024-01-01T24:00:00.000Z", Some(1_704_153_600_000)),
            ("2024-01-01T00:00:00.123Z", Some(1_704_067_200_123)),
            ("0000-01-01T00:00:00Z", Some(-62_167_219_200_000)),
            ("2024-01-32T00:00:00Z", None),
            ("2024-13-01T00:00:00Z", None),
            ("2024-00-01T00:00:00Z", None),
            ("2024-01-00T00:00:00Z", None),
            ("2024-01-01T24:00:01Z", None),
            ("2024-01-01T25:00:00Z", None),
            ("2024-01-01T23:60:00Z", None),
            ("2024-01-01T23:59:60Z", None),
            ("2024-01-01T00:00:00+00:00", None),
            ("２024-01-01T00:00:00Z", None),
        ] {
            assert_eq!(parse_instant(text), expected, "{text}");
        }
        assert_eq!(format_instant(0), "1970-01-01T00:00:00.000Z");
        assert_eq!(
            format_instant(1_704_067_200_123),
            "2024-01-01T00:00:00.123Z"
        );
        assert_eq!(
            format_instant(-62_198_755_200_001),
            "-000002-12-31T23:59:59.999Z"
        );
        assert_eq!(
            format_instant(253_402_300_800_000),
            "+010000-01-01T00:00:00.000Z"
        );
    }
}
