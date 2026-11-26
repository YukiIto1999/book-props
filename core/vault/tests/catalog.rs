use book_props_vault::{CatalogRequest, inspect, normalize_isbns};
use serde_json::{Value, json};

fn catalog() -> Value {
    json!([{ "id": "book", "title": "設計入門", "authors": ["山田 太郎"], "wanted": true,
        "editions": [
            {"id": "first", "label": "初版", "owned": true, "isbns": ["9780306406157", "9780131103627"]},
            {"id": "second", "label": "改訂新版", "owned": false, "isbns": ["9780201633610"]}
        ]
    }])
}

fn request(action: &str, evidence: Value, mut books: Value) -> Value {
    // Matching ignores purchase receipts and pending moves; the stored books carry none here.
    for book in books.as_array_mut().expect("books") {
        book["appliedPurchases"] = json!([]);
        book["pendingMove"] = json!(false);
    }
    let input: CatalogRequest =
        serde_json::from_value(json!({ "action": action, "product": evidence, "books": books }))
            .expect("decode catalog request");
    serde_json::to_value(inspect(&input)).expect("encode outcome")
}

#[test]
fn isbns_are_canonical_isbn13_without_duplicates_or_name_the_first_invalid_input() {
    let isbns = |values: &[&str]| {
        let values: Vec<String> = values.iter().map(|value| (*value).to_owned()).collect();
        serde_json::to_value(normalize_isbns(&values)).expect("encode isbns")
    };
    assert_eq!(
        isbns(&["0-13-110362-8", "978-0131103627", " 080442957X "]),
        json!({"kind":"valid", "values":["9780131103627", "9780804429573"]})
    );
    assert_eq!(isbns(&[]), json!({"kind":"valid", "values":[]}));
    assert_eq!(
        isbns(&["9780306406157", "9780306406158", "x"]),
        json!({"kind":"invalid", "input":"9780306406158"})
    );
}

#[test]
fn another_isbn_for_the_owned_edition_does_not_make_a_second_edition() {
    let matched = request("inspect", json!({"isbns": ["0-13-110362-8"]}), catalog());
    assert_eq!(matched["ownership"], "sameEdition");
    assert_eq!(matched["editionId"], "first");
    assert_eq!(matched["wanted"], true);
}

#[test]
fn revised_edition_can_be_wanted_even_when_first_edition_is_owned() {
    let matched = request("inspect", json!({"isbns": ["9780201633610"]}), catalog());
    assert_eq!(matched["ownership"], "otherEdition");
    assert_eq!(matched["wanted"], true);
}

#[test]
fn different_isbn_without_edition_evidence_is_not_a_new_edition() {
    let matched = request(
        "purchase",
        json!({"title":"設計入門", "authors":["山田　太郎"], "isbns":["9780262033848"]}),
        catalog(),
    );
    assert_eq!(matched["ownership"], "unknownEdition");
    assert_eq!(matched["decision"]["kind"], "chooseEdition");
}

#[test]
fn explicit_known_revision_beats_a_new_isbn_but_not_a_conflicting_known_one() {
    let label = request(
        "inspect",
        json!({"title":"設計入門", "authors":["山田 太郎"], "isbns":["9780262033848"], "label":"改訂新版"}),
        catalog(),
    );
    assert_eq!(label["editionId"], "second");
    let conflict = request(
        "inspect",
        json!({"title":"設計入門", "authors":["山田 太郎"], "isbns":["9780306406157"], "label":"改訂新版"}),
        catalog(),
    );
    assert_eq!(conflict["ownership"], "undetermined");
    assert_eq!(conflict["decision"]["kind"], "conflictingEvidence");
}

#[test]
fn a_unique_isbn_distinguishes_books_with_the_same_title_and_authors() {
    let mut books = catalog();
    books.as_array_mut().unwrap().push(json!({
        "id": "other", "title": "設計入門", "authors": ["山田 太郎"], "wanted": false,
        "editions": [{"id": "different", "owned": true, "isbns": ["9780131101630"]}]
    }));
    let mut product = json!({"title":"設計入門","authors":["山田 太郎"],"isbns":["9780306406157"]});
    let matched = request("inspect", product.clone(), books.clone());
    assert_eq!(matched["bookId"], "book");
    assert_eq!(matched["ownership"], "sameEdition");
    product["isbns"] = json!(["9780131101630"]);
    assert_eq!(
        request("inspect", product.clone(), books.clone())["bookId"],
        "other"
    );
    books[0]["title"] = json!("別の書名");
    product["isbns"] = json!(["9780306406157"]);
    assert_eq!(
        request("inspect", product, books)["decision"]["kind"],
        "conflictingEvidence"
    );
}

#[test]
fn purchase_and_preexisting_ownership_have_different_effects_on_the_wish() {
    let product = json!({"isbns": ["9780201633610"]});
    let purchase = request("purchase", product.clone(), catalog());
    assert_eq!(
        purchase["decision"],
        json!({"kind":"update", "wantedBefore":true, "wantedAfter":false, "ownedBefore":false, "ownedAfter":true})
    );
    let historical = request("recordOwnership", product, catalog());
    assert_eq!(
        historical["decision"],
        json!({"kind":"update", "wantedBefore":true, "wantedAfter":true, "ownedBefore":false, "ownedAfter":true})
    );
}

#[test]
fn title_alone_does_not_establish_identity_and_invalid_isbn_is_called_out() {
    let unknown = request("inspect", json!({"title":"設計入門"}), catalog());
    assert_eq!(unknown["ownership"], "undetermined");
    assert_eq!(unknown["decision"]["kind"], "insufficientEvidence");
    let invalid = request("inspect", json!({"isbns":["9780306406158"]}), catalog());
    assert_eq!(
        invalid["decision"],
        json!({"kind":"invalidIsbn", "input":"9780306406158"})
    );
}

#[test]
fn setting_a_book_wish_does_not_require_choosing_its_edition() {
    let result = request(
        "clearWish",
        json!({"title":"設計入門", "authors":["山田 太郎"]}),
        catalog(),
    );
    assert_eq!(
        result["decision"],
        json!({"kind":"update", "wantedBefore":true, "wantedAfter":false})
    );
}

#[test]
fn explicit_revised_edition_of_owned_first_edition_is_distinct() {
    let result = request(
        "purchase",
        json!({"title":"良いコード／悪いコードで学ぶ設計入門 ―保守しやすい 成長し続けるコードの書き方", "authors":["仙塲 大也"], "isbns":["9784297146221"], "label":"改訂新版"}),
        json!([{"id":"book","title":"良いコード/悪いコードで学ぶ設計入門 -保守しやすい　成長し続けるコードの書き方","authors":["仙塲大也"],"wanted":true,"editions":[{"id":"first","label":"初版","owned":true,"isbns":["9784297127831"]}]}]),
    );
    assert_eq!(result["ownership"], "otherEdition");
    assert_eq!(result["wanted"], true);
    assert_eq!(result["decision"]["kind"], "addEdition");
}

#[test]
fn edition_ambiguity_does_not_block_a_wish_for_one_known_book() {
    let both = json!({ "isbns": ["9780306406157", "9780201633610"] });
    let result = request("clearWish", both.clone(), catalog());
    assert_eq!(result["ownership"], "undetermined");
    assert_eq!(result["bookId"], "book");
    assert_eq!(
        result["decision"],
        json!({ "kind": "update", "wantedBefore": true, "wantedAfter": false })
    );
    let result = request("purchase", both, catalog());
    assert_eq!(result["decision"]["kind"], "conflictingEvidence");
}

#[test]
fn an_archived_book_does_not_report_ownership_or_wish_but_still_blocks_duplicate_purchase() {
    let mut books = catalog();
    books[0]["archivedAt"] = json!("2025-01-01T00:00:00Z");
    let product = json!({"title":"設計入門","authors":["山田 太郎"],"isbns":["9780306406157"]});
    let result = request("inspect", product.clone(), books.clone());
    assert_eq!(result["ownership"], "unowned");
    assert_eq!(result["wanted"], false);
    assert_eq!(result["bookId"], Value::Null);
    assert_eq!(
        request("purchase", product, books)["decision"]["kind"],
        "conflictingEvidence"
    );
}

#[test]
fn an_archived_edition_does_not_hide_an_active_book_or_count_as_another_owned_edition() {
    let mut books = catalog();
    books[0]["editions"][0]["archivedAt"] = json!("2025-01-01T00:00:00Z");
    let product = json!({"isbns":["9780306406157"]});
    let result = request("inspect", product.clone(), books.clone());
    assert_eq!(result["ownership"], "unowned");
    assert_eq!(result["bookId"], "book");
    assert_eq!(result["wanted"], true);
    assert_eq!(result["editionId"], Value::Null);
    assert_eq!(
        request("purchase", product, books.clone())["decision"]["kind"],
        "conflictingEvidence"
    );
    assert_eq!(
        request("inspect", json!({"isbns":["9780201633610"]}), books)["ownership"],
        "unowned"
    );
}
