import { sites } from "@book-props/book-products";
import { connectionFolder } from "../adapters/connection-folder.ts";
import { consentStore } from "../adapters/consent-store.ts";
import { optionsRequests } from "../adapters/options-messages.ts";
import { Consent } from "../extension/consent.ts";
import { Options } from "../extension/options.ts";
import { optionsView } from "../views/options-view.ts";

const view = optionsView();
const consent = new Consent(consentStore(chrome.storage.local));
const options = new Options(optionsRequests, connectionFolder, consent, view);
view.listSites(sites);
view.bind({
  agree: () => void options.agree(),
  withdraw: () => void options.withdraw(),
  pair: () => void options.pair(),
  allow: () => void options.allow(),
  disconnect: () => void options.disconnect(),
});
// Another settings page may agree or withdraw while this one is open.
consent.follow(() => void options.open());
void options.open();
