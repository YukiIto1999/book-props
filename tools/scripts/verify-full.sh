#!/usr/bin/env bash
set -euo pipefail

# T3。全量回帰と選択型の mutation の分析を、別々の Nx の走行として順に起動する。
# それぞれに tools/verification-budget.json の上限を付ける。回帰が先に完走して結果を記録し、分析は
# その結果を変えない。分析の生の終了 status は work/mutation/runs/ の record.json に残し、ここでは
# 表示だけにする。この入口の終了 status は回帰のものにする。全量の分析は mutation-full で明示して起動する。
regression_limit="$(node -p "require('./tools/verification-budget.json').regression_full_seconds")"

regression=0
timeout --signal=TERM --kill-after=60 "$regression_limit" \
  pnpm exec nx run book-props:regression-full || regression=$?
echo "verify-full: regression-full exit status $regression (limit ${regression_limit}s)" >&2

analysis=0
pnpm exec nx run book-props:mutation-in-diff || analysis=$?
echo "verify-full: mutation-in-diff exit status $analysis (analysis only; the exit status of verify-full is the regression's)" >&2

exit "$regression"
