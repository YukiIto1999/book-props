import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);

async function importLegacyLeaf({ settings, chrome, root, timeout, dialog }) {
  const row = await settings.waitForFunction(
    () =>
      [...document.querySelectorAll(".vertical-tab-content p")]
        .map((p) => p.textContent)
        .find((value) => /^https:\/\/bp-[0-9a-f]+\.localhost:\d+ · SHA-256 /.test(value)),
    { timeout },
  );
  const [origin, fingerprint] = (await row.jsonValue()).split(" · SHA-256 ");
  const path = join(root, "book-props-localhost.crt");
  const cdp = await settings.createCDPSession();
  await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: root });
  await settings.locator("button::-p-text(証明書を保存)").click();
  let bytes;
  const deadline = Date.now() + timeout;
  do {
    bytes = await readFile(path).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
    if (!bytes) await delay(150);
  } while (!bytes && Date.now() < deadline);
  assert(bytes, "The old plugin did not offer its leaf certificate");
  const leaf = new X509Certificate(bytes);
  assert.equal(leaf.ca, false);
  assert.equal(leaf.fingerprint256, fingerprint.toUpperCase());
  const hostname = new URL(origin).hostname;
  assert.equal(leaf.checkHost(hostname), hostname);

  const certPage = await chrome.newPage();
  await certPage.goto("chrome://certificate-manager/localcerts/usercerts");
  await certPage.bringToFront();
  await certPage
    .locator(
      "certificate-manager >>> #userCertsSection >>> certificate-list:first-of-type >>> #importCert",
    )
    .filter((element) => !element.hidden && element.getClientRects().length > 0)
    .click();
  await dialog("certificate", path);
  const trustedHash = fingerprint.replaceAll(":", "").toLowerCase();
  await certPage
    .locator(
      "certificate-manager >>> #userCertsSection >>> certificate-list:first-of-type >>> certificate-entry",
    )
    .filter((entry, hash) => entry.sha256hashHex?.toLowerCase() === hash, trustedHash)
    .wait();
  await certPage.goto(origin);
  await certPage.close();
  return { origin, hostname };
}

export async function pairLegacy({ settings, options, chrome, root, timeout }) {
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
  const { origin, hostname } = await importLegacyLeaf({ settings, chrome, root, timeout, dialog });

  await settings.bringToFront();
  await settings.locator("button::-p-text(コードを発行)").click();
  const code = await settings.waitForFunction(
    () =>
      [...document.querySelectorAll(".vertical-tab-content [role=status]")]
        .map((el) => el.textContent)
        .find((value) => /^[A-Za-z0-9_-]{22}$/.test(value)),
    { timeout },
  );
  await options.bringToFront();
  await options.locator("#origin").fill(origin);
  await options.locator("#code").fill(await code.jsonValue());
  await options.click("button[type=submit]");
  await dialog("permission", hostname);
  await options.waitForFunction(
    () => document.querySelector("#status")?.textContent === "ペアリングしました。",
    { timeout },
  );
  return origin;
}
