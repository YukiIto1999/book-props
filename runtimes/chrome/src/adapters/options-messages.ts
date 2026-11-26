import { unavailable } from "../extension/outcomes.ts";
import type { OptionsRequests } from "../extension/options.ts";
import { decodeConnectionStatus, decodeResponse, type OptionsMessage } from "./wire.ts";

function send(message: OptionsMessage): Promise<unknown> {
  return chrome.runtime.sendMessage(message);
}

/** The settings page's requests to the worker. */
export const optionsRequests: OptionsRequests = {
  async status() {
    return decodeConnectionStatus(await send({ kind: "status" }));
  },
  async pair(grantId) {
    return decodeResponse(await send({ kind: "pair", grantId }), unavailable);
  },
  async disconnect() {
    return decodeResponse(await send({ kind: "disconnect" }), unavailable);
  },
};
