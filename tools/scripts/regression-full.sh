#!/usr/bin/env bash
set -euo pipefail

# T1 と実結合をすべて回し依存する task の cache を使わない
readonly result_log="work/regression-full.log"

status=0
pnpm exec nx run book-props:verify-push --skip-nx-cache --parallel=1 || status=$?

source_id="$(git rev-parse --short HEAD)"
if [[ -n "$(git status --porcelain)" ]]; then
  source_id="$source_id+worktree"
fi

mkdir -p -- "$(dirname -- "$result_log")"
printf '%s regression-full exit=%s source=%s\n' "$(date -Iseconds)" "$status" "$source_id" >>"$result_log"
echo "regression-full: exit status $status, recorded in $result_log" >&2
exit "$status"
