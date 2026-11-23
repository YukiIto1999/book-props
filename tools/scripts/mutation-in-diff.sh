#!/usr/bin/env bash
set -euo pipefail

# 通常の T3 の mutation の分析。前回完了した分析の commit から HEAD までの差分だけを、cargo-mutants の
# --in-diff で変異させる。前回が無ければ nx.json の defaultBase と HEAD の merge-base を比較元にする。
# 製品の合否には使わない。分析ごとに work/mutation/runs/<時刻>-<HEAD>/ を作り、比較元と HEAD、差分、
# cargo-mutants の生の出力と結果、結果の分類(record.json)を上書きせずに残す。
# 結果の分類(outcome)は次のいずれかである。
#   diff-failed     比較元または差分を取れなかった
#   no-change       比較元から HEAD までに変更が無い
#   zero-mutants    変更はあるが、変異の対象が 0 件だった
#   analyzed        cargo-mutants が完走した(raw_status が 0、2、3)
#   limit-exceeded  tools/verification-budget.json の上限で止めた
#   run-failed      それ以外の終了 status(baseline の失敗など)
# analyzed、no-change、zero-mutants のときだけ、HEAD を次の比較元として保存する。
readonly state_dir="work/mutation"
readonly last_file="$state_dir/last-analyzed-commit"
readonly budget="tools/verification-budget.json"

budget_value() {
  node -p "require('./$budget').$1"
}
limit_seconds="$(budget_value mutation_in_diff_seconds)"
mutant_timeout="$(budget_value mutant_timeout_seconds)"

started="$(date -Iseconds)"
head="$(git rev-parse HEAD)"
worktree_dirty=false
if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  worktree_dirty=true
fi
run_dir="$state_dir/runs/$(date -u +%Y%m%dT%H%M%SZ)-$(git rev-parse --short HEAD)"
mkdir -p -- "$run_dir"

finish() {
  local outcome="$1" raw_status="$2"
  node tools/scripts/mutation-record.mjs "$run_dir" \
    "outcome=$outcome" "raw_status=$raw_status" "base=${base:-}" "base_source=${base_source:-}" \
    "head=$head" "worktree_dirty=$worktree_dirty" "started=$started" "finished=$(date -Iseconds)" \
    "limit_seconds=$limit_seconds" "mutant_timeout_seconds=$mutant_timeout"
  case "$outcome" in
    analyzed | no-change | zero-mutants) printf '%s\n' "$head" >"$last_file" ;;
  esac
  echo "mutation-in-diff: outcome $outcome (raw status $raw_status), recorded in $run_dir/record.json" >&2
}

base=""
base_source=""
if [[ -f "$last_file" ]] && previous="$(<"$last_file")" &&
  git merge-base --is-ancestor "$previous" HEAD 2>/dev/null; then
  base="$previous"
  base_source="previous-analysis"
elif default_base="$(node -p 'require("./nx.json").defaultBase')" &&
  merge_base="$(git merge-base "$default_base" HEAD)"; then
  base="$merge_base"
  base_source="merge-base:$default_base"
else
  finish diff-failed ""
  exit 1
fi

if ! git diff --no-ext-diff --no-color -U0 --src-prefix=a/ --dst-prefix=b/ "$base" "$head" >"$run_dir/diff.patch"; then
  finish diff-failed ""
  exit 1
fi
if [[ ! -s "$run_dir/diff.patch" ]]; then
  finish no-change ""
  exit 0
fi

list_status=0
cargo mutants --list --in-diff "$run_dir/diff.patch" --workspace >"$run_dir/mutants-list.txt" 2>"$run_dir/mutants-list.stderr" || list_status=$?
if [[ "$list_status" -ne 0 ]]; then
  finish run-failed "$list_status"
  exit 1
fi
if [[ ! -s "$run_dir/mutants-list.txt" ]]; then
  finish zero-mutants 0
  exit 0
fi

status=0
timeout --signal=TERM --kill-after=60 "$limit_seconds" \
  cargo mutants --in-diff "$run_dir/diff.patch" --workspace --test-workspace=true \
  --timeout="$mutant_timeout" --output "$run_dir" >"$run_dir/cargo-mutants.log" 2>&1 || status=$?
case "$status" in
  0 | 2 | 3) finish analyzed "$status" ;;
  124 | 137) finish limit-exceeded "$status" ;;
  *) finish run-failed "$status" ;;
esac
exit "$status"
