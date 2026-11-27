"""Writes core/vault/data/ndc9/labels.tsv from the JLA NDC9 Linked Data (ndc9.ttl).

Usage: python3 tools/scripts/ndc9-labels.py path/to/ndc9.ttl

The data comes from https://www.jla.or.jp/committees/bunrui/ndc-data/ (ndc9.zip, CC BY).
Only the names Book Props shows are kept: each main class (類目) and division (綱目) with its
preferred label, and each three-digit section (要目) with its label in context (文脈付き分類項目名).
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "core" / "vault" / "data" / "ndc9" / "labels.tsv"
RESOURCE = re.compile(r"\n(?=ndc9:\S+ a )")
HEAD = re.compile(r"ndc9:(\d{1,3}) a ")


def labels(turtle):
    found = {}
    for block in RESOURCE.split(turtle):
        head = HEAD.match(block)
        if not head:
            continue
        notation = head.group(1)
        preferred = re.search(r'skos:prefLabel "([^"]*)"@ja', block)
        contextual = re.search(r'rdfs:label "([^"]*)"', block)
        label = contextual if len(notation) == 3 else preferred
        if label is None or "\t" in label.group(1):
            raise SystemExit(f"Unexpected label for NDC9 {notation}")
        found[notation] = label.group(1)
    for width, count in ((1, 10), (2, 100)):
        if sum(len(notation) == width for notation in found) != count:
            raise SystemExit(f"Expected {count} NDC9 notations of {width} digits")
    return found


def main():
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    found = labels(Path(sys.argv[1]).read_text(encoding="utf-8"))
    rows = (f"{notation}\t{found[notation]}\n" for notation in sorted(found, key=lambda n: (len(n), n)))
    OUTPUT.write_text("".join(rows), encoding="utf-8")
    print(f"{OUTPUT.relative_to(ROOT)}: {len(found)} labels")


if __name__ == "__main__":
    main()
