// T3 の mutation の分析 1 回分の記録(record.json)を書き、work/mutation/index.jsonl へ 1 行を足す。
// 使い方: node tools/scripts/mutation-record.mjs RUN_DIR key=value...
// RUN_DIR の diff.patch(分析した差分)と mutants.out/outcomes.json(cargo-mutants の生の結果)を読む。
// 未検出の mutant ごとに変更行との重なりを記し、原因と重大度は後から人が書く欄として null で残す。
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** @returns {Map<string, number[]>} 変更後の path から、昇順の行番号への対応 */
function parseChangedLines(diffText) {
  const changed = new Map();
  let file = null;
  for (const line of diffText.split("\n")) {
    if (line.startsWith("+++ ")) {
      const target = line.slice(4);
      file = target === "/dev/null" ? null : target.replace(/^b\//u, "");
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/u.exec(line);
    if (hunk === null || file === null) continue;
    const start = Number(hunk[1]);
    const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
    const lines = changed.get(file) ?? [];
    for (let offset = 0; offset < count; offset += 1) lines.push(start + offset);
    changed.set(file, lines);
  }
  return changed;
}

const [runDir, ...pairs] = process.argv.slice(2);
const fields = Object.fromEntries(
  pairs.map((pair) => {
    const at = pair.indexOf("=");
    return [pair.slice(0, at), pair.slice(at + 1)];
  }),
);

const diffPath = join(runDir, "diff.patch");
const changed = existsSync(diffPath)
  ? parseChangedLines(readFileSync(diffPath, "utf8"))
  : new Map();

const outcomesPath = join(runDir, "mutants.out", "outcomes.json");
const outcomes = existsSync(outcomesPath) ? JSON.parse(readFileSync(outcomesPath, "utf8")) : null;

const undetectedSummaries = new Set(["MissedMutant", "Timeout"]);
const undetected = (outcomes?.outcomes ?? [])
  .filter((outcome) => outcome.scenario?.Mutant && undetectedSummaries.has(outcome.summary))
  .map((outcome) => {
    const mutant = outcome.scenario.Mutant;
    const start = mutant.span.start.line;
    const end = mutant.span.end.line;
    const overlapped = (changed.get(mutant.file) ?? []).filter(
      (line) => line >= start && line <= end,
    );
    return {
      name: mutant.name,
      file: mutant.file,
      lines: { start, end },
      summary: outcome.summary,
      overlaps_changed_lines: overlapped.length > 0,
      overlapped_changed_lines: overlapped,
      // structure/tests/methods.md「テストの有効性」の原因表の分類。分析の後に人が書く
      cause: null,
      severity: null,
      note: null,
    };
  });

const record = {
  ...fields,
  raw_status: fields.raw_status ? Number(fields.raw_status) : null,
  changed_files: changed.size,
  changed_lines: [...changed.values()].reduce((sum, lines) => sum + lines.length, 0),
  cargo_mutants_version: outcomes?.cargo_mutants_version ?? null,
  counts:
    outcomes === null
      ? null
      : {
          total: outcomes.total_mutants,
          caught: outcomes.caught,
          missed: outcomes.missed,
          timeout: outcomes.timeout,
          unviable: outcomes.unviable,
        },
  undetected,
};

writeFileSync(join(runDir, "record.json"), `${JSON.stringify(record, null, 2)}\n`);
appendFileSync(
  join(runDir, "..", "..", "index.jsonl"),
  `${JSON.stringify({
    run_dir: runDir,
    outcome: record.outcome,
    base: record.base,
    head: record.head,
    raw_status: record.raw_status,
    undetected: undetected.length,
  })}\n`,
);
