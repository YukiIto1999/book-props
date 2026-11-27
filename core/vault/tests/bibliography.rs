use book_props_vault::{
    BibliographyRequest, ChangeRequest, EnrichmentPlan, plan_change, plan_enrichment, plan_review,
};
use serde_json::{Value, json};

const NOW: i64 = 1_764_115_200_000;
const ISBN: &str = "9784873115658";

fn record() -> Value {
    json!({
        "title": "リーダブルコード : より良いコードを書くためのシンプルで実践的なテクニック",
        "creators": ["Boswell, Dustin", "Foucher, Trevor", "角, 征典"],
        "statement": "Dustin Boswell, Trevor Foucher 著,角征典 訳",
        "publishers": ["オライリー・ジャパン", "オーム社 (発売)"],
        "series": ["THEORY/IN/PRACTICE"],
        "ndc": [{"edition": 9, "number": "007.64"}]
    })
}

fn store_product() -> Value {
    json!({
        "title": "リーダブルコード ―より良いコードを書くためのシンプルで実践的なテクニック (Theory in practice)",
        "authors": ["ダスティン・ボズウェル", "トレバ-・フォシェ", "角 征典（翻訳）"],
        "isbns": ["4873115655"],
        "details": {"publisher": "オライリージャパン"}
    })
}

fn plan(action: &str, product: Value, books: Value, lookup: bool) -> Value {
    let request = json!({
        "catalog": { "action": action, "product": product, "books": books },
        "now": NOW, "newBookId": "new-book", "newEditionId": "new-edition", "lookup": lookup,
    });
    let request: ChangeRequest = serde_json::from_value(request).expect("decode change request");
    serde_json::to_value(plan_change(&request)).expect("encode change plan")
}

/// The stored book a write plan creates, as the runtime reads it back.
fn stored(plan: &Value) -> Value {
    let new_book = &plan["newBook"];
    let edition = &new_book["editions"][0];
    json!({
        "id": new_book["id"], "title": new_book["title"], "authors": new_book["authors"],
        "wanted": new_book["wanted"],
        "editions": [{
            "id": edition["id"], "owned": edition["owned"], "isbns": edition["isbns"],
            "details": {"publisher": edition["publisher"]}
        }],
        "appliedPurchases": [],
        "authorRoles": new_book["authorRoles"],
        "pendingLookup": plan["pendingLookup"]
    })
}

fn enrich(book: &Value, answers: Value) -> Value {
    let request: BibliographyRequest =
        serde_json::from_value(json!({"book": book, "answers": answers})).expect("decode request");
    serde_json::to_value(plan_enrichment(&request)).expect("encode plan")
}

fn review(book: &Value, answers: Value) -> Value {
    let request: BibliographyRequest =
        serde_json::from_value(json!({"book": book, "answers": answers})).expect("decode request");
    serde_json::to_value(plan_review(&request)).expect("encode revision")
}
#[test]
fn a_product_is_written_in_the_stored_spelling() {
    let planned = plan("recordOwnership", store_product(), json!([]), false);
    let book = &planned["newBook"];
    assert_eq!(
        book["title"],
        "リーダブルコード : より良いコードを書くためのシンプルで実践的なテクニック (Theory in practice)"
    );
    assert_eq!(
        book["authors"],
        json!(["ダスティン・ボズウェル", "トレバー・フォシェ", "角 征典"])
    );
    assert_eq!(
        book["authorRoles"],
        json!([{"name": "角 征典", "role": "訳"}])
    );
    assert_eq!(book["editions"][0]["publisher"], "オライリージャパン");
    assert!(planned.get("pendingLookup").is_none());
}

#[test]
fn a_stored_book_matches_other_spellings_of_its_authors() {
    let books = json!([{
        "id": "book", "title": "リーダブルコード", "authors": ["トレバ-・フォシェ", "角征典"],
        "wanted": true, "editions": [], "appliedPurchases": []
    }]);
    let product =
        json!({"title": "リーダブルコード", "authors": ["角 征典（翻訳）", "トレバー・フォシェ"]});
    let planned = plan("setWish", product, books, false);
    assert_eq!(planned["kind"], "write");
    assert_eq!(planned["bookId"], "book");
}

#[test]
fn the_library_record_replaces_only_what_the_write_left() {
    let planned = plan("recordOwnership", store_product(), json!([]), true);
    let book = stored(&planned);
    assert_eq!(
        enrich(&book, json!([])),
        json!({"kind": "lookup", "isbns": [ISBN]})
    );
    let written = enrich(&book, json!([{"isbn": ISBN, "record": record()}]));
    assert_eq!(written["kind"], "write");
    let revision = &written["revision"];
    assert_eq!(
        revision["title"],
        "リーダブルコード : より良いコードを書くためのシンプルで実践的なテクニック"
    );
    assert_eq!(
        revision["authors"],
        json!(["Dustin Boswell", "Trevor Foucher", "角 征典"])
    );
    assert_eq!(
        revision["authorRoles"],
        json!([{"name": "角 征典", "role": "訳"}])
    );
    assert_eq!(
        revision["editions"],
        json!([{"id": "new-edition", "publisher": "オライリー・ジャパン",
            "series": [{"isbn": ISBN, "name": "THEORY/IN/PRACTICE"}]}])
    );
    assert_eq!(revision["endsLookups"], true);

    let mut edited = book.clone();
    edited["title"] = json!("リーダブルコード");
    edited["editions"][0]["details"]["publisher"] = json!("自分で直した出版社");
    let kept = enrich(&edited, json!([{"isbn": ISBN, "record": record()}]));
    let revision = &kept["revision"];
    assert!(revision.get("title").is_none());
    assert_eq!(
        revision["authors"],
        json!(["Dustin Boswell", "Trevor Foucher", "角 征典"])
    );
    assert_eq!(
        revision["editions"],
        json!([{"id": "new-edition", "series": [{"isbn": ISBN, "name": "THEORY/IN/PRACTICE"}]}])
    );
}

#[test]
fn no_record_keeps_the_written_values_and_ends_the_lookup() {
    let planned = plan("recordOwnership", store_product(), json!([]), true);
    let answered = enrich(&stored(&planned), json!([{"isbn": ISBN}]));
    assert_eq!(
        answered,
        json!({"kind": "write", "revision": {"editions": [], "endsLookups": true}})
    );
    let mut settled = stored(&planned);
    settled
        .as_object_mut()
        .expect("book")
        .remove("pendingLookup");
    assert!(matches!(
        serde_json::from_value::<BibliographyRequest>(json!({"book": settled}))
            .map(|request| plan_enrichment(&request)),
        Ok(EnrichmentPlan::None)
    ));
}

#[test]
fn the_library_classifies_only_a_book_without_a_number() {
    let planned = plan("recordOwnership", store_product(), json!([]), true);
    let book = stored(&planned);
    let answers = json!([{"isbn": ISBN, "record": record()}]);
    assert_eq!(
        enrich(&book, answers.clone())["revision"]["classification"],
        "007.64"
    );
    let mut classified = book.clone();
    classified["classification"] = json!("007.6");
    let kept = enrich(&classified, answers.clone());
    assert!(kept["revision"].get("classification").is_none());

    let mut enriched = book;
    enriched
        .as_object_mut()
        .expect("book")
        .remove("pendingLookup");
    assert_eq!(
        review(&enriched, answers.clone())["classification"],
        "007.64"
    );
    assert!(review(&enriched, json!([])).get("classification").is_none());
    enriched["classification"] = json!(" ");
    assert_eq!(
        review(&enriched, answers.clone())["classification"],
        "007.64"
    );
    enriched["classification"] = json!("007.6");
    assert!(review(&enriched, answers).get("classification").is_none());
}

#[test]
fn a_library_product_classifies_the_book_it_records() {
    let product = json!({"title": "リーダブルコード", "authors": ["角征典"], "isbns": [ISBN],
        "classification": "007.64"});
    let created = plan("recordOwnership", product.clone(), json!([]), false);
    assert_eq!(created["newBook"]["classification"], "007.64");
    assert!(created["change"].get("classification").is_none());

    let mut books = json!([{
        "id": "book", "title": "リーダブルコード", "authors": ["角征典"], "wanted": true,
        "editions": [{"id": "first", "owned": false, "isbns": [ISBN], "details": {}}],
        "appliedPurchases": []
    }]);
    let recorded = plan("recordOwnership", product.clone(), books.clone(), false);
    assert_eq!(recorded["change"]["classification"], "007.64");
    let cleared = plan("clearWish", product.clone(), books.clone(), false);
    assert!(cleared["change"].get("classification").is_none());
    books[0]["classification"] = json!("913.6");
    let kept = plan("recordOwnership", product, books, false);
    assert!(kept["change"].get("classification").is_none());
}
#[test]
fn a_wish_for_a_stored_book_waits_for_no_lookup() {
    let books = json!([{
        "id": "book", "title": "リーダブルコード", "authors": ["角征典"], "wanted": false,
        "editions": [{"id": "first", "owned": true, "isbns": [ISBN], "label": "初版",
            "details": {"publisher": "自分で書いた出版社"}, "series": [{"isbn": ISBN, "name": "既知"}]}],
        "appliedPurchases": []
    }]);
    let planned = plan("setWish", store_product(), books.clone(), true);
    assert_eq!(planned["kind"], "write");
    assert!(planned.get("pendingLookup").is_none());
    let bought = plan("purchase", store_product(), books, true);
    assert!(bought.get("pendingLookup").is_none());
}

#[test]
fn a_review_proposes_the_stored_spelling_and_the_library_record() {
    let book = json!({
        "id": "book", "title": "はじめての言語ゲーム (講談社現代新書 2004)",
        "authors": ["島田 浩二（翻訳）", "菊池 たけし/F.E.A.R."], "wanted": false,
        "editions": [{"id": "first", "owned": true, "isbns": ["9784062880046"],
            "details": {"publisher": "講談社"}, "series": [{"isbn": "9784062880046", "name": "講談社現代新書 ; 2004"}]}],
        "appliedPurchases": []
    });
    let request: BibliographyRequest =
        serde_json::from_value(json!({"book": book})).expect("decode request");
    let proposed = serde_json::to_value(plan_review(&request)).expect("encode revision");
    assert_eq!(
        proposed,
        json!({
            "title": "はじめての言語ゲーム",
            "authors": ["島田 浩二", "菊池 たけし", "F.E.A.R."],
            "authorRoles": [{"name": "島田 浩二", "role": "訳"}],
            "editions": []
        })
    );

    let record = json!({"title": "はじめての言語ゲーム", "creators": ["橋爪, 大三郎, 1948-"],
        "statement": "橋爪大三郎 著", "publishers": ["講談社"], "series": ["講談社現代新書 ; 2004"]});
    let request: BibliographyRequest = serde_json::from_value(
        json!({"book": book, "answers": [{"isbn": "9784062880046", "record": record}]}),
    )
    .expect("decode request");
    let proposed = serde_json::to_value(plan_review(&request)).expect("encode revision");
    assert_eq!(proposed["authors"], json!(["橋爪 大三郎"]));
    assert_eq!(proposed["authorRoles"], json!([]));
}
