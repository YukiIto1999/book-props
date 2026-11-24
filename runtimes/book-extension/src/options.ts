import { sites } from "@book-props/book-products";
import { decodeConnectionStatus, decodeResponse } from "./messages.ts";
import { statusLabel } from "./status.ts";

const id = document.querySelector<HTMLElement>("#extension-id")!;
const pairing = document.querySelector<HTMLTextAreaElement>("#pairing")!;
const form = document.querySelector("form")!;
const submit = form.querySelector<HTMLButtonElement>("button[type=submit]")!;
const status = document.querySelector<HTMLElement>("#status")!;
const list = document.querySelector<HTMLUListElement>("#sites")!;
const pairingLabel = {
  paired: "ペアリング済みです。",
  unpaired: "ペアリングされていません。",
  unknown: "接続を確認できません。Obsidian の起動を確認し、必要ならペアリングし直してください。",
} as const;
// Pairing or disconnecting replaces the opening status check, whose answer would then be stale.
let changed = false;
id.textContent = chrome.runtime.id;
for (const entry of sites) {
  const row = list.appendChild(document.createElement("li"));
  const link = row.appendChild(document.createElement("a"));
  link.textContent = entry.name;
  link.href = entry.url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
}

status.textContent = "接続を確認しています…";
void chrome.runtime.sendMessage({ kind: "status" }).then(
  (reply: unknown) => {
    const current = decodeConnectionStatus(reply);
    if (!changed) status.textContent = pairingLabel[current.state];
  },
  () => {
    if (!changed) status.textContent = pairingLabel.unknown;
  },
);

form.addEventListener("submit", (event) => {
  event.preventDefault();
  changed = true;
  const text = pairing.value;
  pairing.value = "";
  submit.disabled = true;
  status.textContent = "ペアリングを確認しています。";
  void (async () => {
    try {
      const reply = decodeResponse(
        await chrome.runtime.sendMessage({ kind: "pair", pairing: text }),
        { kind: "unavailable" },
      );
      status.textContent =
        reply.kind === "saved"
          ? "ペアリングしました。"
          : "ペアリングできません。Obsidian を開き、新しいペアリング情報を発行してください。";
    } catch {
      status.textContent = "ペアリングできません。";
    } finally {
      submit.disabled = false;
    }
  })();
});

document.querySelector("#disconnect")?.addEventListener("click", async () => {
  changed = true;
  const reply = decodeResponse(await chrome.runtime.sendMessage({ kind: "disconnect" }), {
    kind: "unavailable",
  });
  status.textContent =
    reply.kind === "saved"
      ? "このChromeの接続を解除しました。Obsidian側でも解除できます。"
      : statusLabel(reply, true);
});
