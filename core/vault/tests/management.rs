use book_props_vault::{
    BooksRequest, CopiesRequest, ManagementRequest, MoveRequest, OptionsRequest, RestoreRequest,
    StepRequest, allows_step, book_options, canonical_isbn_list, missing_move_copies,
    plan_management, plan_move, restore_targets, settle_shelf,
};
use serde_json::{Value, json};

const STAMP: &str = "2026-11-26T00:00:00.000Z";
const DIGEST: &str = "5d41402abc4b2a76b9719d911017c592ae0f8b3c6f3d1e7a1b2c3d4e5f607182";

fn edition(id: &str, isbn: &str) -> Value {
    json!({"id": id, "owned": true, "isbns": [isbn], "details": {"publisher": "技術社"}})
}

fn book(id: &str, editions: Value) -> Value {
    json!({"id": id, "title": id, "authors": [], "wanted": false, "editions": editions,
        "appliedPurchases": []})
}

/// A source holding `first`, and an empty destination.
fn shelf() -> Vec<Value> {
    vec![
        book("source", json!([edition("first", "9780306406157")])),
        book("destination", json!([])),
    ]
}

fn marker(backup: Option<Value>) -> Value {
    let mut marker =
        json!({"editionId": "first", "destinationId": "destination", "digest": DIGEST});
    if let Some(edition) = backup {
        marker["backup"] = json!({"signature": "{\"id\":\"first\"}", "edition": edition});
    }
    marker
}

fn moving(mut source: Value, backup: Option<Value>) -> Value {
    source["pendingMove"] = marker(backup);
    source
}

fn plan(command: Value, books: &[Value]) -> Value {
    plan_with(command, books, None)
}

fn plan_with(command: Value, books: &[Value], copy: Option<Value>) -> Value {
    let mut request = json!({"command": command, "books": books, "stamp": STAMP});
    if let Some(copy) = copy {
        request["copy"] = copy;
    }
    let request: ManagementRequest =
        serde_json::from_value(request).expect("decode management request");
    serde_json::to_value(plan_management(&request)).expect("encode management plan")
}

fn allows(latest: &Value, step: &Value) -> bool {
    let request: StepRequest = serde_json::from_value(json!({"latest": latest, "step": step}))
        .expect("decode step request");
    allows_step(&request)
}

fn conflict() -> Value {
    json!({"kind": "conflict"})
}

#[test]
fn commands_wait_for_unsettled_moves_and_conflict_on_missing_books() {
    let archive = json!({"action": "archive", "bookId": "source"});
    assert_eq!(
        plan(json!({"action": "archive", "bookId": "gone"}), &shelf()),
        conflict()
    );
    let books = [shelf()[0].clone(), moving(book("other", json!([])), None)];
    assert_eq!(plan(archive, &books), json!({"kind": "pending"}));
    let recover = json!({"action": "recoverMove", "bookId": "source"});
    assert_eq!(plan(recover.clone(), &shelf()), conflict());
    let books = [moving(shelf()[0].clone(), None), shelf()[1].clone()];
    assert_eq!(
        plan(recover, &books),
        json!({"kind": "move", "stages": ["resume"]})
    );
}

#[test]
fn archiving_keeps_an_earlier_time_and_restoring_clears_it() {
    let books = shelf();
    let archive = plan(json!({"action": "archive", "bookId": "source"}), &books);
    assert_eq!(
        archive,
        json!({"kind": "write", "step": {"kind": "setArchivedAt", "archivedAt": STAMP}})
    );
    let mut archived = books[0].clone();
    archived["editions"][0]["archivedAt"] = json!("2026-01-01T00:00:00Z");
    let again = plan(
        json!({"action": "archive", "bookId": "source", "editionId": "first"}),
        &[archived.clone()],
    );
    assert_eq!(
        again["step"],
        json!({"kind": "setArchivedAt", "editionId": "first",
            "before": "2026-01-01T00:00:00Z", "archivedAt": "2026-01-01T00:00:00Z"})
    );
    let restore = plan(
        json!({"action": "restore", "bookId": "source", "editionId": "first"}),
        &[archived.clone()],
    );
    assert_eq!(
        restore["step"],
        json!({"kind": "setArchivedAt", "editionId": "first", "before": "2026-01-01T00:00:00Z"})
    );
    assert!(allows(&archived, &restore["step"]));
    assert!(!allows(&books[0], &restore["step"]));
    let mut book_archived = archived;
    book_archived["archivedAt"] = json!(STAMP);
    let edition_of_archived =
        json!({"action": "archive", "bookId": "source", "editionId": "first"});
    assert_eq!(
        plan(edition_of_archived, &[book_archived.clone()]),
        conflict()
    );
    assert!(!allows(&book_archived, &restore["step"]));
    let missing = json!({"action": "archive", "bookId": "source", "editionId": "gone"});
    assert_eq!(plan(missing, &shelf()), conflict());
}

#[test]
fn an_added_or_edited_edition_never_shares_an_isbn_with_another_edition() {
    let books = shelf();
    let add = |value: Value| {
        plan(
            json!({"action": "addEdition", "bookId": "destination", "value": value}),
            &books,
        )
    };
    assert_eq!(add(edition("first", "9780262033848")), conflict());
    assert_eq!(add(edition("new", "9780306406157")), conflict());
    let added = add(edition("new", "9780262033848"));
    assert_eq!(added["step"]["kind"], "addEdition");
    let mut taken = books[1].clone();
    taken["editions"] = json!([edition("other", "9780262033848")]);
    assert!(!allows(&taken, &added["step"]));
    assert!(allows(&books[1], &added["step"]));
    let mut archived = edition("new", "9780262033848");
    archived["archivedAt"] = json!(STAMP);
    assert_eq!(add(archived), conflict());

    let baseline = edition("first", "9780306406157");
    let edit = |value: Value| {
        plan(
            json!({"action": "editEdition", "bookId": "source", "baseline": baseline, "value": value}),
            &books,
        )
    };
    let mut renamed = edition("first", "9780306406157");
    renamed["details"]["publisher"] = json!("新社");
    let edited = edit(renamed.clone());
    assert_eq!(edited["step"]["kind"], "editEdition");
    assert!(allows(&books[0], &edited["step"]));
    let mut changed = books[0].clone();
    changed["editions"][0]["owned"] = json!(false);
    assert!(!allows(&changed, &edited["step"]));
    let mut other_id = renamed.clone();
    other_id["id"] = json!("second");
    assert_eq!(edit(other_id), conflict());
    let mut unarchived = renamed;
    unarchived["archivedAt"] = json!(STAMP);
    assert_eq!(edit(unarchived), conflict());
    let mut shared = books.clone();
    shared[1]["editions"] = json!([edition("other", "9780262033848")]);
    let clash = plan(
        json!({"action": "editEdition", "bookId": "source", "baseline": baseline,
            "value": edition("first", "9780262033848")}),
        &shared,
    );
    assert_eq!(clash, conflict());
}

#[test]
fn a_custom_field_changes_only_as_read_and_keeps_names_unique() {
    let rating = json!({"name": "評価", "kind": "number", "value": 4});
    let shelf_kind =
        json!({"name": "棚", "kind": "choice", "value": "私用", "choices": ["私用", "業務"]});
    let mut source = shelf()[0].clone();
    source["customFields"] = json!([rating, shelf_kind]);
    let books = [source.clone()];
    let update = |baseline: Option<&Value>, value: Option<&Value>| {
        let mut command = json!({"action": "updateCustomField", "bookId": "source"});
        if let Some(baseline) = baseline {
            command["baseline"] = baseline.clone();
        }
        if let Some(value) = value {
            command["value"] = value.clone();
        }
        plan(command, &books)
    };
    assert_eq!(update(None, None), conflict());
    let raised = json!({"name": "評価", "kind": "number", "value": 5});
    let step = update(Some(&rating), Some(&raised))["step"].clone();
    assert!(allows(&source, &step));
    let mut changed = source.clone();
    changed["customFields"][0]["value"] = json!(3);
    assert!(!allows(&changed, &step));
    let renamed = json!({"name": "棚", "kind": "number", "value": 5});
    let clash = update(Some(&rating), Some(&renamed))["step"].clone();
    assert!(!allows(&source, &clash));
    let added = update(None, Some(&rating))["step"].clone();
    assert!(!allows(&source, &added));
    let removed = update(Some(&shelf_kind), None)["step"].clone();
    assert!(allows(&source, &removed));
    let reordered =
        json!({"name": "棚", "kind": "choice", "value": "私用", "choices": ["業務", "私用"]});
    let stale = update(Some(&reordered), None)["step"].clone();
    assert!(!allows(&source, &stale));
}

fn set_reading(books: &[Value], baseline: Value, value: Value) -> Value {
    plan(
        json!({"action": "setReading", "bookId": "source", "baseline": baseline, "value": value}),
        books,
    )
}

#[test]
fn a_reading_change_moves_between_any_statuses_and_back_to_none() {
    let mut source = shelf()[0].clone();
    source["readingStatus"] = json!("finished");
    source["finishedOn"] = json!("2024-05-01");
    let read = json!({"status": "finished", "finishedOn": "2024-05-01"});
    for status in ["unread", "reading", "rereading", "reference"] {
        let value = json!({"status": status, "finishedOn": "2024-05-01"});
        let planned = set_reading(std::slice::from_ref(&source), read.clone(), value.clone());
        assert_eq!(
            planned,
            json!({"kind": "write", "step": {"kind": "setReading", "baseline": read, "value": value}})
        );
        assert!(allows(&source, &planned["step"]));
    }
    let cleared = set_reading(
        std::slice::from_ref(&source),
        read.clone(),
        json!({"finishedOn": "2024-05-01"}),
    );
    assert!(allows(&source, &cleared["step"]));
    let mut archived = source;
    archived["archivedAt"] = json!(STAMP);
    let refused = set_reading(&[archived], read, json!({"status": "reading"}));
    assert_eq!(refused, conflict());
}

#[test]
fn a_finish_day_is_written_only_as_a_real_date_and_only_over_the_day_read() {
    let mut source = shelf()[0].clone();
    source["finishedOn"] = json!("2024/5/1");
    let books = [source.clone()];
    let read = json!({"finishedOn": "2024/5/1"});
    let keep = set_reading(
        &books,
        read.clone(),
        json!({"status": "finished", "finishedOn": "2024/5/1"}),
    );
    assert!(allows(&source, &keep["step"]));
    let typed = json!({"status": "finished", "finishedOn": "2024/5/2"});
    assert_eq!(set_reading(&books, read.clone(), typed), conflict());
    let impossible = json!({"status": "finished", "finishedOn": "2024-02-30"});
    assert_eq!(set_reading(&books, read.clone(), impossible), conflict());
    let today = json!({"status": "finished", "finishedOn": "2026-11-28"});
    let dated = set_reading(&books, read, today);
    assert!(allows(&source, &dated["step"]));
    let mut hand_set = source.clone();
    hand_set["finishedOn"] = json!("2024-04-30");
    assert!(!allows(&hand_set, &dated["step"]));
    assert!(allows(&hand_set, &keep["step"]));
}

#[test]
fn a_reading_change_stops_only_when_a_part_it_writes_has_changed() {
    let source = shelf()[0].clone();
    let reading = json!({"status": "reading"});
    let step = set_reading(std::slice::from_ref(&source), json!({}), reading)["step"].clone();
    let mut dated = source.clone();
    dated["finishedOn"] = json!("2024-05-01");
    assert!(allows(&dated, &step));
    let mut finished = source.clone();
    finished["readingStatus"] = json!("finished");
    assert!(!allows(&finished, &step));
    let mut moving_source = source;
    moving_source["pendingMove"] = marker(None);
    assert!(!allows(&moving_source, &step));
    let unknown = json!({"action": "setReading", "bookId": "source", "baseline": {},
        "value": {"status": "tsundoku"}});
    let request = json!({"command": unknown, "books": shelf(), "stamp": STAMP});
    assert!(serde_json::from_value::<ManagementRequest>(request).is_err());
}

#[test]
fn a_move_needs_two_open_books_and_an_edition_no_third_book_holds() {
    let books = shelf();
    let command = |destination: &str| {
        json!({"action": "move", "bookId": "source", "editionId": "first",
            "destinationId": destination})
    };
    assert_eq!(
        plan(command("destination"), &books),
        json!({"kind": "move", "stages": ["keepCopy", "markMove", "resume"]})
    );
    assert_eq!(plan(command("source"), &books), conflict());
    assert_eq!(plan(command("gone"), &books), conflict());
    let mut archived = books.clone();
    archived[1]["archivedAt"] = json!(STAMP);
    assert_eq!(plan(command("destination"), &archived), conflict());
    let mut shared = books.clone();
    shared[1]["editions"] = json!([edition("other", "9780306406157")]);
    assert_eq!(plan(command("destination"), &shared), conflict());
    let mut held = books.clone();
    held.push(book("third", json!([edition("first", "9780306406157")])));
    assert_eq!(plan(command("destination"), &held), conflict());

    assert!(allows(&books[0], &json!({"kind": "markMove"})));
    let marked = moving(books[0].clone(), None);
    assert!(!allows(&marked, &json!({"kind": "markMove"})));
}

fn resume(books: &[Value], source: &Value, latest: &Value) -> Value {
    let request: MoveRequest =
        serde_json::from_value(json!({"books": books, "source": source, "latest": latest}))
            .expect("decode move request");
    serde_json::to_value(plan_move(&request)).expect("encode move plan")
}

#[test]
fn a_recorded_move_continues_from_the_source_or_from_its_backup() {
    let source = moving(shelf()[0].clone(), None);
    let books = [source.clone(), shelf()[1].clone()];
    assert_eq!(
        resume(&books, &source, &source),
        json!({"kind": "continue", "from": "source",
            "stages": ["keepCopy", "copyEdition", "recordBackup", "clearMove"]})
    );
    let mut released = moving(shelf()[0].clone(), Some(edition("first", "9780306406157")));
    released["editions"] = json!([]);
    let books = [released.clone(), shelf()[1].clone()];
    assert_eq!(
        resume(&books, &released, &released),
        json!({"kind": "continue", "from": "backup",
            "stages": ["keepCopy", "copyEdition", "clearMove"]})
    );
    let both = moving(shelf()[0].clone(), Some(edition("first", "9780306406157")));
    assert_eq!(resume(&books, &both, &both)["kind"], "pending");
    let mut neither = source.clone();
    neither["editions"] = json!([]);
    assert_eq!(resume(&books, &source, &neither)["kind"], "pending");
    let other = moving(shelf()[0].clone(), None);
    let mut other_move = other.clone();
    other_move["pendingMove"]["digest"] = json!("0".repeat(64));
    assert_eq!(resume(&books, &other, &other_move)["kind"], "pending");
    let mut busy = shelf()[1].clone();
    busy["pendingMove"] = marker(None);
    assert_eq!(
        resume(&[source.clone(), busy], &source, &source)["kind"],
        "pending"
    );
    assert_eq!(
        resume(std::slice::from_ref(&source), &source, &source)["kind"],
        "pending"
    );
    let mut archived = source.clone();
    archived["editions"][0]["archivedAt"] = json!(STAMP);
    assert_eq!(resume(&books, &source, &archived)["kind"], "pending");
}

#[test]
fn settling_steps_need_the_same_marker_and_the_edition_where_expected() {
    let source = moving(shelf()[0].clone(), None);
    let record = json!({"kind": "recordBackup", "marker": marker(None)});
    assert!(allows(&source, &record));
    let backup = edition("first", "9780306406157");
    let mut released = moving(shelf()[0].clone(), Some(backup.clone()));
    released["editions"] = json!([]);
    assert!(!allows(&released, &record));
    let clear = json!({"kind": "clearMove", "marker": marker(Some(backup.clone()))});
    assert!(allows(&released, &clear));
    let mut still_held = released.clone();
    still_held["editions"] = json!([backup.clone()]);
    assert!(!allows(&still_held, &clear));

    let cancel = json!({"kind": "cancelMove", "marker": marker(Some(backup.clone()))});
    assert!(allows(&released, &cancel));
    assert!(!allows(&still_held, &cancel));
    let mut collided = released.clone();
    collided["editions"] = json!([edition("other", "9780306406157")]);
    assert!(!allows(&collided, &cancel));
    let keep = json!({"kind": "cancelMove", "marker": marker(None)});
    assert!(allows(&source, &keep));
    let mut gone = source.clone();
    gone["editions"] = json!([]);
    assert!(!allows(&gone, &keep));

    let copy = json!({"kind": "copyEdition", "edition": backup});
    assert!(allows(&shelf()[1], &copy));
    let mut shared = shelf()[1].clone();
    shared["editions"] = json!([edition("other", "9780306406157")]);
    assert!(!allows(&shared, &copy));
}

#[test]
fn cancelling_waits_while_another_book_holds_the_edition() {
    let command = json!({"action": "cancelMove", "bookId": "source"});
    assert_eq!(plan(command.clone(), &shelf()), conflict());
    let source = moving(shelf()[0].clone(), None);
    assert_eq!(
        plan(command.clone(), &[source.clone(), shelf()[1].clone()]),
        json!({"kind": "move", "stages": ["cancelMove"]})
    );
    let mut copied = shelf()[1].clone();
    copied["editions"] = json!([edition("first", "9780306406157")]);
    assert_eq!(
        plan(command.clone(), &[source, copied]),
        json!({"kind": "pending"})
    );
    let mut released = moving(shelf()[0].clone(), Some(edition("first", "9780306406157")));
    released["editions"] = json!([]);
    assert_eq!(
        plan(command, &[released, shelf()[1].clone()]),
        json!({"kind": "move", "stages": ["keepCopy", "cancelMove"]})
    );
}

#[test]
fn a_saved_copy_returns_only_to_a_book_of_its_move_while_nothing_holds_it() {
    let mut books = shelf();
    books[0]["editions"] = json!([]);
    let command = json!({"action": "restoreMoveCopy", "bookId": "source", "editionId": "first"});
    let copy = |source: &str| {
        json!({"sourceId": source, "destinationId": "destination",
            "edition": edition("first", "9780306406157")})
    };
    let restored = plan_with(command.clone(), &books, Some(copy("source")));
    assert_eq!(restored["step"]["kind"], "restoreEdition");
    assert!(allows(&books[0], &restored["step"]));
    assert_eq!(plan_with(command.clone(), &books, None), conflict());
    assert_eq!(
        plan_with(command.clone(), &books, Some(copy("third"))),
        conflict()
    );
    let mut held = books.clone();
    held[1]["editions"] = json!([edition("first", "9780306406157")]);
    assert_eq!(
        plan_with(command.clone(), &held, Some(copy("source"))),
        conflict()
    );
    assert!(!allows(&held[1], &restored["step"]));
    let mut archived = books;
    archived[0]["archivedAt"] = json!(STAMP);
    assert_eq!(
        plan_with(command, &archived, Some(copy("source"))),
        conflict()
    );
}

#[test]
fn the_shelf_shows_each_moving_edition_once() {
    let settle = |books: Vec<Value>| {
        let request: BooksRequest =
            serde_json::from_value(json!({"books": books})).expect("decode books request");
        serde_json::to_value(settle_shelf(&request)).expect("encode shelf")
    };
    assert_eq!(settle(shelf()), json!({"moving": false, "books": []}));
    let mut copied = shelf()[1].clone();
    copied["editions"] = json!([edition("first", "9780306406157")]);
    assert_eq!(
        settle(vec![moving(shelf()[0].clone(), None), copied.clone()]),
        json!({"moving": true, "books": [{"id": "destination", "hidden": ["first"], "backup": false}]})
    );
    let mut released = moving(shelf()[0].clone(), Some(edition("first", "9780306406157")));
    released["editions"] = json!([]);
    assert_eq!(
        settle(vec![released, copied])["books"],
        json!([
            {"id": "source", "hidden": [], "backup": true},
            {"id": "destination", "hidden": ["first"], "backup": false}
        ])
    );
}

#[test]
fn a_saved_copy_is_missing_when_no_book_holds_or_moves_its_edition() {
    let missing = |books: Vec<Value>| {
        let request: CopiesRequest =
            serde_json::from_value(json!({"books": books, "editionIds": ["first", "lost"]}))
                .expect("decode copies request");
        serde_json::to_value(missing_move_copies(&request)).expect("encode missing copies")
    };
    assert_eq!(missing(shelf()), json!({"missing": [false, true]}));
    let mut released = moving(shelf()[0].clone(), None);
    released["editions"] = json!([]);
    assert_eq!(missing(vec![released]), json!({"missing": [false, true]}));
    assert_eq!(missing(vec![]), json!({"missing": [true, true]}));
}

#[test]
fn a_saved_copy_goes_back_only_to_an_unarchived_book_of_its_move() {
    let targets = |books: Vec<Value>| {
        let request: RestoreRequest = serde_json::from_value(json!({"books": books, "copies": [
            {"sourceId": "source", "destinationId": "destination"},
            {"sourceId": "gone", "destinationId": "destination"}
        ]}))
        .expect("decode restore request");
        serde_json::to_value(restore_targets(&request)).expect("encode restore targets")
    };
    assert_eq!(
        targets(shelf()),
        json!({"targets": [["source", "destination"], ["destination"]]})
    );
    let mut archived = shelf();
    archived[1]["archivedAt"] = json!(STAMP);
    assert_eq!(targets(archived), json!({"targets": [["source"], []]}));
    let mut books = shelf();
    books.push(book("unrelated", json!([])));
    assert_eq!(
        targets(books),
        json!({"targets": [["source", "destination"], ["destination"]]})
    );
}

fn options(book_id: &str, books: &[Value]) -> Value {
    let request: OptionsRequest =
        serde_json::from_value(json!({"books": books, "bookId": book_id}))
            .expect("decode options request");
    serde_json::to_value(book_options(&request)).expect("encode book options")
}

#[test]
fn an_open_book_offers_its_editions_and_the_other_unarchived_books_as_destinations() {
    let mut books = shelf();
    books[0]["editions"]
        .as_array_mut()
        .expect("editions")
        .push(json!({"id": "old", "owned": false, "isbns": [], "archivedAt": STAMP}));
    let mut archived = book("archived", json!([]));
    archived["archivedAt"] = json!(STAMP);
    books.push(archived);
    books.push(book("other", json!([])));
    assert_eq!(
        options("source", &books),
        json!({"kind": "open", "editions": [
            {"id": "first", "archived": false, "destinations": ["destination", "other"]},
            {"id": "old", "archived": true, "destinations": []}
        ]})
    );
    assert_eq!(options("archived", &books), json!({"kind": "archived"}));
    assert_eq!(options("gone", &books), json!({"kind": "missing"}));
}

#[test]
fn a_book_recording_a_move_offers_only_resuming_or_cancelling_it() {
    let mut source = moving(shelf()[0].clone(), None);
    source["archivedAt"] = json!(STAMP);
    let books = [source, shelf()[1].clone()];
    assert_eq!(options("source", &books), json!({"kind": "moving"}));
    assert_eq!(
        options("destination", &books),
        json!({"kind": "open", "editions": []})
    );
}

#[test]
fn stored_isbns_must_already_be_canonical_isbn13_without_duplicates() {
    let stored = |values: &[&str]| {
        canonical_isbn_list(
            &values
                .iter()
                .map(|value| (*value).to_owned())
                .collect::<Vec<_>>(),
        )
    };
    assert!(stored(&["9780306406157", "9780262033848"]));
    assert!(stored(&[]));
    assert!(!stored(&["9780306406157", "9780306406157"]));
    assert!(!stored(&["9780306406158"]));
    assert!(!stored(&["978-0306406157"]));
    assert!(!stored(&["0306406152"]));
    assert!(!stored(&[" 9780306406157"]));
    assert!(!stored(&["９780306406157"]));
}
