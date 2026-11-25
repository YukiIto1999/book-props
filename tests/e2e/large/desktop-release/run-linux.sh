#!/usr/bin/env bash
set -euo pipefail

: "${RUNNER_TEMP:?}" "${TAG:?}" "${ZIP_HASH:?}"
[[ ${GITHUB_ACTIONS-} == true ]]
[[ $TAG =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]]
[[ $ZIP_HASH =~ ^[0-9a-f]{64}$ ]]
assets="$RUNNER_TEMP/assets"
filename="book-props-$TAG.zip"
expected="$ZIP_HASH  $filename"
[[ $(cat "$assets/SHA256SUMS") == "$expected" ]]
(cd "$assets" && printf '%s\n' "$expected" | sha256sum --check --strict -)

root="$RUNNER_TEMP/book-props-desktop"
mkdir "$root"
unzip -q "$assets/$filename" -d "$root/bundle"
curl --fail --silent --show-error --location --output "$root/chrome.zip" \
  'https://storage.googleapis.com/chrome-for-testing-public/157.0.8103.79/linux64/chrome-linux64.zip'
unzip -q "$root/chrome.zip" -d "$root"

# Give only the runner's unpacked browser access to the user namespace needed by its sandbox.
chrome="$root/chrome-linux64/chrome"
profile=$(mktemp "$RUNNER_TEMP/book-props-cft.XXXXXX")
printf 'abi <abi/4.0>,\n#include <tunables/global>\nprofile book-props-cft "%s" flags=(unconfined) {\n  userns,\n}\n' \
  "$chrome" > "$profile"
trap 'rm -f "$profile"' EXIT
sudo apparmor_parser --add "$profile"
trap 'sudo apparmor_parser --remove "$profile"; rm -f "$profile"' EXIT
sudo apt-get install -y at-spi2-core python3-pyatspi scrot xdotool
env -u NO_AT_BRIDGE ACCESSIBILITY_ENABLED=1 dbus-run-session -- xvfb-run -a corepack pnpm verify:release:desktop
