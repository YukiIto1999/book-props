import assert from "node:assert/strict";
import { cp, mkdir, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import puppeteer from "puppeteer-core";
import { activatePlugin } from "./activate-obsidian.mjs";
import { checkRestart, checkVaultIsolation } from "./check-pairing.mjs";
import { installChrome, reloadExtension } from "./install-chrome.mjs";
import { pairLegacy } from "./legacy-pairing.mjs";
import { ObsidianFixture, selectFolder } from "./obsidian.mjs";
import { configure, pairWith, text } from "./pair-evidence.mjs";
import { timeout, until } from "./wait.mjs";

const migration = process.argv.includes("--migrate");
const windows = process.platform === "win32";
if (migration && !windows)
  throw Error("The v0.1.0 migration uses a disposable Windows Chrome profile");
const root = join(
  process.env.RUNNER_TEMP,
  migration ? "book-props-migration" : "book-props-desktop",
);
const bundle = join(root, "bundle");
const active = join(root, "active");
const evidence = join(root, "evidence");
const vault = join(root, "vault");
const books = join(vault, "Books");
const other = join(vault, "Other Books");
const plugin = join(vault, ".obsidian", "plugins", "book-props");
const extensionDirectory = join(active, "chrome");
const title = "Book Props acceptance fixture";
const isbn = "9784873115658";
const productUrl = "https://books.rakuten.co.jp/rb/11753651/";
const obsidian = new ObsidianFixture({ root, vault, bundle: join(active, "obsidian") });

async function notes(folder) {
  return (await readdir(folder)).filter((name) => name.endsWith(".md"));
}

let chrome;
let target;
let extensionId;
let options;
let prefix;
async function startChrome() {
  const browser = windows ? "chrome-win64/chrome.exe" : "chrome-linux64/chrome";
  chrome = await puppeteer.launch({
    executablePath: join(process.env.RUNNER_TEMP, "book-props-desktop", browser),
    headless: false,
    enableExtensions: true,
    userDataDir: join(root, "chrome-profile"),
    defaultViewport: null,
    args: ["--lang=en-US", "--force-renderer-accessibility"],
  });
  extensionId ??= await installChrome(chrome, extensionDirectory);
  prefix = `chrome-extension://${extensionId}/`;
  await openOptions();
  process.stdout.write(`${await chrome.version()}\n`);
}

async function openOptions() {
  await options?.close();
  options = await chrome.newPage();
  await options.goto(`${prefix}options.html`);
  await text(options, "#extension-id", extensionId);
  target = await chrome.waitForTarget(
    (item) => item.type() === "service_worker" && item.url() === `${prefix}worker.js`,
    { timeout },
  );
}

async function productPage() {
  const page = await chrome.newPage();
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    if (!request.isNavigationRequest() || request.url() !== productUrl) return void request.abort();
    return void request.respond({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: `<!doctype html><h1 itemprop="name">${title} <span class="authorLink"><a>Test Author</a></span></h1><ul><li class="productInfo"><span class="category">ISBN</span><span class="categoryValue">${isbn}</span></li></ul>`,
    });
  });
  await page.goto(productUrl);
  return page;
}

async function popup(product) {
  await product.bringToFront();
  const worker = await (
    await chrome.waitForTarget(
      (item) => item.type() === "service_worker" && item.url() === `${prefix}worker.js`,
      { timeout },
    )
  ).worker();
  await worker.evaluate("chrome.action.openPopup()");
  return (
    await chrome.waitForTarget((item) => item.url() === `${prefix}popup.html`, { timeout })
  ).asPage();
}

async function dropPurchaseReply(origin) {
  const client = await target.createCDPSession();
  await client.send("Fetch.enable", { patterns: [{ urlPattern: `${origin}/book-props/v1` }] });
  const dropped = Promise.withResolvers();
  let purchaseId;
  client.on("Fetch.requestPaused", ({ requestId, request, responseStatusCode }) => {
    if (responseStatusCode !== undefined) {
      if (responseStatusCode !== 200) {
        dropped.reject(Error(`The old plugin returned HTTP ${responseStatusCode}`));
        return;
      }
      void client
        .send("Fetch.failRequest", { requestId, errorReason: "ConnectionClosed" })
        .then(() => dropped.resolve(purchaseId), dropped.reject);
      return;
    }
    const body = request.postData && JSON.parse(request.postData);
    const purchase = body?.action === "purchase";
    if (purchase) purchaseId = body.purchase.requestId;
    void client
      .send("Fetch.continueRequest", { requestId, interceptResponse: purchase })
      .catch(dropped.reject);
  });
  return {
    receipt: () =>
      Promise.race([
        dropped.promise,
        delay(timeout, undefined, { ref: false }).then(() => {
          throw Error("The old purchase response was not intercepted");
        }),
      ]),
    detach: () => client.detach(),
  };
}

await mkdir(evidence, { recursive: true });
await mkdir(books, { recursive: true });
await mkdir(other);
await cp(migration ? join(root, "legacy") : bundle, active, { recursive: true });
try {
  await obsidian.stage();
  await obsidian.start();
  const { safety } = await activatePlugin(await obsidian.vaultPage());
  assert.notEqual(
    safety,
    "none",
    "The acceptance Vault must not grant plugin permissions in advance",
  );
  process.stdout.write(`Obsidian enabled Book Props through Community plugins (${safety})\n`);
  await startChrome();
  const settings = await obsidian.settings();
  await configure(settings, extensionId);
  const legacyOrigin = migration
    ? await pairLegacy({ settings, options, chrome, root, timeout })
    : undefined;
  if (!migration)
    await checkRestart({ obsidian, settings, chrome, options, extensionId, evidence });

  let page = await productPage();
  const wish = await popup(page);
  await text(wish, "#status", "未所有");
  await wish.locator("#wish").click();
  await text(wish, "#status", "Vaultに保存しました。");
  const names = await notes(books);
  assert.equal(names.length, 1);
  const file = join(books, names[0]);
  const wished = await readFile(file, "utf8");
  assert.match(wished, /^book-wanted: true$/m);
  assert.match(wished, /^  editions: \[\]$/m);
  await wish.close();
  await page.reload();
  const purchase = await popup(page);
  await text(purchase, "#status", "欲しいに登録済み");
  const lost = legacyOrigin ? await dropPurchaseReply(legacyOrigin) : undefined;
  await purchase.locator("#purchase").click();
  const originalPurchaseId = await lost?.receipt();
  if (!migration) await text(purchase, "#status", "Vaultに保存しました。");
  const saved = await until("one purchased edition on disk", async () => {
    const markdown = await readFile(file, "utf8");
    return /^\s+owned: true$/m.test(markdown) ? markdown : false;
  });
  assert.deepEqual(await notes(books), names);
  assert.match(saved, /^book-wanted: false$/m);
  assert(saved.includes(isbn));
  if (migration) {
    assert.equal(typeof originalPurchaseId, "string");
    assert(
      saved.includes(originalPurchaseId),
      "The on-disk receipt must identify the interrupted purchase",
    );
    await text(
      purchase,
      "#status",
      "保存結果は不明です。新たに登録せず、同じ購入の結果を再確認してください。",
    );
    await purchase.screenshot({ path: join(evidence, "01-legacy-purchase-unconfirmed.png") });
    await purchase.close();
    await lost.detach();
    await options.close();
    options = undefined;
    await obsidian.stop();
    await cp(join(bundle, "chrome"), extensionDirectory, { recursive: true });
    await cp(join(bundle, "obsidian"), plugin, { recursive: true });
    await obsidian.start();
    const { version } = JSON.parse(await readFile(join(bundle, "chrome", "manifest.json"), "utf8"));
    await reloadExtension(chrome, extensionId, version);
    await openOptions();
    const updated = await obsidian.settings();
    await selectFolder(updated, "Other Books");
    await pairWith(updated, options);
    page = await productPage();
    const wrongFolder = await popup(page);
    await wrongFolder.locator("#reconcile").click();
    await text(
      wrongFolder,
      "#status",
      "この保留は、いまペアリングしている先とは別のVaultまたは書籍フォルダで購入したものです。購入時の書籍フォルダでペアリングし直して再確認するか、そのVaultで記録を確認してから保留を解除してください。",
    );
    assert.deepEqual(await notes(other), []);
    assert.equal(await readFile(file, "utf8"), saved);
    await wrongFolder.close();
    await updated.bringToFront();
    await selectFolder(updated, "Books");
    await pairWith(updated, options);
    const recheck = await popup(page);
    await recheck.locator("#reconcile").click();
    await text(recheck, "#status", "Vaultへの保存を確認しました。");
    await recheck.screenshot({ path: join(evidence, "02-upgraded-purchase-confirmed.png") });
    await recheck.close();
    assert.equal(await readFile(file, "utf8"), saved);
    process.stdout.write(
      "Updated the immutable v0.1.0 release in place; only the original book folder resolved the committed purchase\n",
    );
  } else await purchase.close();
  await page.reload();
  const owned = await popup(page);
  await text(owned, "#status", "この版を所持");
  await owned.screenshot({ path: join(evidence, "03-owned-reopened.png") });
  await owned.close();
  if (!migration)
    await checkVaultIsolation({
      root,
      bundle: join(bundle, "obsidian"),
      obsidian,
      options,
      extensionId,
      page,
      popup,
      notes,
      evidence,
    });
  process.stdout.write(
    "The actual popup saved the wish and purchase in one Vault note and reopened with the owned edition\n",
  );
} finally {
  await chrome?.close();
  await obsidian.close();
}
