import type { Toast } from "../extension/page-watch.ts";

/** A status bubble in the page's corner, shielded from the page's own styles. */
export function pageToast(): Toast {
  // Important :host rules outrank the page's own CSS, and page selectors cannot reach into the shadow tree.
  const style = new CSSStyleSheet();
  style.replaceSync(
    ":host{all:initial!important;position:fixed!important;top:16px!important;right:16px!important;z-index:2147483647!important;max-width:calc(100vw - 32px)!important;pointer-events:none!important}" +
      "[role=status]{font:600 14px/1.45 system-ui,sans-serif;color:white;background:#23262d;padding:10px 14px;border-radius:8px;box-shadow:0 2px 12px #0005}",
  );
  let current: HTMLElement | undefined;
  return {
    show(text, duration) {
      current?.remove();
      const host = document.createElement("div");
      const root = host.attachShadow({ mode: "open" });
      root.adoptedStyleSheets = [style];
      const body = root.appendChild(document.createElement("div"));
      body.setAttribute("role", "status");
      body.textContent = text;
      document.body.append(host);
      current = host;
      window.setTimeout(() => host.remove(), duration);
    },
    clear() {
      current?.remove();
    },
  };
}
