import assert from "node:assert/strict";
import { basename, isAbsolute, join } from "node:path";
import { browserDialog } from "./native-chrome.mjs";
import { field, selectFolder } from "./obsidian.mjs";
import { timeout } from "./wait.mjs";

const directory = ".book-props-connection-directory";
export const paired = "ペアリング済みです。";
export const unavailable = "接続を確認できません。Obsidian を開いてください。";

export async function text(page, selector, expected) {
  try {
    await page.waitForFunction(
      (s, label) => document.querySelector(s)?.textContent === label,
      { timeout, polling: "mutation" },
      selector,
      expected,
    );
  } catch (error) {
    const shown = await page.$eval(selector, (item) => item.textContent).catch(() => undefined);
    throw new Error(`Expected ${selector} to show "${expected}"; found "${shown}"`, {
      cause: error,
    });
  }
}

/** v0.4.0 までの設定画面での接続設定 */
export const legacyConnection = {
  button: "接続設定を適用",
  notice: "接続設定を適用しました。",
};
const connection = { button: "接続を始める", notice: "Chrome からの接続を受け付けています。" };

export async function configureLegacy(settings, id) {
  await selectFolder(settings, "Books");
  await field(settings, "Chrome拡張ID", id);
}

export async function applyConnection(settings, evidence, labels = connection) {
  await settings.bringToFront();
  const button = await settings.waitForSelector(`button::-p-text(${labels.button})`, { timeout });
  try {
    await button.press("Enter");
    const applied = await settings.waitForFunction(
      (previous) => {
        if (previous.isConnected) return false;
        return Array.from(document.querySelectorAll(".notice")).at(-1)?.textContent;
      },
      { timeout },
      button,
    );
    try {
      assert.equal(await applied.jsonValue(), labels.notice);
    } finally {
      await applied.dispose();
    }
  } catch (error) {
    const notices = await settings.$$eval(".notice", (items) =>
      items.map((item) => item.textContent),
    );
    await settings.screenshot({ path: evidence });
    throw new Error(`Obsidian did not apply connection settings: ${notices.join(" / ")}`, {
      cause: error,
    });
  } finally {
    await button.dispose();
  }
}

export async function pairWith(settings, options, chrome, evidence) {
  const path = await settings.$eval(
    ".vertical-tab-content",
    (section, selector) => section.querySelector(selector)?.textContent.trim(),
    directory,
  );
  assert(path, "Obsidian did not open the configured endpoint (no connection directory)");
  assert(isAbsolute(path));
  const success = "ペアリングしました。商品ページを開くと所持を確認します。";
  const approval = new AbortController();
  try {
    await options.bringToFront();
    await options.locator("#pair").click();
    await browserDialog(chrome, "folder", path);
    const completed = options
      .waitForFunction(
        () =>
          !document.querySelector("#pair").disabled &&
          document.querySelector("#status").textContent,
        { timeout },
      )
      .then(async (notice) => {
        try {
          assert.equal(await notice.jsonValue(), success);
        } finally {
          await notice.dispose();
        }
      });
    await Promise.race([
      completed,
      browserDialog(chrome, "folder-permission", basename(path), approval.signal).then(
        () => completed,
      ),
    ]);
  } catch (error) {
    const status = await options.$eval("#status", (item) => item.textContent);
    await options.screenshot({ path: join(evidence, "pairing-failure.png") });
    throw new Error(`Chrome pairing did not complete: ${status}`, { cause: error });
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
