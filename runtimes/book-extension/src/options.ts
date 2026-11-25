import { sites } from "@book-props/book-products";
import { decodeConnectionStatus, decodeResponse } from "./messages.ts";
import { restoreDirectoryPermission, selectConnectionDirectory } from "./pairing-grant.ts";
import { statusLabel } from "./status.ts";

const id = document.querySelector<HTMLElement>("#extension-id")!;
const pair = document.querySelector<HTMLButtonElement>("#pair")!;
const allow = document.querySelector<HTMLButtonElement>("#allow")!;
const status = document.querySelector<HTMLElement>("#status")!;
const list = document.querySelector<HTMLUListElement>("#sites")!;
const pairingLabel = {
  paired: "ペアリング済みです。",
  unpaired: "ペアリングされていません。",
  unknown:
    "接続を確認できません。Obsidian を開いてください。接続用フォルダの許可が切れている場合は「今後も自動で接続する」を押してください。",
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
    if (!changed) {
      status.textContent = pairingLabel[current.state];
      allow.hidden = current.configured === undefined;
    }
  },
  () => {
    if (!changed) status.textContent = pairingLabel.unknown;
  },
);

pair.addEventListener("click", () => {
  changed = true;
  pair.disabled = true;
  status.textContent = "ペアリングを確認しています。";
  void (async () => {
    try {
      const grantId = await selectConnectionDirectory();
      if (!grantId) {
        status.textContent =
          "Obsidian の Book Props 設定に表示される接続用フォルダを選んでください。";
        return;
      }
      status.textContent = "Obsidian への接続を確認しています。";
      const reply = decodeResponse(await chrome.runtime.sendMessage({ kind: "pair", grantId }), {
        kind: "unavailable",
      });
      status.textContent =
        reply.kind === "saved"
          ? "ペアリングしました。初回設定の仕上げに「今後も自動で接続する」で「毎回許可」を選んでください。"
          : "ペアリングできません。Obsidian の起動と接続用フォルダを確認してください。";
      if (reply.kind === "saved") allow.hidden = false;
    } catch (error) {
      const name = error instanceof DOMException ? error.name : undefined;
      status.textContent =
        name === "AbortError"
          ? "接続用フォルダの選択が取り消されました。"
          : name === "NotAllowedError" || name === "SecurityError"
            ? "Chrome が接続用フォルダへのアクセスを許可しませんでした。"
            : "接続用フォルダの読み込みに失敗しました。";
    } finally {
      pair.disabled = false;
    }
  })();
});

allow.addEventListener("click", async () => {
  changed = true;
  allow.disabled = true;
  try {
    const permission = await restoreDirectoryPermission();
    if (permission !== "granted") {
      status.textContent = "許可されませんでした。「毎回許可」を選ぶと再起動後も自動で接続します。";
      return;
    }
    const reply = decodeConnectionStatus(await chrome.runtime.sendMessage({ kind: "status" }));
    status.textContent = pairingLabel[reply.state];
  } catch {
    status.textContent = pairingLabel.unknown;
  } finally {
    allow.disabled = false;
  }
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
  if (reply.kind === "saved") allow.hidden = true;
});
