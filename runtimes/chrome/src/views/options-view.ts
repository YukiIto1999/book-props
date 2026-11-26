import type { OptionsView } from "../extension/options.ts";
import { required } from "./elements.ts";

type OptionsHandlers = Record<"pair" | "allow" | "disconnect", () => void>;
type Site = { name: string; url: string };

/** The settings page's pairing controls, status line, and list of supported sites. */
export function optionsView(): OptionsView & {
  bind(handlers: OptionsHandlers): void;
  listSites(sites: readonly Site[]): void;
} {
  const pair = required("#pair", HTMLButtonElement);
  const allow = required("#allow", HTMLButtonElement);
  const disconnect = required("#disconnect", HTMLButtonElement);
  const status = required("#status", HTMLElement);
  const list = required("#sites", HTMLUListElement);
  return {
    say(text) {
      status.textContent = text;
    },
    offerAllow(shown) {
      allow.hidden = !shown;
    },
    pairing(busy) {
      pair.disabled = busy;
    },
    allowing(busy) {
      allow.disabled = busy;
    },
    bind(handlers) {
      pair.addEventListener("click", handlers.pair);
      allow.addEventListener("click", handlers.allow);
      disconnect.addEventListener("click", handlers.disconnect);
    },
    listSites(sites) {
      for (const entry of sites) {
        const row = list.appendChild(document.createElement("li"));
        const link = row.appendChild(document.createElement("a"));
        link.textContent = entry.name;
        link.href = entry.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
      }
    },
  };
}
