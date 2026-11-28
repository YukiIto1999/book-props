import assert from "node:assert/strict";
import test from "node:test";
import { discloseAfterInstall } from "../src/adapters/disclosure.ts";
import { consentVersion } from "../src/extension/consent.ts";
import { install, storedConsent } from "./vault-storage.mjs";

const settle = () => new Promise((resolve) => setImmediate(resolve));

// Stands in for chrome.runtime, counts the settings pages opened, and fires onInstalled with `reason`.
async function withInstallEvents(consent, run) {
  const installed = [];
  const counter = { opened: 0 };
  globalThis.chrome = {
    runtime: {
      onInstalled: { addListener: (listener) => installed.push(listener) },
      openOptionsPage: async () => void counter.opened++,
    },
  };
  const fire = async (reason) => {
    for (const listener of installed) listener({ reason });
    await settle();
    return counter.opened;
  };
  try {
    discloseAfterInstall(consent.needsDisclosure);
    await run(fire);
  } finally {
    delete globalThis.chrome;
  }
}

void test("an install, or an update without consent, opens the disclosure", async () => {
  install({}, {});
  const consent = storedConsent();
  await withInstallEvents(consent, async (fire) => {
    assert.equal(await fire("install"), 1);
    assert.equal(await fire("update"), 2);
    assert.equal(await fire("chrome_update"), 2);
    await consent.agree();
    assert.equal(await fire("update"), 2);
  });
});

void test("a consent given to the disclosure up to 0.13.0 opens the new one once and counts as none until agreed again", async () => {
  // Versions up to 0.13.0 stored version 1, whose disclosure did not name the identifiers sent with a purchase.
  const { local } = install({ consent: { version: 1, at: 1 } }, {});
  const consent = storedConsent();
  await withInstallEvents(consent, async (fire) => {
    assert.equal(await fire("update"), 1);
    // Pages and the worker read and send nothing while this is false.
    assert.equal(await consent.given(), false);
    await consent.agree();
    assert.equal(await consent.given(), true);
    assert.equal((await local.get("consent")).consent.version, consentVersion);
    assert.equal(await fire("update"), 1);
  });
});
