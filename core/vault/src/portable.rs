//! The portable library: one versioned JSON document carrying book notes between vaults, and
//! importing it into a scope without overwriting anything.
//!
//! The runtime reads and writes the note text; the core decides what the document must look
//! like, which notes may travel together, and which notes an import creates.

use std::collections::{HashMap, HashSet};

use serde::Serialize;
use serde_json::{Map, Value};

use crate::model::{
    ImportPlan, ImportRequest, NoteFacts, PortableEnvelope, PortableExport, PortableNote,
    PortableNotes, PortableProblem, PortableVerdict,
};
use crate::text::code_unit_order;

const FORMAT: &str = "book-props-vault";
const VERSION: u32 = 1;
const LIBRARY_KEYS: [&str; 3] = ["format", "version", "notes"];
const NOTE_KEYS: [&str; 2] = ["bookId", "markdown"];

#[derive(Serialize)]
struct Library {
    format: &'static str,
    version: u32,
    notes: Vec<PortableNote>,
}

/// The object with exactly `keys` as its members.
fn record(
    value: Value,
    keys: &[&str],
    position: Option<usize>,
) -> Result<Map<String, Value>, PortableProblem> {
    let Value::Object(members) = value else {
        return Err(PortableProblem::NotObject { position });
    };
    if members.len() != keys.len() || !keys.iter().all(|key| members.contains_key(*key)) {
        return Err(PortableProblem::UnexpectedKeys {
            position,
            keys: keys.iter().map(|key| (*key).to_owned()).collect(),
        });
    }
    Ok(members)
}

fn note(value: Value, position: usize) -> Result<PortableNote, PortableProblem> {
    let mut members = record(value, &NOTE_KEYS, Some(position))?;
    match (members.remove("bookId"), members.remove("markdown")) {
        (Some(Value::String(book_id)), Some(Value::String(markdown))) => {
            Ok(PortableNote { book_id, markdown })
        }
        _ => Err(PortableProblem::NoteNotText { position }),
    }
}

/// The notes of the library, read into `notes` until the first problem.
fn read_library(json: &str, notes: &mut Vec<PortableNote>) -> Result<(), PortableProblem> {
    let parsed: Value = serde_json::from_str(json).map_err(|_| PortableProblem::NotJson)?;
    let mut library = record(parsed, &LIBRARY_KEYS, None)?;
    if library.get("format").and_then(Value::as_str) != Some(FORMAT) {
        return Err(PortableProblem::WrongFormat {
            format: FORMAT.to_owned(),
        });
    }
    let version = library
        .get("version")
        .and_then(Value::as_f64)
        .filter(|version| version.is_finite() && version.fract() == 0.0)
        .ok_or(PortableProblem::VersionNotInteger)?;
    if version != f64::from(VERSION) {
        return Err(PortableProblem::UnsupportedVersion { version });
    }
    let Some(Value::Array(entries)) = library.remove("notes") else {
        return Err(PortableProblem::NotesNotArray);
    };
    for (position, entry) in entries.into_iter().enumerate() {
        notes.push(note(entry, position)?);
    }
    Ok(())
}

/// Reads the JSON text of a portable library. The notes before the first problem with the
/// document come back with it, so that problems inside those notes can be reported first.
#[must_use]
pub fn decode_portable_library(json: &str) -> PortableEnvelope {
    let mut notes = Vec::new();
    let problem = read_library(json, &mut notes).err();
    PortableEnvelope { notes, problem }
}

/// Notes travel together only when each is a readable book note without applied purchases whose
/// book id is the one it came with, and no book or edition id appears twice.
#[must_use]
pub fn check_portable_notes(request: &PortableNotes) -> PortableVerdict {
    let mut books = HashSet::new();
    let mut editions = HashSet::new();
    let problem = request
        .notes
        .iter()
        .enumerate()
        .find_map(|(position, facts)| check_note(facts, position, &mut books, &mut editions).err());
    PortableVerdict { problem }
}

fn check_note<'n>(
    facts: &'n NoteFacts,
    position: usize,
    books: &mut HashSet<&'n str>,
    editions: &mut HashSet<&'n str>,
) -> Result<(), PortableProblem> {
    let NoteFacts::Readable {
        declared_id,
        book_id,
        edition_ids,
        purchases,
    } = facts
    else {
        return Err(PortableProblem::UnreadableNote { position });
    };
    if declared_id
        .as_ref()
        .is_some_and(|declared| declared != book_id)
    {
        return Err(PortableProblem::InconsistentId { position });
    }
    if *purchases {
        return Err(PortableProblem::CarriesPurchases { position });
    }
    if !books.insert(book_id) {
        return Err(PortableProblem::DuplicateBook {
            id: book_id.clone(),
        });
    }
    match edition_ids.iter().find(|id| !editions.insert(id)) {
        Some(id) => Err(PortableProblem::DuplicateEdition { id: id.clone() }),
        None => Ok(()),
    }
}

/// The JSON text of a portable library holding checked notes, ordered by book id.
///
/// # Errors
/// Fails only when JSON cannot represent the notes.
pub fn encode_portable_library(request: PortableExport) -> serde_json::Result<String> {
    let mut notes = request.notes;
    notes.sort_by(|left, right| code_unit_order(&left.book_id, &right.book_id));
    let library = Library {
        format: FORMAT,
        version: VERSION,
        notes,
    };
    Ok(serde_json::to_string_pretty(&library)? + "\n")
}

/// Plans an import into the scope as it is now. Every book the scope holds must be in the library
/// with the same text and no unsettled move, and only once; the books it lacks are created.
#[must_use]
pub fn plan_import(request: &ImportRequest) -> ImportPlan {
    let desired: HashMap<&str, &str> = request
        .desired
        .iter()
        .map(|note| (note.book_id.as_str(), note.markdown.as_str()))
        .collect();
    let mut present = HashSet::new();
    for note in &request.present {
        if note.moving
            || !present.insert(note.book_id.as_str())
            || desired.get(note.book_id.as_str()) != Some(&note.markdown.as_str())
        {
            return ImportPlan::Conflict;
        }
    }
    let mut listed = HashSet::new();
    let missing = request
        .desired
        .iter()
        .map(|note| note.book_id.as_str())
        .filter(|id| listed.insert(*id) && !present.contains(id))
        .map(str::to_owned)
        .collect();
    ImportPlan::Ready { missing }
}
