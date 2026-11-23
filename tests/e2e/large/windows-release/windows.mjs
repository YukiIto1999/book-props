import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import ObsidianLauncher from "obsidian-launcher";
import puppeteer from "puppeteer-core";

const root = join(process.env.RUNNER_TEMP, "book-props-windows-acceptance");
const evidence = join(root, "evidence");
const bundle = join(root, "bundle");
const vault = join(root, "vault");
const books = join(vault, "Books");
const run = promisify(execFile);
const devtools = "http://127.0.0.1:9223";
const timeout = 20_000;
const title = "Windows acceptance fixture";
const isbn = "9784873115658";
const productUrl = "https://books.rakuten.co.jp/rb/11753651/";

async function until(name, read, limit = timeout) {
  const deadline = Date.now() + limit;
  do {
    const value = await read();
    if (value) return value;
    await delay(200);
  } while (Date.now() < deadline);
  throw new Error(`Timed out: ${name}`);
}

async function text(page, selector, expected) {
  await page.waitForFunction(
    (s, label) => document.querySelector(s)?.textContent === label,
    { timeout },
    selector,
    expected,
  );
}

function report(message) {
  process.stdout.write(`${message}\n`);
}

await mkdir(evidence, { recursive: true });
await mkdir(books, { recursive: true });
const launcher = new ObsidianLauncher({
  cacheDir: join(root, "obsidian-cache"),
  interactive: false,
});
const { proc: obsidian } = await launcher.launch({
  appVersion: "1.15.1",
  installerVersion: "1.15.1",
  vault,
  plugins: [join(bundle, "obsidian")],
  args: ["--remote-debugging-port=9223"],
  spawnOptions: { detached: false, stdio: "ignore" },
});
let launchError;
obsidian.once("error", (error) => {
  launchError = error;
});
let electron;
let chrome;
try {
  await until(
    "Obsidian DevTools",
    async () => {
      if (launchError) throw launchError;
      if (obsidian.exitCode !== null)
        throw new Error(`Obsidian launcher exited: ${obsidian.exitCode}`);
      return fetch(`${devtools}/json/version`, { signal: AbortSignal.timeout(1_000) }).then(
        (r) => r.ok,
        () => false,
      );
    },
    300_000,
  );
  electron = await puppeteer.connect({
    browserURL: devtools,
    defaultViewport: null,
    protocolTimeout: 20_000,
  });
  const desktop = await until("Obsidian vault window", async () => {
    const page = (await electron.pages()).find((p) => p.url().startsWith("app://obsidian.md/"));
    return page && (await page.$(".workspace")) ? page : false;
  });
  desktop.setDefaultTimeout(timeout);

  chrome = await puppeteer.launch({
    executablePath: join(root, "chrome-win64", "chrome.exe"),
    headless: false,
    dumpio: true,
    enableExtensions: true,
    userDataDir: join(root, "chrome-profile"),
    defaultViewport: null,
    args: [
      "--lang=en-US",
      "--force-renderer-accessibility",
      `--load-extension=${join(bundle, "chrome")}`,
    ],
  });
  const extensionTarget = await chrome.waitForTarget(
    (target) =>
      target.type() === "service_worker" &&
      /^chrome-extension:\/\/[a-p]{32}\/worker\.js$/.test(target.url()),
    { timeout },
  );
  const extensionId = new URL(extensionTarget.url()).hostname;
  const prefix = `chrome-extension://${extensionId}/`;
  const options = await chrome.newPage();
  await options.goto(`${prefix}options.html`);
  await text(options, "#extension-id", extensionId);

  await desktop.bringToFront();
  await desktop
    .locator(".workspace-drawer-vault-actions .clickable-icon:has(svg.lucide-settings)")
    .click();
  const settings = await until("visible Obsidian settings", async () => {
    for (const page of await electron.pages()) {
      const url = page.url();
      if (url !== "about:blank" && !url.startsWith("app://obsidian.md/")) continue;
      const visible = await page.evaluate(() => {
        const modal = document.querySelector(".modal.mod-settings .vertical-tab-header");
        return (modal?.getClientRects().length ?? 0) > 0;
      });
      if (visible) return page;
    }
    return false;
  });
  settings.setDefaultTimeout(timeout);
  await settings.locator('.vertical-tab-nav-item[data-setting-id="book-props"]').click();
  const field = async (label, value) => {
    const field = await settings.waitForFunction(
      (name) =>
        [...document.querySelectorAll(".setting-item")]
          .find((setting) => setting.querySelector(".setting-item-name")?.textContent === name)
          ?.querySelector("input"),
      { timeout },
      label,
    );
    const input = field.asElement();
    assert(input, `Missing setting: ${label}`);
    await input.click({ clickCount: 3 });
    await input.type(value);
    return input;
  };
  const folderInput = await field("書籍フォルダ", "Books");
  await settings
    .locator("button::-p-text(適用)")
    .filter((element) => element.textContent === "適用")
    .click();
  await settings.waitForFunction((input) => !input.isConnected, { timeout }, folderInput);
  await field("Chrome拡張ID", extensionId);
  await settings.locator("button::-p-text(接続設定を適用)").click();
  const address = await settings.waitForFunction(
    () =>
      [...document.querySelectorAll(".vertical-tab-content p")]
        .map((p) => p.textContent)
        .find((value) => /^https:\/\/bp-[0-9a-f]+\.localhost:\d+ · SHA-256 /.test(value)),
    { timeout },
  );
  const [origin, fingerprint] = (await address.jsonValue()).split(" · SHA-256 ");
  const dpapi = await readdir(join(process.env.LOCALAPPDATA, "BookProps"));
  assert.equal(
    dpapi.filter((name) => /^[0-9a-f]{48}\.dpapi$/.test(name)).length,
    1,
    "Expected one protected identity in this VM",
  );
  await settings.screenshot({ path: join(evidence, "01-obsidian-listening.png") });
  report("The plugin started real TLS and created a Windows DPAPI identity");

  const certificate = join(root, "book-props-localhost.crt");
  const cdp = await settings.createCDPSession();
  await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: root });
  await settings.locator("button::-p-text(証明書を保存)").click();
  const certificateBytes = await until("exported leaf certificate", () =>
    readFile(certificate).catch((error) => {
      if (error.code !== "ENOENT") throw error;
      return false;
    }),
  );
  const leaf = new X509Certificate(certificateBytes);
  assert.equal(leaf.ca, false);
  assert.equal(leaf.fingerprint256, fingerprint.toUpperCase());
  assert.equal(leaf.checkHost(new URL(origin).hostname), new URL(origin).hostname);

  const certPage = await chrome.newPage();
  await assert.rejects(certPage.goto(origin), /ERR_CERT_AUTHORITY_INVALID/);
  report("Chrome rejected the endpoint before profile trust was configured");
  await certPage.goto("chrome://certificate-manager/localcerts/usercerts");
  await certPage.bringToFront();
  const dialog = (operation, value) =>
    run(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-MTA",
        "-File",
        fileURLToPath(new URL("./chrome-dialog.ps1", import.meta.url)),
        String(chrome.process().pid),
        operation,
        value,
      ],
      { timeout },
    );
  await certPage
    .locator(
      "certificate-manager >>> #userCertsSection >>> certificate-list:first-of-type >>> #importCert",
    )
    .filter((element) => !element.hidden && element.getClientRects().length > 0)
    .click();
  const picker = await dialog("certificate", certificate);
  report(picker.stdout.trim());
  const trustedHash = fingerprint.replaceAll(":", "").toLowerCase();
  await certPage
    .locator(
      "certificate-manager >>> #userCertsSection >>> certificate-list:first-of-type >>> certificate-entry",
    )
    .filter((entry, hash) => entry.sha256hashHex?.toLowerCase() === hash, trustedHash)
    .wait();
  await certPage.goto(origin);
  report("Chrome connected after importing only the verified leaf through its certificate manager");

  await settings.bringToFront();
  await settings.locator("button::-p-text(コードを発行)").click();
  const code = await settings.waitForFunction(
    () =>
      [...document.querySelectorAll(".vertical-tab-content [role=status]")]
        .map((element) => element.textContent)
        .find((value) => /^[A-Za-z0-9_-]{22}$/.test(value)),
    { timeout },
  );
  await options.bringToFront();
  await options.locator("#origin").fill(origin);
  await options.locator("#code").fill(await code.jsonValue());
  await options.click("button[type=submit]");
  await dialog("permission", new URL(origin).hostname);
  await text(options, "#status", "ペアリングしました。");
  await options.screenshot({ path: join(evidence, "02-paired.png") });
  report("The packaged extension paired through its options page");

  const product = await chrome.newPage();
  await product.setRequestInterception(true);
  product.on("request", (request) => {
    if (!request.isNavigationRequest() || request.url() !== productUrl) return void request.abort();
    return void request.respond({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: `<!doctype html><h1 itemprop="name">${title} <span class="authorLink"><a>Test Author</a></span></h1><ul><li class="productInfo"><span class="category">ISBN</span><span class="categoryValue">${isbn}</span></li></ul>`,
    });
  });
  await product.goto(productUrl);
  await product.bringToFront();
  const showPopup = async () => {
    const target = await chrome.waitForTarget(
      (item) => item.type() === "service_worker" && item.url() === `${prefix}worker.js`,
      { timeout },
    );
    const worker = await target.worker();
    await worker.evaluate("chrome.action.openPopup()");
    const popup = await chrome.waitForTarget((item) => item.url() === `${prefix}popup.html`, {
      timeout,
    });
    return popup.asPage();
  };
  const popup = await showPopup();
  await text(popup, "#status", "未所有");
  await popup.locator("#wish").click();
  await text(popup, "#status", "Vaultに保存しました。");
  await popup.screenshot({ path: join(evidence, "03-wish-saved.png") });
  const notes = (await readdir(books)).filter((name) => name.endsWith(".md"));
  assert.equal(notes.length, 1);
  const summary = await readFile(join(books, notes[0]), "utf8");
  assert(summary.includes(`book-title: ${title}`), "The wish was not saved for the fixture book");
  assert.match(summary, /^  editions: \[\]$/m, "Saving a wish must not add an edition");
  assert.match(summary, /^book-wanted: true$/m);
  await popup.close();
  await product.reload();
  const reopened = await showPopup();
  await text(reopened, "#status", "欲しいに登録済み");
  await reopened.screenshot({ path: join(evidence, "04-wish-reopened.png") });
  await reopened.locator("#purchase").click();
  await text(reopened, "#status", "Vaultに保存しました。");
  assert.deepEqual(
    (await readdir(books)).filter((name) => name.endsWith(".md")),
    notes,
  );
  const purchased = await readFile(join(books, notes[0]), "utf8");
  assert.match(purchased, /^book-wanted: false$/m);
  assert.match(purchased, /^\s+owned: true$/m);
  assert(purchased.includes(isbn), "The purchased edition lost the fixture ISBN");
  await reopened.close();
  await product.reload();
  const owned = await showPopup();
  await text(owned, "#status", "この版を所持");
  await owned.screenshot({ path: join(evidence, "05-owned-reopened.png") });
  report("The real popup saved a wish and then an owned edition in the same Vault note");
} finally {
  await chrome?.close();
  await electron?.disconnect();
  if (obsidian.pid && obsidian.exitCode === null) {
    await run("taskkill.exe", ["/pid", String(obsidian.pid), "/t", "/f"]).catch(() => undefined);
  }
}
