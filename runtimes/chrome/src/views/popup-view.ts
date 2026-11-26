import type { PopupView } from "../extension/popup.ts";
import { required } from "./elements.ts";

type PopupHandlers = Record<"purchase" | "wish" | "open" | "reconcile" | "forget", () => void>;

/** The popup's status line and action buttons. */
export function popupView(): PopupView & { bind(handlers: PopupHandlers): void } {
  const status = required("#status", HTMLElement);
  const purchase = required("#purchase", HTMLButtonElement);
  const wish = required("#wish", HTMLButtonElement);
  const open = required("#open", HTMLButtonElement);
  const reconcile = required("#reconcile", HTMLButtonElement);
  const forget = required("#forget", HTMLButtonElement);
  return {
    render(controls) {
      purchase.disabled = !controls.canPurchase;
      wish.disabled = !controls.canWish;
      wish.textContent = controls.wishLabel;
      open.disabled = !controls.canOpen;
      open.textContent = controls.openLabel;
      reconcile.hidden = forget.hidden = !controls.pending;
      reconcile.disabled = forget.disabled = !controls.pending;
    },
    say(text) {
      status.textContent = text;
    },
    lock() {
      for (const button of [purchase, wish, open, reconcile, forget]) button.disabled = true;
    },
    bind(handlers) {
      purchase.addEventListener("click", handlers.purchase);
      wish.addEventListener("click", handlers.wish);
      open.addEventListener("click", handlers.open);
      reconcile.addEventListener("click", handlers.reconcile);
      forget.addEventListener("click", () => {
        if (
          window.confirm("Vaultの記録または購入状況を確認しましたか？結果の保留だけを解除します。")
        )
          handlers.forget();
      });
    },
  };
}
