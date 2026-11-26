import { sites } from "@book-props/book-products";
import { decodeConnectionStatus, decodeResponse, type ConnectionStatus } from "./messages.ts";
import {
  directoryPermission,
  restoreDirectoryPermission,
  selectConnectionDirectory,
} from "./pairing-grant.ts";
import { statusLabel } from "./status.ts";

const pair = document.querySelector<HTMLButtonElement>("#pair")!;
const allow = document.querySelector<HTMLButtonElement>("#allow")!;
const status = document.querySelector<HTMLElement>("#status")!;
const list = document.querySelector<HTMLUListElement>("#sites")!;
const pairingLabel = {
  paired: "ペアリング済みです。",
  unpaired: "ペアリングされていません。",
  unknown: "接続を確認できません。Obsidian を開いてください。",
  dormant:
    "接続用フォルダの許可が切れています。「今後も自動で接続する」を押して許可してください。毎回許可する選択肢が出たらそれを選ぶと、以後は自動で接続します。",
} as const;
// Pairing or disconnecting replaces the opening status check, whose answer would then be stale.
let changed = false;
for (const entry of sites) {
  const row = list.appendChild(document.createElement("li"));
  const link = row.appendChild(document.createElement("a"));
  link.textContent = entry.name;
  link.href = entry.url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
}

/** The browser keeps the folder handle, but a one-time grant ends when the browser restarts, the extension reloads, or its last page closes. */
async function describe(current: ConnectionStatus): Promise<void> {
  const permission =
    current.state === "unknown" ? await directoryPermission().catch(() => undefined) : undefined;
  if (changed) return;
  const dormant = permission === "prompt";
  status.textContent = pairingLabel[dormant ? "dormant" : current.state];
  allow.hidden = !dormant;
}

async function pairWithFolder(): Promise<void> {
  changed = true;
  pair.disabled = true;
  status.textContent = "ペアリングを確認しています。";
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
        ? "ペアリングしました。商品ページを開くと所持を確認します。"
        : "ペアリングできません。Obsidian の起動と接続用フォルダを確認してください。";
    if (reply.kind === "saved") allow.hidden = true;
  } catch (error) {
    const name = error instanceof DOMException ? error.name : undefined;
    status.textContent =
      name === "AbortError"
        ? "接続用フォルダの選択が取り消されました。"
        : name === "NotAllowedError" || name === "SecurityError"
          ? "ブラウザが接続用フォルダへのアクセスを許可しませんでした。"
          : "接続用フォルダの読み込みに失敗しました。";
  } finally {
    pair.disabled = false;
  }
}

async function allowAutomatically(): Promise<void> {
  changed = true;
  allow.disabled = true;
  try {
    const permission = await restoreDirectoryPermission();
    if (permission !== "granted") {
      status.textContent = "許可されませんでした。接続するには、もう一度押して許可してください。";
      return;
    }
    allow.hidden = true;
    const reply = decodeConnectionStatus(await chrome.runtime.sendMessage({ kind: "status" }));
    status.textContent = pairingLabel[reply.state];
  } catch {
    status.textContent = pairingLabel.unknown;
  } finally {
    allow.disabled = false;
  }
}

async function disconnect(): Promise<void> {
  changed = true;
  const reply = decodeResponse(await chrome.runtime.sendMessage({ kind: "disconnect" }), {
    kind: "unavailable",
  });
  status.textContent =
    reply.kind === "saved"
      ? "このブラウザの接続を解除しました。Obsidian 側でも解除できます。"
      : statusLabel(reply, true);
  if (reply.kind === "saved") allow.hidden = true;
}

status.textContent = "接続を確認しています…";
void chrome.runtime.sendMessage({ kind: "status" }).then(
  (reply: unknown) => describe(decodeConnectionStatus(reply)),
  () => {
    if (!changed) status.textContent = pairingLabel.unknown;
  },
);
pair.addEventListener("click", () => void pairWithFolder());
allow.addEventListener("click", () => void allowAutomatically());
document.querySelector("#disconnect")?.addEventListener("click", () => void disconnect());
