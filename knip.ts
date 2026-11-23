import type { KnipConfig } from "knip";

const config: KnipConfig = {
  ignoreBinaries: ["oxfmt", "oxlint"],
  ignoreDependencies: ["eslint-plugin-sonarjs", "oxlint-tsgolint"],
  workspaces: {
    ".": {
      entry: ["tools/scripts/mutation-record.mjs"],
      project: ["tools/**/*.mjs"],
    },
    "runtimes/book-extension": {
      entry: ["src/{worker,content,options,popup}.ts"],
      project: ["src/**/*.ts"],
    },
    "runtimes/obsidian": {
      entry: ["src/main.ts", "tests/*.test.mjs", "tests/medium/*.test.mjs"],
      project: ["src/**/*.ts", "tests/**/*.mjs"],
    },
    "tests/arch/medium/typescript": { entry: ["*.test.mjs"] },
  },
};

export default config;
