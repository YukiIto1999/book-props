import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import ObsidianLauncher from "obsidian-launcher";
import puppeteer from "puppeteer-core";
import { openSettings } from "./activate-obsidian.mjs";
import { timeout, until } from "./wait.mjs";

const version = "1.15.1";
const windows = process.platform === "win32";

export class ObsidianFixture {
  constructor({ root, vault, bundle, port = 9223 }) {
    this.vault = vault;
    this.bundle = bundle;
    this.port = port;
    this.launcher = new ObsidianLauncher({
      cacheDir: join(root, "obsidian-cache"),
      interactive: false,
    });
  }

  async stage() {
    const destination = join(this.vault, ".obsidian", "plugins", "book-props");
    await mkdir(dirname(destination), { recursive: true });
    await cp(this.bundle, destination, { recursive: true });
  }

  async start() {
    if (!this.config) {
      const launched = await this.launcher.launch({
        appVersion: version,
        installerVersion: version,
        vault: this.vault,
        localStorage: { "enable-plugin-$vaultId": "false" },
        args: [`--remote-debugging-port=${this.port}`],
        spawnOptions: { detached: false, stdio: "ignore" },
      });
      this.proc = launched.proc;
      this.config = launched.configDir;
    } else {
      const executable = await this.launcher.downloadInstaller(version);
      this.proc = spawn(
        executable,
        [
          `--user-data-dir=${this.config}`,
          `--remote-debugging-port=${this.port}`,
          ...(windows ? [] : ["--no-sandbox"]),
        ],
        { stdio: "ignore" },
      );
    }
    let launchError;
    this.proc.once("error", (error) => {
      launchError = error;
    });
    const browserURL = `http://127.0.0.1:${this.port}`;
    await until(
      "Obsidian DevTools",
      () => {
        if (launchError) throw launchError;
        if (this.proc.exitCode !== null) throw Error(`Obsidian exited: ${this.proc.exitCode}`);
        return fetch(`${browserURL}/json/version`, { signal: AbortSignal.timeout(1000) }).then(
          (reply) => reply.ok,
          () => false,
        );
      },
      120_000,
    );
    this.electron = await puppeteer.connect({
      browserURL,
      defaultViewport: null,
      protocolTimeout: timeout,
    });
    process.stdout.write(`Obsidian ${version}: ${await this.electron.version()}\n`);
  }

  async stop() {
    const { proc, electron } = this;
    const stopping = proc?.pid && proc.exitCode === null && proc.signalCode === null;
    const exited = stopping ? once(proc, "exit") : undefined;
    await electron?.close().catch(() => undefined);
    this.electron = undefined;
    if (
      exited &&
      !(await Promise.race([exited.then(() => true), delay(3000, false, { ref: false })]))
    ) {
      if (windows)
        await promisify(execFile)("taskkill.exe", ["/pid", String(proc.pid), "/t", "/f"]);
      else proc.kill();
      await exited;
    }
  }

  async close() {
    await this.stop();
    if (this.config) await rm(this.config, { recursive: true, force: true, maxRetries: 4 });
  }

  async settings() {
    const { settings: page } = await openSettings(await this.vaultPage());
    await page.locator('.vertical-tab-nav-item[data-setting-id="book-props"]').click();
    return page;
  }

  async vaultPage() {
    return until("Obsidian Vault", async () => {
      for (const page of await this.electron.pages())
        if (page.url().startsWith("app://obsidian.md/") && (await page.$(".workspace")))
          return page;
      return false;
    });
  }
}

export async function field(page, name, value) {
  const handle = await page.waitForFunction(
    (label) =>
      [...document.querySelectorAll(".setting-item")]
        .find((row) => row.querySelector(".setting-item-name")?.textContent === label)
        ?.querySelector("input"),
    { timeout },
    name,
  );
  const input = handle.asElement();
  assert(input, `Missing setting: ${name}`);
  await page.bringToFront();
  await input.focus();
  const selected = await input.evaluate((element) => {
    element.select();
    return element.selectionStart === 0 && element.selectionEnd === element.value.length;
  });
  assert(selected, `Could not select the existing text: ${name}`);
  await page.keyboard.type(value);
  assert.equal(await input.evaluate((element) => element.value), value, `Setting input: ${name}`);
  return input;
}

export async function selectFolder(page, name) {
  const input = await field(page, "書籍フォルダ", name);
  const row = await input.evaluateHandle((element) => element.closest(".setting-item"));
  const button = await row.asElement()?.$("button");
  assert(button, "Missing book folder Apply button");
  // Settings rows are not redrawn after 適用, so the new notice is the only completion signal.
  await page.$$eval(".notice", (items) => {
    for (const item of items) item.setAttribute("data-acceptance-seen", "");
  });
  await button.press("Enter");
  const applied = await page.waitForFunction(
    (outcomes) =>
      [...document.querySelectorAll(".notice:not([data-acceptance-seen])")]
        .map((item) => item.textContent)
        .find((text) => outcomes.includes(text)),
    { timeout },
    ["書籍フォルダを設定しました。", "Vault内の既存フォルダを指定してください。"],
  );
  assert.equal(
    await applied.jsonValue(),
    "書籍フォルダを設定しました。",
    `Book folder was not applied: ${name}`,
  );
  await applied.dispose();
  await button.dispose();
  await row.dispose();
  await input.dispose();
}
