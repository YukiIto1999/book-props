"""Writes core/vault/data/ndc9/labels.tsv from the JLA NDC9 Linked Data (ndc9.ttl).

Usage: python3 tools/scripts/ndc9-labels.py path/to/ndc9.ttl

The data comes from https://www.jla.or.jp/committees/bunrui/ndc-data/ (ndc9.zip, CC BY).
Only the names Book Props shows are kept: each main class (類目) and division (綱目) with its
preferred label, each three-digit section (要目) with its label in context (文脈付き分類項目名), and
each four-digit class (細目 such as 007.6) with its label in context. A four-digit label that is its
section's label followed by `--` and its own name keeps only `--` and that name, and the core puts
the section's label back in front. Four-digit labels in parentheses or brackets are left out: the
data derives them from index terms, so they name no class of the schedule.
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "core" / "vault" / "data" / "ndc9" / "labels.tsv"
RESOURCE = re.compile(r"\n(?=ndc9:\S+ a )")
HEAD = re.compile(r"ndc9:(\d{1,3}(?:\.\d)?) a ")
DERIVED = re.compile(r"^[（〔(\[]")


def labels(turtle):
    found = {}
    for block in RESOURCE.split(turtle):
        head = HEAD.match(block)
        if not head:
            continue
        notation = head.group(1)
        preferred = re.search(r'skos:prefLabel "([^"]*)"@ja', block)
        contextual = re.search(r'rdfs:label "([^"]*)"', block)
        label = contextual if len(notation) >= 3 else preferred
        if label is None or "\t" in label.group(1):
            raise SystemExit(f"Unexpected label for NDC9 {notation}")
        found[notation] = label.group(1)
    for width, count in ((1, 10), (2, 100)):
        if sum(len(notation) == width for notation in found) != count:
            raise SystemExit(f"Expected {count} NDC9 notations of {width} digits")
    return found


def stored(found):
    """The rows to write: four-digit labels lose a leading section label, or go when derived."""
    rows = {}
    for notation, label in found.items():
        if len(notation) == 5:
            if DERIVED.match(label):
                continue
            section = found.get(notation[:3])
            if section is not None and label.startswith(f"{section}--"):
                label = label[len(section) :]
        rows[notation] = label
    return rows


def main():
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    rows = stored(labels(Path(sys.argv[1]).read_text(encoding="utf-8")))
    text = (f"{notation}\t{rows[notation]}\n" for notation in sorted(rows, key=lambda n: (len(n), n)))
    OUTPUT.write_text("".join(text), encoding="utf-8")
    print(f"{OUTPUT.relative_to(ROOT)}: {len(rows)} labels")


if __name__ == "__main__":
    main()
