#!/usr/bin/env bash
set -euo pipefail

sandbox=$(mktemp -d "${XDG_RUNTIME_DIR:-${TMPDIR:-/tmp}}/bp-tls.XXXXXXXX")
trap 'rm -rf -- "$sandbox"' EXIT
mkdir -p "$sandbox/home" "$sandbox/runtime" "$sandbox/config" "$sandbox/data"
chmod 700 "$sandbox/runtime"
export HOME="$sandbox/home" XDG_RUNTIME_DIR="$sandbox/runtime"
export XDG_CONFIG_HOME="$sandbox/config" XDG_DATA_HOME="$sandbox/data"
unset GNOME_KEYRING_CONTROL DBUS_SESSION_BUS_ADDRESS DISPLAY WAYLAND_DISPLAY

dbus-run-session -- bash -euo pipefail -s <<'SESSION'
head -c 32 /dev/urandom | base64 | gnome-keyring-daemon --foreground --unlock --components=secrets >"$XDG_RUNTIME_DIR/keyring.log" 2>&1 &
keyring=$!
trap 'kill "$keyring" 2>/dev/null || true; wait "$keyring" 2>/dev/null || true' EXIT
gdbus wait --session --timeout 8 org.freedesktop.secrets
node --experimental-transform-types --disable-warning=ExperimentalWarning --test runtimes/obsidian/tests/medium/connection.test.mjs
SESSION
