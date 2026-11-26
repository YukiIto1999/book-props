import { sites } from "@book-props/book-products";
import { connectionFolder } from "../adapters/connection-folder.ts";
import { optionsRequests } from "../adapters/options-messages.ts";
import { Options } from "../extension/options.ts";
import { optionsView } from "../views/options-view.ts";

const view = optionsView();
const options = new Options(optionsRequests, connectionFolder, view);
view.listSites(sites);
view.bind({
  pair: () => void options.pair(),
  allow: () => void options.allow(),
  disconnect: () => void options.disconnect(),
});
void options.open();
