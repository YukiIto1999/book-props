use book_props_vault::{
    ImportRequest, PortableExport, PortableNotes, check_portable_notes, decode_portable_library,
    encode_portable_library, plan_import,
};
use serde_json::{Value, json};

fn decode(json: &str) -> Value {
    serde_json::to_value(decode_portable_library(json)).expect("envelope")
}

fn problem(json: &str) -> Value {
    decode(json)["problem"].clone()
}

fn library(notes: &Value) -> String {
    json!({"format": "book-props-vault", "version": 1, "notes": notes}).to_string()
}

fn readable(book_id: &str, editions: &[&str]) -> Value {
    json!({"kind": "readable", "bookId": book_id, "editionIds": editions, "purchases": false})
}

fn check(notes: &[Value]) -> Value {
    let request: PortableNotes =
        serde_json::from_value(json!({ "notes": notes })).expect("portable notes");
    serde_json::to_value(check_portable_notes(&request)).expect("verdict")["problem"].clone()
}

fn plan(desired: &[(&str, &str)], present: &Value) -> Value {
    let desired: Vec<Value> = desired
        .iter()
        .map(|(book_id, markdown)| json!({"bookId": book_id, "markdown": markdown}))
        .collect();
    let request: ImportRequest =
        serde_json::from_value(json!({"desired": desired, "present": present}))
            .expect("import request");
    serde_json::to_value(plan_import(&request)).expect("plan")
}

#[test]
fn a_versioned_library_decodes_into_its_notes() {
    let envelope = decode(&library(&json!([{"bookId": "b", "markdown": "B"},
        {"bookId": "a", "markdown": "A"}])));
    assert_eq!(
        envelope,
        json!({"notes": [{"bookId": "b", "markdown": "B"}, {"bookId": "a", "markdown": "A"}]})
    );
}

#[test]
fn anything_but_the_versioned_schema_is_a_problem_with_the_document() {
    let note = json!({"bookId": "a", "markdown": "A"});
    let cases = [
        ("{".to_owned(), json!({"kind": "notJson"})),
        ("[]".to_owned(), json!({"kind": "notObject"})),
        (
            json!({"format": "other", "version": 1, "notes": []}).to_string(),
            json!({"kind": "wrongFormat", "format": "book-props-vault"}),
        ),
        (
            json!({"format": "book-props-vault", "notes": []}).to_string(),
            json!({"kind": "unexpectedKeys", "keys": ["format", "version", "notes"]}),
        ),
        (
            r#"{"format":"book-props-vault","version":1,"notes":[],"__proto__":{}}"#.to_owned(),
            json!({"kind": "unexpectedKeys", "keys": ["format", "version", "notes"]}),
        ),
        (
            json!({"format": "book-props-vault", "version": "1", "notes": []}).to_string(),
            json!({"kind": "versionNotInteger"}),
        ),
        (
            json!({"format": "book-props-vault", "version": 1.5, "notes": []}).to_string(),
            json!({"kind": "versionNotInteger"}),
        ),
        (
            json!({"format": "book-props-vault", "version": 2, "notes": []}).to_string(),
            json!({"kind": "unsupportedVersion", "version": 2.0}),
        ),
        (
            json!({"format": "book-props-vault", "version": 1, "notes": {"0": note.clone()}})
                .to_string(),
            json!({"kind": "notesNotArray"}),
        ),
        (
            library(&json!([{"bookId": "a", "markdown": "A", "path": "../a.md"}])),
            json!({"kind": "unexpectedKeys", "position": 0, "keys": ["bookId", "markdown"]}),
        ),
        (
            library(&json!([{"bookId": "a", "markdown": 1}])),
            json!({"kind": "noteNotText", "position": 0}),
        ),
        (
            library(&json!([note.clone(), "note"])),
            json!({"kind": "notObject", "position": 1}),
        ),
    ];
    for (json, expected) in cases {
        assert_eq!(problem(&json), expected, "{json}");
    }
    assert_eq!(
        decode(&library(&json!([note.clone(), "note"])))["notes"],
        json!([note]),
        "the notes before a malformed note come back to be checked first"
    );
    assert_eq!(
        problem(r#"{"format":"book-props-vault","version":1.0,"notes":[]}"#),
        Value::Null
    );
}

#[test]
fn notes_travel_together_only_once_each_without_purchases_and_with_their_own_id() {
    assert_eq!(
        check(&[readable("a", &["1"]), readable("b", &["2"])]),
        Value::Null
    );
    assert_eq!(
        check(&[readable("a", &[]), json!({"kind": "unreadable"})]),
        json!({"kind": "unreadableNote", "position": 1})
    );
    let mut declared = readable("a", &[]);
    declared["declaredId"] = json!("../a");
    assert_eq!(
        check(&[declared]),
        json!({"kind": "inconsistentId", "position": 0})
    );
    let mut purchased = readable("a", &[]);
    purchased["purchases"] = json!(true);
    assert_eq!(
        check(&[purchased]),
        json!({"kind": "carriesPurchases", "position": 0})
    );
    assert_eq!(
        check(&[readable("a", &["1"]), readable("a", &["2"])]),
        json!({"kind": "duplicateBook", "id": "a"})
    );
    assert_eq!(
        check(&[readable("a", &["1"]), readable("b", &["1"])]),
        json!({"kind": "duplicateEdition", "id": "1"})
    );
    assert_eq!(
        check(&[readable("a", &["1", "1"])]),
        json!({"kind": "duplicateEdition", "id": "1"})
    );
    assert_eq!(
        check(&[
            readable("a", &["1"]),
            readable("a", &[]),
            json!({"kind": "unreadable"})
        ]),
        json!({"kind": "duplicateBook", "id": "a"}),
        "the first problem in the notes' order wins"
    );
}

#[test]
fn a_library_is_written_by_book_id_as_indented_json_that_reads_back() {
    let request: PortableExport = serde_json::from_value(json!({"notes": [
        {"bookId": "b", "markdown": "---\nB\n---\r\n本文\u{1f}"},
        {"bookId": "a", "markdown": "A"},
    ]}))
    .expect("export");
    let json = encode_portable_library(request).expect("library");
    assert_eq!(
        json,
        "{\n  \"format\": \"book-props-vault\",\n  \"version\": 1,\n  \"notes\": [\n    {\n      \
         \"bookId\": \"a\",\n      \"markdown\": \"A\"\n    },\n    {\n      \"bookId\": \"b\",\n      \
         \"markdown\": \"---\\nB\\n---\\r\\n本文\\u001f\"\n    }\n  ]\n}\n"
    );
    assert_eq!(
        decode(&json)["notes"][1]["markdown"],
        json!("---\nB\n---\r\n本文\u{1f}")
    );
    let empty =
        encode_portable_library(serde_json::from_value(json!({"notes": []})).expect("export"))
            .expect("library");
    assert_eq!(
        empty,
        "{\n  \"format\": \"book-props-vault\",\n  \"version\": 1,\n  \"notes\": []\n}\n"
    );
}

#[test]
fn importing_creates_only_missing_books_in_library_order() {
    let desired = [("b", "B"), ("a", "A"), ("c", "C")];
    assert_eq!(
        plan(&desired, &json!([])),
        json!({"kind": "ready", "missing": ["b", "a", "c"]})
    );
    assert_eq!(
        plan(
            &desired,
            &json!([{"bookId": "a", "markdown": "A", "moving": false}])
        ),
        json!({"kind": "ready", "missing": ["b", "c"]})
    );
}

#[test]
fn importing_never_overwrites_a_different_duplicated_foreign_or_moving_book() {
    let desired = [("a", "A"), ("b", "B")];
    for present in [
        json!([{"bookId": "a", "markdown": "changed", "moving": false}]),
        json!([{"bookId": "a", "markdown": "A", "moving": true}]),
        json!([{"bookId": "x", "markdown": "X", "moving": false}]),
        json!([{"bookId": "a", "markdown": "A", "moving": false},
            {"bookId": "a", "markdown": "A", "moving": false}]),
    ] {
        assert_eq!(
            plan(&desired, &present),
            json!({"kind": "conflict"}),
            "{present}"
        );
    }
}
