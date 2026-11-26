import { consentStore } from "../adapters/consent-store.ts";
import { offerRecheck } from "../adapters/context-menu.ts";
import { discloseAfterInstall, openDisclosure } from "../adapters/disclosure.ts";
import { folderGrants } from "../adapters/folder-grants.ts";
import { pendingStore } from "../adapters/pending-store.ts";
import { sessionStore } from "../adapters/session-store.ts";
import { pageTabs } from "../adapters/tab-messages.ts";
import { followTabLoads, toolbarIcon } from "../adapters/toolbar-icon.ts";
import { exchange } from "../adapters/vault-transport.ts";
import { answerPages } from "../adapters/worker-messages.ts";
import { TabBadges } from "../extension/badge.ts";
import { Consent } from "../extension/consent.ts";
import { VaultClient } from "../extension/vault-client.ts";
import { workerOperations } from "../extension/worker-operations.ts";
import { markIcon } from "../views/toolbar-dot.ts";

const client = new VaultClient({
  exchange,
  grants: folderGrants,
  sessions: sessionStore(chrome.storage.session),
  pending: pendingStore(chrome.storage.local),
});
const consent = new Consent(consentStore(chrome.storage.local));
const operations = workerOperations({
  client,
  tabs: pageTabs,
  badges: new TabBadges(toolbarIcon(markIcon)),
  consent,
  disclose: openDisclosure,
});
// A service worker must register its listeners synchronously on every start.
answerPages(operations);
offerRecheck((tabId, url) => operations.recheck(tabId, url));
followTabLoads((tabId) => void operations.unmark(tabId));
discloseAfterInstall(consent.needsDisclosure);
consent.follow(() => void operations.consentChanged().catch(() => undefined));
