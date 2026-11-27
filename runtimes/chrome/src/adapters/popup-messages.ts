import type { PopupRequests } from "../extension/popup.ts";
import { decodePageState, decodeResponse, type PopupMessage } from "./wire.ts";

/** The popup's requests to the worker. */
export const popupRequests: PopupRequests = {
  async inspect() {
    try {
      const reply: unknown = await chrome.runtime.sendMessage({
        kind: "inspect",
      } satisfies PopupMessage);
      return decodePageState(reply);
    } catch {
      return undefined;
    }
  },
  async request(action, page, failure) {
    const message: PopupMessage =
      action === "reconcile" || action === "forget" ? { kind: action } : { kind: action, page };
    const reply: unknown = await chrome.runtime.sendMessage(message);
    return decodeResponse(reply, failure);
  },
};
