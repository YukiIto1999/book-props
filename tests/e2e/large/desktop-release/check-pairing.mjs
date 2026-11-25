import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { activatePlugin } from "./activate-obsidian.mjs";
import { restartWorker } from "./install-chrome.mjs";
import { ObsidianFixture } from "./obsidian.mjs";
import {
  applyConnection,
  configure,
  paired,
  pairWith,
  remember,
  text,
  unavailable,
} from "./pair-evidence.mjs";

export async function checkRestart({
  obsidian,
  folder,
  chrome,
  options,
  extensionId,
  restartChrome,
  evidence,
}) {
  await options.screenshot({ path: join(evidence, "01-paired.png") });
  const worker = await restartWorker(chrome, options, extensionId);
  assert.equal(worker.status, paired);
  ({ chrome, options } = await restartChrome());
  await remember(options, chrome, folder);
  ({ options } = await restartChrome());
  await text(options, "#status", paired);
  await obsidian.stop();
  await options.reload();
  await text(options, "#status", unavailable);
  await obsidian.start();
  await obsidian.settings();
  await options.reload();
  await text(options, "#status", paired);
  await options.screenshot({ path: join(evidence, "02-reconnected-after-restart.png") });
  process.stdout.write("Full Chrome and Obsidian restarts reconnected without re-pairing\n");
}

export async function checkVaultIsolation({
  root,
  bundle,
  obsidian,
  options,
  extensionId,
  chrome,
  page,
  popup,
  notes,
  evidence,
}) {
  const vault = join(root, "second-vault");
  const books = join(vault, "Books");
  const second = new ObsidianFixture({ root, vault, bundle, port: 9224 });
  await mkdir(books, { recursive: true });
  try {
    await second.stage();
    await second.start();
    await activatePlugin(await second.vaultPage());
    const settings = await second.settings();
    await configure(settings, extensionId);
    await applyConnection(settings, join(evidence, "setup-second-vault.png"));
    await pairWith(settings, options, chrome, evidence);

    await page.reload();
    const otherVault = await popup(page);
    await text(otherVault, "#status", "未所有");
    await otherVault.screenshot({ path: join(evidence, "04-other-vault-unowned.png") });
    await otherVault.close();
    assert.deepEqual(await notes(books), []);

    await second.stop();
    await options.reload();
    await text(options, "#status", unavailable);
    assert.deepEqual(await notes(books), []);
    await pairWith(await obsidian.settings(), options, chrome, evidence);
    await page.reload();
    const firstVault = await popup(page);
    await text(firstVault, "#status", "この版を所持");
    await firstVault.close();
    await options.locator("#disconnect").click();
    await text(options, "#status", "このChromeの接続を解除しました。Obsidian側でも解除できます。");
    await options.reload();
    await text(options, "#status", "ペアリングされていません。");
    process.stdout.write(
      "A second Vault showed the same edition as unowned; losing that Vault did not switch to the first\n",
    );
  } finally {
    await second.close();
  }
}
