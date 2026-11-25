import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { basename, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { field, selectFolder } from "./obsidian.mjs";
import { timeout } from "./wait.mjs";

const run = promisify(execFile);
const directory = ".book-props-connection-directory";
export const paired = "ペアリング済みです。";
export const unavailable =
  "接続を確認できません。Obsidian を開いてください。接続用フォルダの許可が切れている場合は「今後も自動で接続する」を押してください。";

export async function text(page, selector, expected) {
  await page.waitForFunction(
    (s, label) => document.querySelector(s)?.textContent === label,
    { timeout },
    selector,
    expected,
  );
}

export async function configure(settings, id) {
  await selectFolder(settings, "Books");
  await field(settings, "Chrome拡張ID", id);
  await settings.locator("button::-p-text(接続設定を適用)").click();
}

async function browserDialog(chrome, operation, value, signal) {
  const arguments_ = [String(chrome.process().pid), operation, value];
  try {
    if (process.platform === "win32") {
      await run(
        "powershell.exe",
        [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-MTA",
          "-File",
          fileURLToPath(new URL("./chrome-dialog.ps1", import.meta.url)),
          ...arguments_,
        ],
        { timeout, signal },
      );
    } else {
      await run(
        "/usr/bin/python3",
        [fileURLToPath(new URL("./chrome-dialog.py", import.meta.url)), ...arguments_],
        { timeout, signal },
      );
    }
  } catch (error) {
    throw new Error(`${operation}: ${error.stdout}\n${error.stderr}`, { cause: error });
  }
}

export async function pairWith(settings, options, chrome) {
  await settings.bringToFront();
  await settings.locator("button::-p-text(接続設定を適用)").click();
  const path = await settings
    .locator(directory)
    .setTimeout(timeout)
    .map((element) => element.textContent.trim())
    .wait();
  assert(isAbsolute(path));
  await options.bringToFront();
  await options.locator("#pair").click();
  await browserDialog(chrome, "folder", path);
  const approval = new AbortController();
  const completed = text(
    options,
    "#status",
    "ペアリングしました。初回設定の仕上げに「今後も自動で接続する」で「毎回許可」を選んでください。",
  );
  try {
    await Promise.race([
      completed,
      browserDialog(chrome, "folder-permission", basename(path), approval.signal).then(
        () => completed,
      ),
    ]);
  } finally {
    approval.abort();
  }
  return basename(path);
}

export async function remember(options, chrome, folder) {
  await options.bringToFront();
  await options.locator("#allow").click();
  await browserDialog(chrome, "folder-persist", folder);
  await text(options, "#status", paired);
}
