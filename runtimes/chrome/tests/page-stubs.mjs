import { TabBadges } from "../src/extension/badge.ts";
import { pageKey } from "../src/extension/page-key.ts";
import { workerOperations } from "../src/extension/worker-operations.ts";

export const productUrl = "https://www.amazon.co.jp/dp/4000000000";
export const book = { title: "吾輩は猫である", authors: ["夏目漱石"], isbns: ["9784101010014"] };
export const observed = (ownership, wanted) => ({ kind: "observed", ownership, wanted });
export const settle = () => new Promise((resolve) => setImmediate(resolve));

/** Waits until `ready` holds; the worker's digests finish outside the microtask queue. */
export async function until(ready) {
  while (!ready()) await settle();
}

// A toolbar that keeps each tab's tone, as chrome.action keeps each tab's icon.
function toolbar() {
  const tones = new Map();
  return {
    tones,
    show: async (tabId, badge) => {
      if (badge) tones.set(tabId, badge.tone);
      else tones.delete(tabId);
    },
    clearAll: async () => tones.clear(),
  };
}

/**
 * The worker over a Vault whose answers and saves the test releases one by one, or, with `reply`, answers every
 * check with it and saves every change. Consent is set by the test, and so is the active tab, through
 * `tab.active`. `sent` lists the Vault actions asked for, and `key` names the page the popup would show now.
 */
export function stubWorker({ active = { tabId: 1, url: productUrl, product: book }, reply } = {}) {
  const icon = toolbar();
  const answers = [];
  const saves = [];
  const sent = [];
  const tab = { active };
  const consent = { agreed: true, given: async () => consent.agreed };
  const client = {
    send: (request) => {
      sent.push(request.action);
      const answer = Promise.withResolvers();
      answers.push(answer);
      if (reply) answer.resolve(reply);
      return answer.promise;
    },
    hasPending: async () => false,
    changeBook: () => {
      const save = Promise.withResolvers();
      saves.push(save);
      if (reply) save.resolve({ kind: "saved" });
      return save.promise;
    },
  };
  const operations = workerOperations({
    client,
    tabs: {
      active: async () => tab.active,
      inTab: async () => tab.active,
      show: async () => {},
      consentChanged: async () => {},
    },
    badges: new TabBadges(icon),
    consent,
    disclose: async () => {},
  });
  const key = () => pageKey(tab.active);
  return { operations, tones: icon.tones, answers, saves, sent, consent, tab, key };
}

/** A consent the user has already given. */
export function agreed() {
  return { given: async () => true, agree: async () => {}, withdraw: async () => {} };
}

/** A settings page view that records what it says in `said` and what it shows in `shown`. */
export function optionsView(said, shown = {}) {
  return {
    disclose: (disclosed) => (shown.disclosed = disclosed),
    agreeing: () => {},
    say: (text) => said.push(text),
    offerAllow: () => {},
    pairing: () => {},
    allowing: () => {},
  };
}
