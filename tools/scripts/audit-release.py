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


def file_digest(path):
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def check_assets(artifact):
    """Each store's files must be bytes of the audited ZIP, so its SBOM and attestation describe them."""
    directory = artifact.parent
    version = artifact.name.removeprefix("book-props-").removesuffix(".zip")
    with ZipFile(artifact) as archive:
        members = {name: archive.read(name) for name in archive.namelist()}
    shared = {name: members[name] for name in ("LICENSE", "THIRD-PARTY-NOTICES.txt")}
    chrome = {name.removeprefix("chrome/"): data for name, data in members.items() if name.startswith("chrome/")}
    store = directory / f"book-props-chrome-{version}.zip"
    with ZipFile(store) as archive:
        if {name: archive.read(name) for name in archive.namelist()} != chrome | shared:
            raise SystemExit(f"{store.name} differs from the audited ZIP")
    for name, member in (
        ("main.js", "obsidian/main.js"),
        ("manifest.json", "obsidian/manifest.json"),
        ("THIRD-PARTY-NOTICES.txt", "THIRD-PARTY-NOTICES.txt"),
    ):
        if (directory / name).read_bytes() != members[member]:
            raise SystemExit(f"{name} differs from {member} in the audited ZIP")
    listed = dict(reversed(line.split("  ", 1)) for line in (directory / "SHA256SUMS").read_text().splitlines())
    names = {artifact.name, store.name, "main.js", "manifest.json", "THIRD-PARTY-NOTICES.txt"}
    if set(listed) != names or any(listed[name] != file_digest(directory / name) for name in names):
        raise SystemExit("SHA256SUMS does not match the release assets")


def audit(artifact):
    expected, local = archive_components(artifact)
    digest = file_digest(artifact)
    check_assets(artifact)
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
