import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { activatePlugin } from "./activate-obsidian.mjs";
import { restartWorker } from "./install-chrome.mjs";
import { ObsidianFixture } from "./obsidian.mjs";
import { configure, pairWith, pasteNewCode, retryCode, text } from "./pair-evidence.mjs";

const paired = "ペアリング済みです。";
const unavailable =
  "接続を確認できません。Obsidian の起動を確認し、必要ならペアリングし直してください。";

export async function checkRestart({ obsidian, settings, chrome, options, extensionId, evidence }) {
  const used = await pairWith(settings, options);
  await options.screenshot({ path: join(evidence, "01-paired.png") });
  await retryCode(options, used);
  await restartWorker(chrome, options, extensionId);
  await text(options, "#status", paired);

  const unused = await pasteNewCode(settings, options);
  assert.notEqual(unused, used);
  await obsidian.stop();
  await obsidian.start();
  const restarted = await obsidian.settings();
  await restarted.waitForSelector("button::-p-text(ペアリング情報を発行)");
  await options.reload();
  await text(options, "#status", unavailable);
  await retryCode(options, unused);
  await pairWith(restarted, options);
  await options.screenshot({ path: join(evidence, "02-repaired-after-restart.png") });
  process.stdout.write(
    "Worker restart preserved pairing; Obsidian restart rejected the old session and unused code\n",
  );
}

export async function checkVaultIsolation({
  root,
  bundle,
  obsidian,
  options,
  extensionId,
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
    await pairWith(settings, options);

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
    await pairWith(await obsidian.settings(), options);
    await page.reload();
    const firstVault = await popup(page);
    await text(firstVault, "#status", "この版を所持");
    await firstVault.close();
    process.stdout.write(
      "A second Vault showed the same edition as unowned; losing that Vault did not switch to the first\n",
    );
  } finally {
    await second.close();
  }
}
