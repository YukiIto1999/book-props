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
        rust = {f"pkg:cargo/{pkg['name']}@{pkg['version']}" for pkg in cargo["package"] if pkg.get("source")}
        local = {(pkg["name"], pkg["version"]) for pkg in cargo["package"] if not pkg.get("source")}
    if not npm or not rust:
        raise SystemExit("The ZIP must contain both npm and Rust registry dependencies")
    return npm | rust, local


def verify_spdx(spdx, artifact, digest, expected, local):
    report = json.loads(spdx.read_text())
    if not report["spdxVersion"].startswith("SPDX-"):
        raise SystemExit("Expected an SPDX document")
    packages = report["packages"]
    if not any(
        pkg["name"] == artifact.name
        and pkg.get("primaryPackagePurpose") == "FILE"
        and {"algorithm": "SHA256", "checksumValue": digest} in pkg.get("checksums", [])
        for pkg in packages
    ):
        raise SystemExit("SPDX does not identify the checked ZIP by SHA-256")
    purls = {
        unquote(ref["referenceLocator"].split("?", 1)[0])
        for pkg in packages
        for ref in pkg.get("externalRefs", [])
        if ref["referenceType"] == "purl"
    }
    # Rust sysroot workspace packages are not crates.io packages.
    documented = {
        (pkg["name"], pkg.get("versionInfo"))
        for pkg in packages
        if pkg.get("sourceInfo", "").endswith(": release-metadata/rust/Cargo.lock")
    }
    missing = (expected - purls) | {f"Rust workspace {name}@{version}" for name, version in local - documented}
    if missing:
        raise SystemExit("SPDX is missing runtime components:\n" + "\n".join(sorted(missing)))


def audit(artifact):
    expected, local = archive_components(artifact)
    with artifact.open("rb") as source:
        digest = hashlib.file_digest(source, "sha256").hexdigest()
    if (artifact.parent / "SHA256SUMS").read_text() != f"{digest}  {artifact.name}\n":
        raise SystemExit("The ZIP does not match SHA256SUMS")
    spdx = artifact.with_suffix(".spdx.json")
    subprocess.run(
        (
            "syft", "scan", str(artifact), "--source-name", artifact.name,
            "--select-catalogers", "+javascript-package-cataloger", "-o", f"spdx-json={spdx}",
        ),
        env={**os.environ, "SYFT_CHECK_FOR_APP_UPDATE": "false"}, check=True,
    )
    verify_spdx(spdx, artifact, digest, expected, local)
    subprocess.run(("osv-scanner", "scan", "source", "-L", str(spdx)), check=True)
    print(f"SPDX covers {len(expected) + len(local)} runtime components for {artifact.name} ({digest})")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate and check the SPDX SBOM for a Book Props release ZIP.")
    parser.add_argument("artifact", type=Path)
    audit(parser.parse_args().artifact.resolve())
