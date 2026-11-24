#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
wasm=dist/tls
if [[ ${1-} == wasm ]]; then
  mkdir -p "$wasm"
  map="$PWD/$wasm/link.map"
  artifact=$(CC_wasm32_unknown_unknown="${BOOK_PROPS_WASM_CLANG:?Run inside devenv}" \
    cargo rustc --locked -p book-props-browser-tls --lib --target wasm32-unknown-unknown \
      --release --message-format=json-render-diagnostics -- "-Clink-arg=-Map=$map" |
    jq -r 'select(.reason == "compiler-artifact" and .target.name == "book_props_browser_tls") | .filenames[] | select(endswith(".wasm"))')
  test -f "$artifact"
  wasm-bindgen "$artifact" --target web --out-name vault_tls --out-dir "$wasm"
  exit
fi
esbuild src/worker.ts --bundle --format=esm --platform=browser --target=chrome130 --minify --outdir=dist
esbuild src/{content,options,popup}.ts --bundle --format=iife --platform=browser --target=chrome130 --minify --outdir=dist
cp manifest.json ui/{popup.html,options.html,ui.css} "$wasm/vault_tls_bg.wasm" dist/
