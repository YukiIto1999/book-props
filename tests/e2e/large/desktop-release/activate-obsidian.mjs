import assert from "node:assert/strict";
import { timeout, until } from "./wait.mjs";

// Every selector below is a class or attribute that Obsidian 1.15.1 app.js renders,
// so the flow does not depend on the interface language.
const settingsModal = ".modal.mod-settings";
const settingsHeader = `${settingsModal} .vertical-tab-header`;
const settingsButton = ".workspace-drawer-vault-actions .clickable-icon:has(svg.lucide-settings)";
const trustButton = ".modal.mod-trust-folder .modal-button-container button:not(.mod-cancel)";
const communityTab = `${settingsModal} .vertical-tab-nav-item[data-setting-id="community-plugins"]`;
const tabContent = `${settingsModal} .vertical-tab-content`;
const restrictedButton = `${tabContent} button.mod-cta`;
const pluginRow = `${tabContent} .setting-item[data-plugin-id="book-props"]`;
const pluginTab = `${settingsModal} .vertical-tab-nav-item[data-setting-id="book-props"]`;

/** Toggle of the Book Props row; re-queried on every use because the list re-renders. */
const pluginToggleSelector = `${pluginRow} .setting-item-control .checkbox-container`;

function pluginToggle(settings) {
  return settings.locator(pluginToggleSelector);
}

async function readToggle(handle) {
  return handle.evaluate((toggle) => ({
    enabled: toggle.classList.contains("is-enabled"),
    disabled: toggle.classList.contains("is-disabled"),
  }));
}

async function settingsPage(browser) {
  for (const page of await browser.pages()) {
    const url = page.url();
    if (url !== "about:blank" && !url.startsWith("app://obsidian.md/")) continue;
    const header = await page.$(settingsHeader);
    if (!header) continue;
    await header.dispose();
    return page;
  }
  return false;
}

// The trust prompt is opened while community plugins initialize, which Obsidian
// awaits before it lays out the first workspace leaf. The startup snapshot overlay
// sits above the workspace but below dialogs, so only a click on the workspace waits for it.
async function startupPrompt(page) {
  const observed = await page.waitForFunction(
    (trust) => {
      if (document.querySelector(trust)) return "trust-dialog";
      const ready =
        document.querySelector(".workspace-leaf") && !document.getElementById("startup-snapshot");
      return ready && "none";
    },
    { timeout },
    trustButton,
  );
  const prompt = await observed.jsonValue();
  await observed.dispose();
  return prompt;
}

export async function openSettings(page) {
  const browser = page.browser();
  await page.bringToFront();
  const prompt = await startupPrompt(page);
  if (prompt === "trust-dialog") await page.locator(trustButton).click();
  else if (!(await settingsPage(browser))) await page.locator(settingsButton).click();
  const settings = await until("visible Obsidian settings", () => settingsPage(browser));
  await settings.bringToFront();
  return { settings, prompt };
}

async function showInstalledPlugin(settings) {
  await settings.locator(communityTab).click();
  await settings.locator(`${communityTab}.is-active`).wait();
  const observed = await settings.waitForFunction(
    (row, restricted) =>
      document.querySelector(row) ? "listed" : document.querySelector(restricted) && "restricted",
    { timeout },
    pluginRow,
    restrictedButton,
  );
  const state = await observed.jsonValue();
  await observed.dispose();
  if (state === "restricted") {
    await settings.locator(restrictedButton).click();
    await settings.locator(pluginRow).wait();
  }
  return state === "restricted";
}

/** Asserts the Book Props toggle is rendered as on and its settings tab is loaded. */
async function assertPluginEnabled(settings) {
  await settings.locator(pluginTab).wait();
  const handle = await pluginToggle(settings)
    .filter((toggle) => toggle.classList.contains("is-enabled"))
    .waitHandle();
  const state = await readToggle(handle);
  await handle.dispose();
  assert.deepEqual(state, { enabled: true, disabled: false }, "Book Props toggle is not on");
}

/**
 * Enables the staged Book Props plugin through the visible settings UI of an open Vault.
 * Returns the settings page and which safety step, if any, the run had to pass.
 */
export async function activatePlugin(page) {
  const { settings, prompt } = await openSettings(page);
  const restricted = await showInstalledPlugin(settings);
  const initial = await pluginToggle(settings).waitHandle();
  const before = await readToggle(initial);
  await initial.dispose();
  assert.deepEqual(
    before,
    { enabled: false, disabled: false },
    "Book Props must start disabled with an operable toggle",
  );
  assert.equal(await settings.$(pluginTab), null, "Book Props settings tab exists before enabling");
  await pluginToggle(settings).click();
  await assertPluginEnabled(settings);
  if (prompt === "trust-dialog") return { settings, safety: prompt };
  return { settings, safety: restricted ? "restricted-mode" : "none" };
}
