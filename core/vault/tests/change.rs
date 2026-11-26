use book_props_vault::{
    Admission, ChangeRequest, ExpiryRequest, ReconcileRequest, admits, expired_receipts,
    plan_change, reconcile,
};
use serde_json::{Value, json};

const NOW: i64 = 1_764_115_200_000; // 2025-11-26T00:00:00.000Z
const DAY: i64 = 24 * 60 * 60 * 1000;
const CLIENT: &str = "38605c33-2b34-44ae-8e19-83b319e93a61";
const REQUEST: &str = "037516ec-8d03-4db4-a13b-1062fbaad566";
const HASH: &str = "70f4fc2bf7dcb3ebdaab9093c735fae0e2a7250b910a7eea5754f77bfba64574";

fn key(issued_at: Value) -> Value {
    json!({ "clientId": CLIENT, "requestId": REQUEST, "issuedAt": issued_at })
}

fn receipt(input_hash: &str, book_id: &str) -> Value {
    json!({ "requestId": REQUEST, "clientId": CLIENT, "inputHash": input_hash,
        "bookId": book_id, "editionId": "first" })
}

fn book(receipts: Value, pending_move: bool) -> Value {
    let mut book = json!({ "id": "book", "title": "設計入門", "authors": ["山田 太郎"],
        "wanted": true,
        "editions": [
            {"id": "first", "label": "初版", "owned": true, "isbns": ["9780306406157"],
             "details": {"publisher": "技術社"}},
            {"id": "second", "label": "改訂新版", "owned": false, "isbns": ["9780201633610"]}
        ],
        "appliedPurchases": receipts });
    if pending_move {
        book["pendingMove"] =
            json!({"editionId": "first", "destinationId": "other", "digest": "0".repeat(64)});
    }
    book
}

fn change(
    action: &str,
    product: Value,
    books: Value,
    purchase: Option<Value>,
    expected: Option<&str>,
) -> Value {
    let mut request = json!({
        "catalog": { "action": action, "product": product, "books": books },
        "now": NOW, "newBookId": "new-book", "newEditionId": "new-edition",
    });
    if let Some(purchase) = purchase {
        request["purchase"] = purchase;
        request["inputHash"] = json!(HASH);
    }
    if let Some(expected) = expected {
        request["expected"] = json!(expected);
    }
    let request: ChangeRequest = serde_json::from_value(request).expect("decode change request");
    serde_json::to_value(plan_change(&request)).expect("encode change plan")
}

fn purchase(product: Value, books: Value, expected: Option<&str>) -> Value {
    change("purchase", product, books, Some(key(json!(NOW))), expected)
}

#[test]
fn a_purchase_key_is_accepted_only_when_well_formed_and_issued_within_the_last_day() {
    let admitted = |action: &str, purchase: Option<Value>| {
        let mut request = json!({ "action": action, "now": NOW });
        if let Some(purchase) = purchase {
            request["purchase"] = purchase;
        }
        let request: Admission = serde_json::from_value(request).expect("decode admission");
        admits(&request)
    };
    assert!(admitted("purchase", Some(key(json!(NOW)))));
    assert!(admitted("purchase", Some(key(json!(NOW - DAY)))));
    assert!(!admitted("purchase", Some(key(json!(NOW - DAY - 1)))));
    assert!(!admitted("purchase", Some(key(json!(NOW + 1)))));
    assert!(!admitted("purchase", Some(key(json!(NOW as f64 - 0.5)))));
    assert!(!admitted("purchase", Some(key(Value::Null))));
    assert!(!admitted("purchase", Some(key(json!(1.0e300)))));
    assert!(!admitted("purchase", None));
    let uppercase =
        json!({ "clientId": CLIENT.to_uppercase(), "requestId": REQUEST, "issuedAt": NOW });
    assert!(!admitted("purchase", Some(uppercase)));
    let version_zero = json!({ "clientId": CLIENT, "requestId": "037516ec-8d03-0db4-a13b-1062fbaad566", "issuedAt": NOW });
    assert!(!admitted("purchase", Some(version_zero)));
    assert!(admitted("setWish", None));
    assert!(admitted("inspect", Some(key(Value::Null))));
}

#[test]
fn a_retried_purchase_replays_its_receipt_and_different_contents_conflict() {
    let product = json!({"isbns": ["9780306406157"]});
    let applied = purchase(
        product.clone(),
        json!([book(json!([receipt(HASH, "book")]), false)]),
        None,
    );
    assert_eq!(
        applied,
        json!({"kind": "replayed", "bookId": "book", "editionId": "first"})
    );
    let changed = purchase(
        product.clone(),
        json!([book(json!([receipt(&"0".repeat(64), "book")]), false)]),
        None,
    );
    assert_eq!(changed, json!({"kind": "conflict"}));
    let mut other = book(json!([receipt(HASH, "other")]), false);
    other["id"] = json!("other");
    other["editions"] = json!([]);
    let twice = purchase(
        product.clone(),
        json!([book(json!([receipt(HASH, "book")]), false), other]),
        None,
    );
    assert_eq!(twice, json!({"kind": "conflict"}));

    let reconciled = |books: Value| {
        let request: ReconcileRequest = serde_json::from_value(
            json!({ "purchase": key(json!(NOW)), "inputHash": HASH, "books": books }),
        )
        .expect("decode reconcile request");
        serde_json::to_value(reconcile(&request)).expect("encode reconciliation")
    };
    assert_eq!(
        reconciled(json!([book(json!([receipt(HASH, "book")]), false)]))["kind"],
        "replayed"
    );
    assert_eq!(
        reconciled(json!([book(
            json!([receipt(&"0".repeat(64), "book")]),
            false
        )])),
        json!({"kind": "conflict"})
    );
    assert_eq!(
        reconciled(json!([book(json!([]), false)])),
        json!({"kind": "unknown"})
    );
}

#[test]
fn a_pending_move_blocks_changes_but_the_first_read_still_answers_a_replay() {
    let product = json!({"isbns": ["9780306406157"]});
    let receipts = json!([receipt(HASH, "book")]);
    assert_eq!(
        purchase(product.clone(), json!([book(receipts.clone(), true)]), None)["kind"],
        "replayed"
    );
    assert_eq!(
        purchase(product.clone(), json!([book(receipts, true)]), Some("[]")),
        json!({"kind": "unavailable"})
    );
    assert_eq!(
        purchase(product, json!([book(json!([]), true)]), None),
        json!({"kind": "unavailable"})
    );
}

#[test]
fn the_first_read_observes_inspections_and_asks_before_ambiguous_changes() {
    let books = json!([book(json!([]), false)]);
    let inspected = change(
        "inspect",
        json!({"isbns": ["9780306406157"]}),
        books.clone(),
        None,
        None,
    );
    assert_eq!(inspected["kind"], "observed");
    assert_eq!(inspected["outcome"]["editionId"], "first");
    let unknown = change(
        "clearWish",
        json!({"isbns": ["9780262033848"]}),
        books.clone(),
        None,
        None,
    );
    assert_eq!(unknown["kind"], "observed");
    assert_eq!(unknown["outcome"]["bookId"], Value::Null);
    let ambiguous = purchase(
        json!({"title": "設計入門", "authors": ["山田 太郎"], "isbns": ["9780262033848"]}),
        books,
        None,
    );
    assert_eq!(ambiguous["kind"], "needsInput");
    assert_eq!(ambiguous["outcome"]["decision"]["kind"], "chooseEdition");
}

#[test]
fn a_new_purchase_creates_a_book_with_its_edition_and_receipt() {
    let product = json!({
        "title": "\u{feff} 新しい本\u{3000}", "authors": ["著者"], "isbns": ["978-0-262-03384-8"],
        "label": "", "details": {"publisher": "出版社", "cover": ""}
    });
    let planned = purchase(product, json!([]), None);
    let edition = json!({"id": "new-edition", "owned": true, "isbns": ["9780262033848"],
        "publisher": "出版社"});
    let applied = json!({"requestId": REQUEST, "clientId": CLIENT, "inputHash": HASH,
        "appliedAtMs": NOW, "bookId": "new-book", "editionId": "new-edition"});
    assert_eq!(
        planned,
        json!({
            "kind": "write",
            "revision": r#"["createBook",null,null,false,null]"#,
            "bookId": "new-book",
            "editionId": "new-edition",
            "change": {"wanted": false, "edition": edition, "receipt": applied},
            "newBook": {"id": "new-book", "title": "新しい本", "authors": ["著者"], "wanted": false,
                "editions": [edition], "appliedPurchases": [applied]}
        })
    );
    let wish = change(
        "setWish",
        json!({"title": "欲しい本", "authors": ["誰か"]}),
        json!([]),
        None,
        None,
    );
    assert_eq!(wish["change"], json!({"wanted": true}));
    assert_eq!(wish["newBook"]["editions"], json!([]));
    assert!(wish.get("editionId").is_none());
}

#[test]
fn buying_a_stored_edition_fills_only_blank_values_and_records_the_receipt() {
    let product = json!({"isbns": ["9780201633610", "9780131103627"], "label": "改訂新版",
        "details": {"publisher": "別の社", "purchasedOn": "2025-11-25"}});
    let books = json!([book(json!([]), false)]);
    let first = purchase(product.clone(), books.clone(), None);
    let revision = first["revision"].as_str().expect("revision").to_owned();
    assert_eq!(revision, r#"["update","book","second",true,false]"#);
    let fresh = purchase(product.clone(), books, Some(&revision));
    assert_eq!(first, fresh);
    assert_eq!(
        fresh["change"]["edition"],
        json!({"id": "second", "owned": true, "isbns": ["9780201633610", "9780131103627"],
            "publisher": "別の社", "purchasedOn": "2025-11-25"})
    );
    assert_eq!(fresh["change"]["wanted"], false);
    assert_eq!(fresh["change"]["receipt"]["editionId"], "second");
    assert!(fresh.get("newBook").is_none());

    let mut changed = book(json!([]), false);
    changed["wanted"] = json!(false);
    assert_eq!(
        purchase(product, json!([changed]), Some(&revision)),
        json!({"kind": "conflict"})
    );
}

#[test]
fn receipts_expire_seven_days_after_they_were_applied() {
    let request: ExpiryRequest = serde_json::from_value(json!({
        "now": NOW,
        "appliedAtMs": [NOW - 7 * DAY, NOW - 7 * DAY - 1, NOW - 8 * DAY, null],
    }))
    .expect("decode expiry request");
    assert_eq!(
        serde_json::to_value(expired_receipts(&request)).expect("encode expiry"),
        json!({"expired": [false, true, true, false]})
    );
}
