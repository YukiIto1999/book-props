import { consentStore } from "../src/adapters/consent-store.ts";
import { pendingStore } from "../src/adapters/pending-store.ts";
import { sessionStore } from "../src/adapters/session-store.ts";
import { Consent } from "../src/extension/consent.ts";
import { VaultClient } from "../src/extension/vault-client.ts";

// Like chrome.storage, every listener hears each write, including the writer's own context.
function storage(initial) {
  const values = { ...initial };
  const listeners = [];
  const changed = (keys) => {
    const changes = Object.fromEntries(keys.map((key) => [key, { newValue: values[key] }]));
    for (const listener of listeners) listener(changes);
  };
  return {
    setAccessLevel: async () => {},
    get: async (keys) => Object.fromEntries([keys].flat().map((key) => [key, values[key]])),
    set: async (update) => {
      Object.assign(values, update);
      changed(Object.keys(update));
    },
    remove: async (key) => {
      delete values[key];
      changed([key]);
    },
    onChanged: { addListener: (listener) => listeners.push(listener) },
  };
}

let installed;

/** In-memory stand-ins for chrome.storage.local and chrome.storage.session holding `local` and `session`. */
export function install(local, session) {
  installed = { local: storage(local), session: storage(session) };
  return installed;
}

/** A client over the installed storage areas, through the extension's own storage adapters. */
export function vaultClient(exchange, grants) {
  return new VaultClient({
    exchange,
    grants,
    sessions: sessionStore(installed.session),
    pending: pendingStore(installed.local),
  });
}

/** The consent kept in the installed local storage, through the extension's own storage adapter. */
export function storedConsent() {
  return new Consent(consentStore(installed.local));
}
