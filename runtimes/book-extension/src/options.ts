import { connectionOrigin } from "@book-props/vault-contract";
import { sites } from "@book-props/book-products";
import { decodeConnectionStatus, decodeResponse } from "./messages.ts";
import { statusLabel } from "./status.ts";

const id = document.querySelector<HTMLElement>("#extension-id")!;
const address = document.querySelector<HTMLInputElement>("#origin")!;
const code = document.querySelector<HTMLInputElement>("#code")!;
const form = document.querySelector("form")!;
const submit = form.querySelector<HTMLButtonElement>("button[type=submit]")!;
const status = document.querySelector<HTMLElement>("#status")!;
const list = document.querySelector<HTMLUListElement>("#sites")!;
const pairingLabel = {
  paired: "ペアリング済みです。",
  unpaired: "ペアリングされていません。",
  unknown: "接続を確認できません。Obsidianの起動と証明書を確認してください。",
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
    if (current.configured && !address.value) address.value = current.configured;
    if (!changed) status.textContent = pairingLabel[current.state];
  },
  () => {
    if (!changed) status.textContent = pairingLabel.unknown;
  },
);

form.addEventListener("submit", (event) => {
  event.preventDefault();
  changed = true;
  const origin = connectionOrigin(address.value.trim());
  if (!origin) {
    status.textContent = "Obsidianに表示された接続先を入力してください。";
    return;
  }
  const { hostname } = new URL(origin);
  submit.disabled = true;
  void (async () => {
    try {
      if (!(await chrome.permissions.request({ origins: [`https://${hostname}/*`] }))) {
        status.textContent = "この接続先へのアクセスが許可されていません。";
        return;
      }
      const reply = decodeResponse(
        await chrome.runtime.sendMessage({ kind: "pair", origin, code: code.value }),
        { kind: "unavailable" },
      );
      code.value = "";
      status.textContent =
        reply.kind === "saved"
          ? "ペアリングしました。"
          : "ペアリングできません。証明書、Obsidianの起動、一度だけ使えるコードを確認してください。";
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
