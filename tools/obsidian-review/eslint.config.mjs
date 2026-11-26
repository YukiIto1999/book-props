// Obsidian コミュニティの自動審査と同じ規則で、リポジトリの TypeScript を検査する。
// 審査の設定: https://github.com/obsidianmd/eslint-plugin/blob/master/docs/configuration.md#community-plugin-scanner-configuration
import { defineConfig, globalIgnores } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";
import tseslint from "typescript-eslint";

// tsconfig の外にあるファイルは、審査と同じく型情報を使う規則を外して検査する
const untyped = ["*.ts", "contracts/**/*.ts", "libs/**/*.ts"];
const typedObsidianRules = Object.entries(obsidianmd.rules)
  .filter(([, rule]) => rule.meta?.docs?.requiresTypeChecking)
  .map(([name]) => [`obsidianmd/${name}`, "off"]);

export default defineConfig([
  { languageOptions: { parserOptions: { projectService: true } } },
  ...obsidianmd.configs.recommended,
  {
    files: ["**/*.{ts,tsx,js,jsx}"],
    rules: {
      "no-eval": "error",
      "no-unsanitized/method": "error",
      "no-unsanitized/property": "error",
      "obsidianmd/regex-lookbehind": "error",
      "obsidianmd/no-forbidden-elements": "error",
      "no-undef": "off",
      "@typescript-eslint/restrict-template-expressions": "off",
      "@typescript-eslint/no-base-to-string": "off",
      "import/no-unresolved": "off",
      // 新しく申請するプラグインに審査が加える層
      "@typescript-eslint/no-unsafe-member-access": "warn",
      "@typescript-eslint/no-unsafe-assignment": "warn",
      "@typescript-eslint/no-unsafe-argument": "warn",
      "@typescript-eslint/no-unsafe-call": "warn",
      "@typescript-eslint/no-unsafe-return": "warn",
      "obsidianmd/commands/no-command-in-command-id": "warn",
      "obsidianmd/commands/no-plugin-id-in-command-id": "warn",
      "obsidianmd/settings-tab/no-manual-html-headings": "error",
      "obsidianmd/settings-tab/no-problematic-settings-headings": "error",
      "obsidianmd/sample-names": "error",
      "obsidianmd/no-sample-code": "error",
      "obsidianmd/platform": "error",
      "obsidianmd/no-plugin-as-component": "error",
      "obsidianmd/detach-leaves": "error",
      "obsidianmd/no-static-styles-assignment": "error",
      "obsidianmd/no-view-references-in-plugin": "error",
      "obsidianmd/no-unsupported-api": "error",
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    rules: { "@typescript-eslint/no-implied-eval": "error" },
  },
  {
    files: untyped,
    extends: [tseslint.configs.disableTypeChecked],
    rules: { ...Object.fromEntries(typedObsidianRules), "no-implied-eval": "error" },
  },
  // 審査は manifest.json と LICENSE を別に確かめる
  { files: ["manifest.json"], rules: { "obsidianmd/validate-manifest": "off" } },
  { files: ["LICENSE"], rules: { "obsidianmd/validate-license": "off" } },
  globalIgnores([
    "**/node_modules",
    "**/dist",
    "**/target",
    ".nx",
    "work",
    "**/*.cjs",
    "**/*.mjs",
    "**/*.cts",
    "**/*.mts",
    "**/tests/**",
    "**/*.test.*",
    "**/scripts/**",
    "**/docs/**",
  ]),
]);
