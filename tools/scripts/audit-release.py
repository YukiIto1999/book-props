import argparse
import hashlib
import json
import os
import subprocess
import tomllib
from pathlib import Path
from urllib.parse import unquote
from zipfile import ZipFile


def archive_components(artifact):
    with ZipFile(artifact) as archive:
        npm = set()
        for name in archive.namelist():
            if name.startswith("release-metadata/npm/") and name.endswith("/package.json"):
                package = json.loads(archive.read(name))
                npm.add(f"pkg:npm/{package['name']}@{package['version']}")
        cargo = tomllib.loads(archive.read("release-metadata/rust/Cargo.lock").decode())
        rust = {f"pkg:cargo/{package['name']}@{package['version']}" for package in cargo["package"]}
    if not npm or not rust:
        raise SystemExit("The ZIP must contain both npm and Rust runtime dependencies")
    return npm | rust


def spdx_components(spdx):
    report = json.loads(spdx.read_text())
    if not report["spdxVersion"].startswith("SPDX-"):
        raise SystemExit("Expected an SPDX document")
    return {
        unquote(ref["referenceLocator"].split("?", 1)[0])
        for pkg in report["packages"]
        for ref in pkg.get("externalRefs", [])
        if ref["referenceType"] == "purl"
    }


def audit(artifact):
    expected = archive_components(artifact)
    with artifact.open("rb") as source:
        digest = hashlib.file_digest(source, "sha256").hexdigest()
    if (artifact.parent / "SHA256SUMS").read_text() != f"{digest}  {artifact.name}\n":
        raise SystemExit("The ZIP does not match SHA256SUMS")
    spdx = artifact.with_suffix(".spdx.json")
    subprocess.run(
        ("syft", "scan", str(artifact), "--source-name", artifact.name, "-o", f"spdx-json={spdx}"),
        env={**os.environ, "SYFT_CHECK_FOR_APP_UPDATE": "false"}, check=True,
    )
    missing = expected - spdx_components(spdx)
    if missing:
        raise SystemExit("SPDX is missing runtime components:\n" + "\n".join(sorted(missing)))
    subprocess.run(("osv-scanner", "scan", "source", "-L", str(spdx)), check=True)
    print(f"SPDX covers {len(expected)} runtime components for {artifact.name} ({digest})")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate and check the SPDX SBOM for a Book Props release ZIP.")
    parser.add_argument("artifact", type=Path)
    audit(parser.parse_args().artifact.resolve())
