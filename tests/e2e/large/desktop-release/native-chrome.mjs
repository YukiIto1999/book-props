import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { timeout } from "./wait.mjs";

const run = promisify(execFile);

export async function browserDialog(chrome, operation, value, signal) {
  const win32 = process.platform === "win32";
  const driver = fileURLToPath(
    new URL(win32 ? "./chrome-dialog.ps1" : "./chrome-dialog.py", import.meta.url),
  );
  const args = [String(chrome.process().pid), operation, value];
  try {
    const { stdout } = await run(
      win32 ? "powershell.exe" : "/usr/bin/python3",
      win32
        ? ["-NoLogo", "-NoProfile", "-NonInteractive", "-MTA", "-File", driver, ...args]
        : [driver, ...args],
      {
        timeout,
        signal,
        env: {
          ...process.env,
          BOOK_PROPS_MIGRATION: process.argv.includes("--migrate") ? "1" : "0",
        },
      },
    );
    if (stdout) process.stdout.write(`${operation}: ${stdout}`);
  } catch (error) {
    throw new Error(`${operation}: ${error.stdout}\n${error.stderr}`, { cause: error });
  }
}
