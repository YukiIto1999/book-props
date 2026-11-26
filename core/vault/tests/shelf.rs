use book_props_vault::{ShelfError, ShelfIndex, ShelfQuery, calendar_date};
use serde_json::{Value, json};

fn book(title: &str, fields: &Value) -> Value {
    let mut book = json!({"path": format!("Books/{title}.md"), "title": title, "authors": [],
        "wanted": false, "editions": []});
    if let (Some(book), Some(fields)) = (book.as_object_mut(), fields.as_object()) {
        book.extend(fields.clone());
    }
    book
}

/// An owned edition; facts other than its identity, label, and archive time go to its details.
fn edition(id: &str, fields: &Value) -> Value {
    let mut edition = json!({"id": id, "owned": true, "isbns": [], "details": {}});
    for (key, value) in fields.as_object().into_iter().flatten() {
        if matches!(key.as_str(), "isbns" | "archivedAt" | "label" | "owned") {
            edition[key] = value.clone();
        } else {
            edition["details"][key] = value.clone();
        }
    }
    edition
}

fn open(books: &[Value]) -> ShelfIndex {
    ShelfIndex::new(serde_json::from_value(json!({ "books": books })).expect("shelf request"))
}

/// Ranks texts by code points, standing in for the runtime's locale.
fn collate(shelf: &mut ShelfIndex, key: &str) {
    let texts = shelf.collation_texts(key);
    let mut sorted = texts.clone();
    sorted.sort();
    sorted.dedup();
    let ranks: Vec<u32> = texts
        .iter()
        .map(|text| u32::try_from(sorted.binary_search(text).expect("ranked")).expect("rank"))
        .collect();
    shelf.collate(key, &ranks).expect("collated");
}

fn query(patch: &Value) -> ShelfQuery {
    let mut query = json!({"text": "", "ownership": "any", "wish": "any", "reading": "any",
        "tags": [], "sort": "title", "descending": false});
    if let (Some(query), Some(patch)) = (query.as_object_mut(), patch.as_object()) {
        query.extend(patch.clone());
    }
    serde_json::from_value(query).expect("shelf query")
}

/// Positions of the selected books, in order.
fn selected(books: &[Value], patch: &Value) -> Vec<usize> {
    let mut shelf = open(books);
    collate(&mut shelf, "title");
    collate(
        &mut shelf,
        patch.get("sort").and_then(Value::as_str).unwrap_or("title"),
    );
    let selection = shelf.select(&query(patch)).expect("selection");
    let selection = serde_json::to_value(selection).expect("selection json");
    selection["books"]
        .as_array()
        .expect("books")
        .iter()
        .map(|index| usize::try_from(index.as_u64().expect("index")).expect("position"))
        .collect()
}

/// The titles of the selected books, in order.
fn titles(books: &[Value], patch: &Value) -> Vec<String> {
    selected(books, patch)
        .into_iter()
        .map(|index| books[index]["title"].as_str().expect("title").to_owned())
        .collect()
}

fn bound(text: &str, number: Option<f64>) -> Value {
    number.map_or_else(
        || json!({ "text": text }),
        |number| json!({ "text": text, "number": number }),
    )
}

#[test]
fn search_words_match_regardless_of_width_case_and_spacing() {
    let books = [
        book(
            "プログラミングRust",
            &json!({"authors": ["Jim Blandy"], "tags": ["技術"]}),
        ),
        book("吾輩は猫である", &json!({"authors": ["夏目 漱石"]})),
    ];
    for text in ["ＲＵＳＴ", "ﾌﾟﾛｸﾞﾗﾐﾝｸﾞ", "jim　blandy", "JIMBLANDY", "技術"]
    {
        assert_eq!(
            titles(&books, &json!({ "text": text })),
            ["プログラミングRust"],
            "{text}"
        );
    }
    assert_eq!(
        titles(&books, &json!({"text": "夏目漱石"})),
        ["吾輩は猫である"]
    );
    assert!(titles(&books, &json!({"text": "漱石 Rust"})).is_empty());
}

#[test]
fn an_isbn_word_names_current_editions_and_digits_match_part_of_an_isbn() {
    let books = [
        book(
            "猫",
            &json!({"editions": [edition("cat", &json!({"isbns": ["9784101010014"]}))]}),
        ),
        book(
            "Rust",
            &json!({"editions": [edition("rust", &json!({"isbns": ["9784873119786"]}))]}),
        ),
        book(
            "しまった版",
            &json!({"editions": [edition("old", &json!({"isbns": ["9780306406157"],
                "archivedAt": "2026-11-01T00:00:00Z"}))]}),
        ),
    ];
    assert_eq!(
        titles(&books, &json!({"text": "978-4-10-101001-4"})),
        ["猫"]
    );
    assert_eq!(titles(&books, &json!({"text": "4101010013"})), ["猫"]);
    assert_eq!(titles(&books, &json!({"text": "978-4-87"})), ["Rust"]);
    assert!(titles(&books, &json!({"text": "9780306406157"})).is_empty());
    assert!(titles(&books, &json!({"text": "030640"})).is_empty());
}

#[test]
fn a_word_with_a_hash_names_one_tag_and_tags_must_all_be_present() {
    let books = [
        book("A", &json!({"tags": ["技術", "Rust"]})),
        book("B", &json!({"tags": ["技術"]})),
        book("C", &json!({"tags": ["技術", "Rust入門"]})),
    ];
    assert_eq!(titles(&books, &json!({"text": "#技術 #Rust"})), ["A"]);
    assert_eq!(titles(&books, &json!({"text": "＃ｒｕｓｔ"})), ["A"]);
    assert_eq!(titles(&books, &json!({"text": "rust"})), ["A", "C"]);
    assert_eq!(
        titles(&books, &json!({"tags": ["#技術", "ＲＵＳＴ"]})),
        ["A"]
    );
}

#[test]
fn states_and_facets_read_current_editions_only() {
    let books = [
        book(
            "所有",
            &json!({"wanted": true, "readingStatus": "unread",
                "editions": [edition("owned", &json!({"publisher": "新潮社"}))]}),
        ),
        book(
            "アーカイブした版だけ",
            &json!({"wanted": true, "editions": [edition("gone",
                &json!({"publisher": "新潮社", "archivedAt": "2026-11-01T00:00:00Z"}))]}),
        ),
        book(
            "アーカイブした本",
            &json!({"archivedAt": "2026-11-01T00:00:00Z"}),
        ),
        book("著者", &json!({"authors": ["夏目 漱石"]})),
    ];
    assert_eq!(titles(&books, &json!({"ownership": "owned"})), ["所有"]);
    assert_eq!(
        titles(&books, &json!({"ownership": "unowned", "wish": "wanted"})),
        ["アーカイブした版だけ"]
    );
    assert_eq!(
        titles(&books, &json!({"reading": "unset", "wish": "unwanted"})),
        ["著者"]
    );
    assert_eq!(titles(&books, &json!({"publisher": "新潮社"})), ["所有"]);
    assert_eq!(titles(&books, &json!({"author": "夏目　漱石"})), ["著者"]);
}

#[test]
fn ranges_compare_dates_as_days_and_numbers_as_numbers() {
    let books = [
        book(
            "四月",
            &json!({"editions": [edition("a", &json!({"purchasedOn": "2024/4/30"}))]}),
        ),
        book(
            "五月",
            &json!({"editions": [edition("b", &json!({"purchasedOn": "２０２４．５．１"}))]}),
        ),
        book(
            "存在しない日",
            &json!({"editions": [edition("c", &json!({"purchasedOn": "2024-02-30"}))]}),
        ),
        book(
            "零",
            &json!({"customFields": [{"field": {"kind": "number", "name": "評価", "value": 0},
                "text": "0"}]}),
        ),
        book(
            "負",
            &json!({"customFields": [{"field": {"kind": "number", "name": "評価", "value": -5},
                "text": "-5"}]}),
        ),
    ];
    let dates = |from, through| {
        json!({"range": {"key": "purchasedOn", "from": bound(from, None),
            "through": bound(through, None)}})
    };
    assert_eq!(titles(&books, &dates("2024-05-01", "")), ["五月"]);
    assert_eq!(titles(&books, &dates("", "2024-04-30")), ["四月"]);
    assert_eq!(
        titles(&books, &dates("", "")).len(),
        books.len(),
        "open ends select every book"
    );
    let scores = |from: Value, through: Value| json!({"range": {"key": "custom:評価", "from": from, "through": through}});
    assert_eq!(
        titles(&books, &scores(bound("0", Some(0.0)), bound("", None))),
        ["零"]
    );
    assert!(titles(&books, &scores(bound("abc", None), bound("", None))).is_empty());
}

#[test]
fn sorting_puts_books_without_a_value_last_and_breaks_ties_by_title_then_path() {
    let books = [
        book(
            "b",
            &json!({"editions": [edition("1", &json!({"publisher": "y"})),
                edition("2", &json!({"publisher": "a"}))]}),
        ),
        book("a", &json!({})),
        book(
            "c",
            &json!({"editions": [edition("3", &json!({"publisher": "m"}))]}),
        ),
        book(
            "d",
            &json!({"editions": [edition("4", &json!({"publisher": "m"}))]}),
        ),
    ];
    assert_eq!(
        titles(&books, &json!({"sort": "publisher"})),
        ["b", "c", "d", "a"]
    );
    assert_eq!(
        titles(&books, &json!({"sort": "publisher", "descending": true})),
        ["b", "c", "d", "a"],
        "descending sorts each book by its greatest value"
    );
    let mut same_title = book("a", &json!({}));
    same_title["path"] = json!("Books/0.md");
    assert_eq!(
        selected(&[book("a", &json!({})), same_title], &json!({})),
        [1, 0],
        "books with the same title go by path"
    );
}

#[test]
fn numbers_sort_before_texts_and_descending_reverses_values_only() {
    let value = |title: &str, field: Value, text: &str| {
        book(
            title,
            &json!({"customFields": [{"field": field, "text": text}]}),
        )
    };
    let books = [
        value(
            "text",
            json!({"kind": "text", "name": "x", "value": "1"}),
            "1",
        ),
        value(
            "ten",
            json!({"kind": "number", "name": "x", "value": 10}),
            "10",
        ),
        value(
            "two",
            json!({"kind": "number", "name": "x", "value": 2}),
            "2",
        ),
        book("none", &json!({})),
    ];
    assert_eq!(
        titles(&books, &json!({"sort": "custom:x"})),
        ["two", "ten", "text", "none"]
    );
    assert_eq!(
        titles(&books, &json!({"sort": "custom:x", "descending": true})),
        ["text", "ten", "two", "none"]
    );
}

#[test]
fn the_shelf_offers_standard_fields_then_added_fields_with_their_ranges() {
    let field = |kind: &str, name: &str, value: Value| json!({"field": {"kind": kind, "name": name, "value": value}, "text": "-"});
    let books = [
        book(
            "a",
            &json!({"customFields": [field("number", "評価", json!(3)),
                field("date", "読了", json!("2024-01-01")), field("text", "混在", json!("x"))],
                "tags": ["#技術", " Rust "]}),
        ),
        book(
            "b",
            &json!({"customFields": [field("number", "混在", json!(1))], "tags": ["技術", "#"]}),
        ),
        book(
            "c",
            &json!({"archivedAt": "2026-11-01T00:00:00Z",
                "customFields": [field("text", "評価", json!("高"))], "tags": ["消す"]}),
        ),
    ];
    let overview = serde_json::to_value(open(&books).overview()).expect("overview");
    let fields: Vec<(String, Value)> = overview["fields"]
        .as_array()
        .expect("fields")
        .iter()
        .map(|field| {
            (
                field["key"].as_str().expect("key").to_owned(),
                field.get("range").cloned().unwrap_or(Value::Null),
            )
        })
        .collect();
    let expected = [
        ("title", Value::Null),
        ("author", Value::Null),
        ("finishedOn", json!("date")),
        ("label", Value::Null),
        ("isbn", Value::Null),
        ("publisher", Value::Null),
        ("publishedOn", json!("date")),
        ("cover", Value::Null),
        ("purchasedOn", json!("date")),
        ("purchasedFrom", Value::Null),
        ("custom:評価", json!("number")),
        ("custom:読了", json!("date")),
        ("custom:混在", Value::Null),
    ]
    .map(|(key, range)| (key.to_owned(), range));
    assert_eq!(fields, expected);
    assert_eq!(overview["fields"][10]["name"], json!("評価"));
    assert_eq!(
        overview["tags"],
        json!([{"name": "技術", "key": "技術"}, {"name": "Rust", "key": "rust"}])
    );
    assert_eq!(
        overview["books"][1]["tags"],
        json!([{"name": "技術", "key": "技術"}, {"name": "", "key": ""}])
    );
}

#[test]
fn queries_need_the_sort_field_and_the_title_ranked() {
    let books = [book("a", &json!({}))];
    let mut shelf = open(&books);
    assert_eq!(
        shelf.select(&query(&json!({}))).err(),
        Some(ShelfError::NotCollated)
    );
    assert_eq!(shelf.collate("title", &[]), Err(ShelfError::Ranks));
    collate(&mut shelf, "title");
    assert!(shelf.select(&query(&json!({}))).is_ok());
    assert_eq!(
        shelf.select(&query(&json!({"sort": "publisher"}))).err(),
        Some(ShelfError::NotCollated)
    );
}

#[test]
fn a_calendar_date_names_a_real_day_written_with_a_separator() {
    assert_eq!(calendar_date("2024/3/5").as_deref(), Some("2024-03-05"));
    assert_eq!(calendar_date(" 2024.03.05 ").as_deref(), Some("2024-03-05"));
    assert_eq!(
        calendar_date("２０２４／３／５").as_deref(),
        Some("2024-03-05")
    );
    assert_eq!(calendar_date("2024-2/29").as_deref(), Some("2024-02-29"));
    assert_eq!(calendar_date("2000-02-29").as_deref(), Some("2000-02-29"));
    for value in [
        "2023-02-29",
        "1900-02-29",
        "2024/13/1",
        "2024/0/1",
        "2024/1/0",
        "2024/4/31",
        "2024/3",
        "2024年3月5日",
        "2024-03-05T09:00",
        "20245-1-1",
        "2024-123-1",
    ] {
        assert_eq!(calendar_date(value), None, "{value}");
    }
}
