import { connectionFolder } from "../adapters/connection-folder.ts";
import { popupRequests } from "../adapters/popup-messages.ts";
import { Popup } from "../extension/popup.ts";
import { popupView } from "../views/popup-view.ts";

const view = popupView();
const popup = new Popup(popupRequests, connectionFolder, view);
view.bind({
  purchase: () => void popup.act("purchase"),
  wish: () => void popup.toggleWish(),
  open: () => void popup.act("open"),
  reconcile: () => void popup.act("reconcile"),
  forget: () => void popup.act("forget"),
});
void popup.refresh();
