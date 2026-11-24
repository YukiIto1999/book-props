import assert from "node:assert/strict";
import { field, selectFolder } from "./obsidian.mjs";
import { timeout } from "./wait.mjs";

const pairingField = "#pairing";
const submit = "button[type=submit]";
const pairingError =
  "ペアリングできません。Obsidian を開き、新しいペアリング情報を発行してください。";

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

export async function pasteNewCode(settings, options) {
  await settings.bringToFront();
  await settings.locator("button::-p-text(ペアリング情報を発行)").click();
  await settings.locator("button::-p-text(ペアリング情報をコピー)").click();
  const copied = await settings.waitForFunction(
    () =>
      [...document.querySelectorAll(".notice")].some(
        (el) => el.textContent === "ペアリング情報をコピーしました。",
      ),
    { timeout },
  );
  await copied.dispose();
  await options.bringToFront();
  await options.locator(pairingField).fill("");
  await options.focus(pairingField);
  await options.keyboard.down("Control");
  try {
    await options.keyboard.press("v");
  } finally {
    await options.keyboard.up("Control");
  }
  await options.waitForFunction(() => document.querySelector("#pairing")?.value, { timeout });
  const code = await options.$eval(pairingField, (input) => input.value);
  assert(code);
  return code;
}

async function submitPairing(options, accept = true) {
  await options.bringToFront();
  await options.locator(submit).click();
  await options.waitForFunction(
    () => {
      const button = document.querySelector("button[type=submit]");
      return button && !button.disabled && document.querySelector("#pairing")?.value === "";
    },
    { timeout },
  );
  await text(options, "#status", accept ? "ペアリングしました。" : pairingError);
}

export async function retryCode(options, code) {
  await options.bringToFront();
  await options.locator(pairingField).fill(code);
  await submitPairing(options, false);
}

export async function pairWith(settings, options) {
  const code = await pasteNewCode(settings, options);
  await submitPairing(options);
  return code;
}
