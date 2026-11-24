import assert from "node:assert/strict";
import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { timeout, until } from "./wait.mjs";

const manager = "extensions-manager";
const detail = `${manager} >>> extensions-detail-view`;
const checking = "接続を確認しています…";
const script = (id) => `chrome-extension://${id}/worker.js`;
const card = (id) => `${manager} >>> extensions-item#${id}`;

function text(page, selector, expected) {
  return page
    .locator(selector)
    .setTimeout(timeout)
    .filter((element, want) => element.textContent.trim() === want, expected)
    .wait();
}

function nextWorker(chrome, id, previous) {
  return chrome.waitForTarget(
    (item) => item !== previous && item.type() === "service_worker" && item.url() === script(id),
    { timeout },
  );
}

function destroyed(chrome, target) {
  const gone = Promise.withResolvers();
  const listener = (item) => item === target && gone.resolve();
  chrome.on("targetdestroyed", listener);
  return Promise.race([
    gone.promise,
    delay(timeout, undefined, { ref: false }).then(() => {
      throw Error("The previous Book Props worker target was not destroyed");
    }),
  ]).finally(() => chrome.off("targetdestroyed", listener));
}

async function extensionsPage(chrome) {
  const page = await chrome.newPage();
  await page.goto("chrome://extensions/");
  await page.bringToFront();
  const toggle = page.locator(`${manager} >>> extensions-toolbar >>> #devMode`).setTimeout(timeout);
  if (!(await toggle.map((element) => element.checked).wait())) await toggle.click();
  await toggle.filter((element) => element.checked).wait();
  return page;
}

// Starts the worker only through Chrome's ServiceWorker domain and reports its version state.
async function runningWorker(chrome, page, id) {
  const cdp = await page.createCDPSession();
  const versions = new Map();
  cdp.on("ServiceWorker.workerVersionUpdated", ({ versions: updated }) => {
    for (const version of updated)
      if (version.scriptURL === script(id)) versions.set(version.versionId, version);
  });
  await cdp.send("ServiceWorker.enable");
  const running = () =>
    [...versions.values()].find(
      (version) => version.status === "activated" && version.runningStatus === "running",
    );
  await until("Book Props worker registration", () => versions.size > 0);
  if (!running())
    await cdp.send("ServiceWorker.startWorker", { scopeURL: `chrome-extension://${id}/` });
  const { versionId } = await until("Book Props worker running", running);
  const target =
    chrome
      .targets()
      .find((item) => item.type() === "service_worker" && item.url() === script(id)) ??
    (await nextWorker(chrome, id));
  const state = () => versions.get(versionId);
  return { cdp, versionId, target, state };
}

/**
 * Installs the unpacked folder for a new profile and proves the result on chrome://extensions.
 * Proof boundary: Chrome's "Load unpacked" opens a browser-owned folder dialog that Puppeteer's
 * file chooser cannot intercept, so only the folder submission uses CDP Extensions.loadUnpacked.
 * Developer mode, the card and the details page are the real WebUI.
 */
export async function installChrome(chrome, extensionDirectory) {
  const page = await extensionsPage(chrome);
  await page
    .locator(`${manager} >>> extensions-toolbar >>> #loadUnpacked`)
    .setTimeout(timeout)
    .setVisibility("visible")
    .filter((button) => button.textContent.trim() === "Load unpacked")
    .wait();
  const id = await chrome.installExtension(extensionDirectory);
  assert.match(id, /^[a-p]{32}$/);
  await text(page, `${card(id)} >>> #name`, "Book Props");
  await text(page, `${card(id)} >>> #extension-id`, `ID: ${id}`);
  await page
    .locator(`${card(id)} >>> #enableToggle`)
    .setTimeout(timeout)
    .filter((toggle) => toggle.checked)
    .wait();
  await page
    .locator(`${card(id)} >>> #detailsButton`)
    .setTimeout(timeout)
    .click();
  await text(page, `${detail} >>> #id-section .section-content`, id);
  await text(page, `${detail} >>> #source`, "Unpacked extension");
  const shown = await page
    .locator(`${detail} >>> #load-path a`)
    .setTimeout(timeout)
    .map((link) => link.textContent.trim())
    .wait();
  const loaded = shown.startsWith("~") ? join(homedir(), shown.slice(1)) : shown;
  assert.equal(await realpath(loaded), await realpath(extensionDirectory));
  await page.close();
  return id;
}

/** Presses the card's Reload button, as the update procedure does, and returns the new worker. */
export async function reloadExtension(chrome, extensionId) {
  const page = await extensionsPage(chrome);
  const worker = await runningWorker(chrome, page, extensionId);
  const gone = destroyed(chrome, worker.target);
  const next = nextWorker(chrome, extensionId, worker.target);
  await page
    .locator(`${card(extensionId)} >>> #dev-reload-button`)
    .setTimeout(timeout)
    .click();
  await until(
    "Previous Book Props worker stopped",
    () => worker.state().runningStatus === "stopped",
  );
  await gone;
  const target = await next;
  await text(page, `${card(extensionId)} >>> #extension-id`, `ID: ${extensionId}`);
  await worker.cdp.detach();
  await page.close();
  return target;
}

/** Stops only Book Props' worker, reloads the options page and returns the woken worker. */
export async function restartWorker(chrome, options, extensionId) {
  const worker = await runningWorker(chrome, options, extensionId);
  const gone = destroyed(chrome, worker.target);
  await worker.cdp.send("ServiceWorker.stopWorker", { versionId: worker.versionId });
  await until("Book Props worker stopped", () => worker.state().runningStatus === "stopped");
  await gone;
  const next = nextWorker(chrome, extensionId, worker.target);
  await options.bringToFront();
  await options.reload();
  const target = await next;
  await until("Book Props worker woke", () => worker.state().runningStatus === "running");
  const status = await options
    .locator("#status")
    .setTimeout(timeout)
    .filter((element, label) => ![label, ""].includes(element.textContent), checking)
    .map((element) => element.textContent)
    .wait();
  await worker.cdp.detach();
  return { target, status };
}
