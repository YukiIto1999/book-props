import type { OptionsView } from "../extension/options.ts";
import { required } from "./elements.ts";

type OptionsHandlers = Record<"agree" | "withdraw" | "pair" | "allow" | "disconnect", () => void>;
type Site = { name: string; url: string };

/** The settings page's disclosure, pairing controls, status line, and list of supported sites. */
export function optionsView(): OptionsView & {
  bind(handlers: OptionsHandlers): void;
  listSites(sites: readonly Site[]): void;
} {
  const consent = required("#consent", HTMLElement);
  const agree = required("#agree", HTMLButtonElement);
  const setup = required("#setup", HTMLElement);
  const withdraw = required("#withdraw", HTMLButtonElement);
  const pair = required("#pair", HTMLButtonElement);
  const allow = required("#allow", HTMLButtonElement);
  const disconnect = required("#disconnect", HTMLButtonElement);
  const status = required("#status", HTMLElement);
  const list = required("#sites", HTMLUListElement);
  return {
    disclose(shown) {
      consent.hidden = !shown;
      setup.hidden = shown;
    },
    agreeing(busy) {
      agree.disabled = busy;
    },
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
      agree.addEventListener("click", handlers.agree);
      withdraw.addEventListener("click", handlers.withdraw);
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
