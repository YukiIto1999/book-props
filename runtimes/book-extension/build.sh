#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
esbuild src/{worker,content,options,popup}.ts --bundle --format=iife --platform=browser --target=chrome130 --minify --outdir=dist
cp manifest.json ui/{popup.html,options.html,ui.css} dist/
