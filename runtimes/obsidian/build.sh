#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
mode=${1:?Usage: bash build.sh wasm|plugin}
out="$PWD/dist"
mkdir -p "$out"
case "$mode" in
  wasm)
    target_dir=$(cargo metadata --format-version=1 --no-deps --locked | jq -er .target_directory)
    map="$target_dir/book-props-vault-wasm.map"
    artifact=$(cargo rustc --locked -p book-props-vault --lib --target wasm32-unknown-unknown --release --message-format=json-render-diagnostics \
      -- "-Clink-arg=-Map=$map" \
      | jq -er 'select(.reason == "compiler-artifact" and .target.name == "book_props_vault") | .filenames[] | select(endswith(".wasm"))')
    wasm_out="$out/wasm"
    mkdir -p "$wasm_out"
    cp "$map" "$wasm_out/link.map"
    wasm-bindgen "$artifact" --target web --out-dir "$wasm_out"
    ;;
  plugin)
    esbuild src/main.ts --bundle --format=cjs --platform=node --target=es2022 --external:obsidian --loader:.wasm=binary --minify --outfile="$out/main.js"
    cp manifest.json "$out/manifest.json"
    ;;
  *)
    printf 'Usage: bash build.sh wasm|plugin\n' >&2
    exit 2
    ;;
esac
