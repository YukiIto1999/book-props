import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import tomllib
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo


ROOT = Path(__file__).resolve().parents[2]
# Bundle name = runtime folder under runtimes/: (files copied from its dist, generated wasm folder kept out of the bundle).
BUNDLES = {
    "obsidian": (("main.js", "manifest.json"), "wasm"),
    "chrome": (
        (
            "content.js", "icon-128.png", "icon-16.png", "icon-32.png", "icon-48.png", "manifest.json",
            "options.html", "options.js", "popup.html", "popup.js", "ui.css", "vault_tls_bg.wasm", "worker.js",
        ),
        "tls",
    ),
}
NOTICE_NAME = re.compile(r"^(licen[cs]e|notice|copying|copyright)([-_.]|$)", re.IGNORECASE)
VERSION = re.compile(r"(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)")


def inspect_json(*command):
    return json.loads(subprocess.check_output(command, cwd=ROOT))


def npm_packages():
    report = inspect_json(
        "pnpm", "--filter", "@book-props/obsidian...", "--filter", "@book-props/chrome...",
        "licenses", "list", "--prod", "--json",
    )
    packages = {}
    for group in report.values():
        for record in group:
            for directory in map(Path, record["paths"]):
                manifest = json.loads((directory / "package.json").read_text())
                packages[(manifest["name"], manifest["version"])] = directory
    if not packages:
        raise SystemExit("No production npm packages in the release inventory")
    return packages


def wasm_packages():
    report = inspect_json(
        "cargo", "metadata", "--format-version", "1", "--locked", "--offline",
        "--filter-platform", "wasm32-unknown-unknown",
    )
    packages = {pkg["id"]: pkg for pkg in report["packages"]}
    nodes = {node["id"]: node for node in report["resolve"]["nodes"]}
    crates = {"book-props-vault", "book-props-browser-tls"}
    remaining = [member for member in report["workspace_members"] if packages[member]["name"] in crates]
    if {packages[member]["name"] for member in remaining} != crates:
        raise SystemExit(f"Missing release Wasm crate: expected {sorted(crates)}")
    seen = set()
    runtime = {}
    while remaining:
        package_id = remaining.pop()
        if package_id in seen:
            continue
        seen.add(package_id)
        pkg = packages[package_id]
        if any("proc-macro" in target["kind"] for target in pkg["targets"]):
            continue
        if pkg["source"]:
            runtime[(pkg["name"], pkg["version"], pkg["source"])] = Path(pkg["manifest_path"]).parent
        remaining.extend(
            dep["pkg"] for dep in nodes[package_id]["deps"]
            if any(kind["kind"] is None for kind in dep["dep_kinds"])
        )
    if not runtime:
        raise SystemExit("No production Rust packages in the release inventory")
    return runtime


def lockfile(path):
    with path.open("rb") as source:
        lock = tomllib.load(source)
    return {(pkg["name"], pkg["version"], pkg.get("source")): pkg for pkg in lock["package"]}


def sysroot_packages():
    revision = os.environ.get("BOOK_PROPS_RUST_REVISION")
    if not revision:
        raise SystemExit("Run packaging in the devenv release profile")
    rustc = subprocess.check_output(("rustc", "-Vv"), text=True)
    if f"commit-hash: {revision}" not in rustc.splitlines():
        raise SystemExit("Rust compiler does not match the release license revision")
    libdir = subprocess.check_output(
        ("rustc", "--print", "target-libdir", "--target", "wasm32-unknown-unknown"), text=True,
    ).strip()
    # Both bundles link std's hashbrown: the TLS client and serde-wasm-bindgen's string cache use it.
    expected = {"alloc", "compiler_builtins", "core", "dlmalloc", "hashbrown", "panic_abort", "std"}
    for name, (_, generated) in BUNDLES.items():
        link_map = (ROOT / "runtimes" / name / "dist" / generated / "link.map").read_text()
        linked = set(re.findall(re.escape(libdir) + r"/lib(\w+)-[0-9a-f]+\.rlib\(", link_map))
        if linked != expected:
            raise SystemExit(f"Review linked Rust libraries ({name}): expected {sorted(expected)}, found {sorted(linked)}")
    library = Path(os.environ["BOOK_PROPS_RUST_LIBRARY"])
    packages = {}
    entries = {}
    for identity, pkg in lockfile(library / "Cargo.lock").items():
        name, version, source = identity
        if name in {"dlmalloc", "hashbrown"} and source:
            packages[identity] = library / "vendor" / f"{name}-{version}"
        elif name == "compiler_builtins" and not source:
            packages[identity] = library / "compiler-builtins"
        else:
            continue
        entries[identity] = pkg
    if {name for name, _, _ in packages} != {"compiler_builtins", "dlmalloc", "hashbrown"}:
        raise SystemExit("Missing release components in the linked Rust library lockfile")
    return packages, entries


def cargo_inventory(packages, sysroot_entries):
    entries = lockfile(ROOT / "Cargo.lock") | sysroot_entries
    rows = ["version = 4"]
    for identity in sorted(packages, key=lambda item: (item[0], item[1], item[2] or "")):
        pkg = entries[identity]
        rows.extend(("", "[[package]]"))
        rows.extend(f"{field} = {json.dumps(pkg[field])}" for field in ("name", "version", "source", "checksum") if field in pkg)
    return "\n".join(rows) + "\n"


def notices(npm, rust):
    texts = []
    for ecosystem, packages in (("npm", npm), ("cargo", rust)):
        for identity, directory in sorted(packages.items()):
            files = sorted(path for path in directory.iterdir() if path.is_file() and NOTICE_NAME.match(path.name))
            if not files:
                raise SystemExit(f"Missing third-party license text: {ecosystem}:{identity[0]}@{identity[1]}")
            if ecosystem == "cargo" and identity[0] == "ring":
                files.append(directory / "third_party" / "fiat" / "LICENSE")
            for path in files:
                texts.append(f"{ecosystem}:{identity[0]}@{identity[1]} — {path.relative_to(directory)}\n\n{path.read_text().strip()}\n")
    return "\n".join(texts)


def rust_notices():
    texts = []
    for name, variable in (
        ("COPYRIGHT", "BOOK_PROPS_RUST_COPYRIGHT"),
        ("LICENSE-APACHE", "BOOK_PROPS_RUST_LICENSE_APACHE"),
        ("LICENSE-MIT", "BOOK_PROPS_RUST_LICENSE_MIT"),
    ):
        texts.append(f"Rust standard library — {name}\n\n{Path(os.environ[variable]).read_text().strip()}\n")
    return "\n".join(texts)


def data_notices():
    """Notices of the third-party data compiled into the Obsidian plugin's core."""
    notice = ROOT / "core" / "vault" / "data" / "ndc9" / "NOTICE.txt"
    return f"data:ndc9 — {notice.relative_to(ROOT)}\n\n{notice.read_text(encoding='utf-8').strip()}\n"


def bundle_inputs(version):
    files = {"LICENSE": ROOT / "LICENSE"}
    manifests = [ROOT / "package.json", ROOT / "manifest.json", ROOT / "runtimes" / "chrome" / "manifest.json"]
    for name, (members, generated) in BUNDLES.items():
        source = ROOT / "runtimes" / name
        dist = source / "dist"
        if not dist.is_dir():
            raise SystemExit(f"Missing build output: {dist.relative_to(ROOT)}")
        expected = set(members)
        actual = {path.name for path in dist.iterdir()}
        if (dist / generated).is_dir():
            actual.discard(generated)
        if actual != expected:
            raise SystemExit(
                f"Unexpected contents of {dist.relative_to(ROOT)}:"
                f" missing {sorted(expected - actual)}, extra {sorted(actual - expected)}"
            )
        manifests.append(dist / "manifest.json")
        files.update({f"{name}/{member}": dist / member for member in members})
    for path in manifests:
        actual = json.loads(path.read_text())["version"]
        if actual != version:
            raise SystemExit(f"Release version {version} does not match {path.relative_to(ROOT)} ({actual})")
    for path in files.values():
        if not path.is_file() or path.stat().st_size == 0:
            raise SystemExit(f"Missing or empty package input: {path.relative_to(ROOT)}")
    return files


def write_zip(path, contents):
    with ZipFile(path, "x") as archive:
        for name, data in sorted(contents.items()):
            entry = ZipInfo(name)
            entry.create_system = 3
            entry.external_attr = 0o100644 << 16
            archive.writestr(entry, data, compress_type=ZIP_DEFLATED, compresslevel=9)


def release_assets(version, contents):
    """The combined ZIP for manual installs, plus the files each store takes from the same bytes."""
    shared = {name: contents[name] for name in ("LICENSE", "THIRD-PARTY-NOTICES.txt")}
    chrome = {name.removeprefix("chrome/"): data for name, data in contents.items() if name.startswith("chrome/")}
    return {
        f"book-props-{version}.zip": contents,
        f"book-props-chrome-{version}.zip": chrome | shared,
        "main.js": contents["obsidian/main.js"],
        "manifest.json": contents["obsidian/manifest.json"],
        "THIRD-PARTY-NOTICES.txt": contents["THIRD-PARTY-NOTICES.txt"],
    }


def pack(version, output):
    if not VERSION.fullmatch(version):
        raise SystemExit("Expected a version such as 0.5.0")
    inputs = bundle_inputs(version)
    npm = npm_packages()
    sysroot, sysroot_entries = sysroot_packages()
    rust = wasm_packages() | sysroot
    inputs.update({
        f"release-metadata/npm/{index}/node_modules/{name}/package.json": npm[(name, package_version)] / "package.json"
        for index, (name, package_version) in enumerate(sorted(npm))
    })
    contents = {name: path.read_bytes() for name, path in inputs.items()}
    contents["release-metadata/rust/Cargo.lock"] = cargo_inventory(rust, sysroot_entries).encode()
    contents["THIRD-PARTY-NOTICES.txt"] = (
        notices(npm, rust) + "\n" + rust_notices() + "\n" + data_notices()
    ).encode()
    output.mkdir()
    try:
        sums = []
        for name, asset in sorted(release_assets(version, contents).items()):
            path = output / name
            if isinstance(asset, dict):
                write_zip(path, asset)
            else:
                path.write_bytes(asset)
            with path.open("rb") as artifact:
                sums.append(f"{hashlib.file_digest(artifact, 'sha256').hexdigest()}  {name}\n")
        (output / "SHA256SUMS").write_text("".join(sums), encoding="ascii")
    except BaseException:
        shutil.rmtree(output)
        raise
    print(output)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Package the verified Chrome and Obsidian builds as release assets.")
    parser.add_argument("version", help="Release version such as 0.5.0, also the tag name")
    parser.add_argument("output", type=Path, help="New output directory")
    arguments = parser.parse_args()
    pack(arguments.version, arguments.output.resolve())
