#!/usr/bin/env bash
set -euo pipefail

# T3 の全量の mutation の分析。全量回帰とは別の走行であり、製品の合否には使わない。前回の T3 の結果に
# 無かった検出されなかった mutant を backlog へ追記する。変異の生成が 0 件の実行と、baseline のテストが
# 通らない実行は、分析の不成立として失敗にする。
# cargo-mutants は開始時に前回の mutants.out を mutants.out.old へ移すので、それを前回の結果とする。
readonly current="mutants.out"
readonly previous="mutants.out.old"
readonly backlog="work/backlog.md"

mutant_count="$(cargo mutants --list --workspace | wc -l)"
if [[ "$mutant_count" -eq 0 ]]; then
  echo "cargo mutants generated no mutants; the target selection is wrong" >&2
  exit 1
fi

limit_seconds="$(node -p "require('./tools/verification-time.json')['mutation-full'].limit_seconds")"
mutant_timeout="$(node -p "require('./tools/verification-time.json').mutant.limit_seconds")"
status=0
timeout --signal=TERM --kill-after=60 "$limit_seconds" \
  cargo mutants --workspace --test-workspace=true --timeout="$mutant_timeout" || status=$?
echo "mutation-full: cargo mutants exit status $status (limit ${limit_seconds}s; 124 is the limit)" >&2
# 0 は全件検出、2 は未検出、3 は timeout で、いずれも差分として記録する。それ以外は実行の失敗である
case "$status" in
  0 | 2 | 3) ;;
  *) exit "$status" ;;
esac

# 行と列は前後の編集でずれるため、file と変異の記述の組で前回と比べる
undetected() {
  local dir="$1"
  cat -- "$dir/missed.txt" "$dir/timeout.txt" 2>/dev/null | sed -E 's/^([^:]+):[0-9]+:[0-9]+: /\1: /' | sort -u
}

new_undetected="$(comm -13 <(undetected "$previous") <(undetected "$current"))"
if [[ -z "$new_undetected" ]]; then
  echo "mutation-full: no new undetected mutants since the previous run" >&2
  exit 0
fi

mkdir -p -- "$(dirname -- "$backlog")"
{
  printf '\n## %s mutation-full の分析\n\n' "$(date -Iseconds)"
  printf '前回の T3 の結果に無かった、検出されなかった mutant である。位置は %s/missed.txt と %s/timeout.txt にある。テストまたは仕様の修正候補として扱う。\n\n' "$current" "$current"
  printf '%s\n' "$new_undetected" | sed 's/^/- /'
} >>"$backlog"
printf '%s\n' "$new_undetected" >&2
echo "mutation-full: recorded $(printf '%s\n' "$new_undetected" | wc -l) new undetected mutants in $backlog" >&2
