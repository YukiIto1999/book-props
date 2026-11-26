import { offerRecheck } from "../adapters/context-menu.ts";
import { folderGrants } from "../adapters/folder-grants.ts";
import { pendingStore } from "../adapters/pending-store.ts";
import { sessionStore } from "../adapters/session-store.ts";
import { pageTabs } from "../adapters/tab-messages.ts";
import { exchange } from "../adapters/vault-transport.ts";
import { answerPages } from "../adapters/worker-messages.ts";
import { VaultClient } from "../extension/vault-client.ts";
import { workerOperations } from "../extension/worker-operations.ts";

const client = new VaultClient({
  exchange,
  grants: folderGrants,
  sessions: sessionStore(chrome.storage.session),
  pending: pendingStore(chrome.storage.local),
});
const operations = workerOperations(client, pageTabs);
// A service worker must register its listeners synchronously on every start.
answerPages(operations);
offerRecheck((tabId, url) => operations.recheck(tabId, url));
