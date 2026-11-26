import type { InstallReason } from "../extension/consent.ts";

/** Opens the settings page, which shows the disclosure until the user agrees. */
export function openDisclosure(): Promise<void> {
  return chrome.runtime.openOptionsPage();
}

/** Opens the disclosure after an install or update for which `needed` says so. */
export function discloseAfterInstall(needed: (reason: InstallReason) => Promise<boolean>): void {
  chrome.runtime.onInstalled.addListener(({ reason }) => {
    const kind = reason === "install" || reason === "update" ? reason : "other";
    void needed(kind)
      .then((shown) => (shown ? openDisclosure() : undefined))
      .catch(() => undefined);
  });
}
