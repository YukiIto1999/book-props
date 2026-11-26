import { pendingStore } from "../src/adapters/pending-store.ts";
import { sessionStore } from "../src/adapters/session-store.ts";
import { VaultClient } from "../src/extension/vault-client.ts";

function storage(initial) {
  const values = { ...initial };
  return {
    setAccessLevel: async () => {},
    get: async (keys) => Object.fromEntries([keys].flat().map((key) => [key, values[key]])),
    set: async (update) => Object.assign(values, update),
    remove: async (key) => {
      delete values[key];
    },
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
