import type { BadgeTone, ToolbarIcon } from "../extension/badge.ts";

/** Draws the marked icon from the plain icon's RGBA pixels. */
type MarkPainter = (pixels: Uint8ClampedArray, tone: BadgeTone) => Uint8ClampedArray<ArrayBuffer>;

// The manifest's toolbar icon and title, which a tab without a mark shows.
const plainTitle = "Book Props";
const sizes = [16, 32] as const;
const plainPaths = { 16: "icon-16.png", 32: "icon-32.png" };

async function plainPixels(size: number): Promise<ImageData> {
  const packaged = await fetch(chrome.runtime.getURL(`icon-${size}.png`));
  const bitmap = await createImageBitmap(await packaged.blob());
  const context = new OffscreenCanvas(size, size).getContext("2d");
  if (!context) throw new Error("アイコンを描けません。");
  context.drawImage(bitmap, 0, 0, size, size);
  bitmap.close();
  return context.getImageData(0, 0, size, size);
}

/**
 * Sets a tab's icon. chrome.action.setIcon's promise neither rejects nor carries the failure: Chrome only logs it
 * as an unchecked runtime.lastError. Its callback is the one place the failure can be read, and reading it there
 * keeps it off the extension's error list.
 */
function setIcon(details: chrome.action.TabIconDetails): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  chrome.action.setIcon(details, () => {
    const failure = chrome.runtime.lastError;
    if (failure) reject(new Error(failure.message));
    else resolve();
  });
  return promise;
}

// How chrome.action refuses a tab that closed, or was replaced by a prerendered one, before it was drawn.
const closedTab = /^No tab with id: \d+\.$/;

/** Marks a tab's toolbar icon with a dot through chrome.action, drawing each tone's icon once per worker start. */
export function toolbarIcon(paint: MarkPainter): ToolbarIcon {
  const drawn = new Map<BadgeTone, Promise<Record<number, ImageData>>>();
  const marked = (tone: BadgeTone): Promise<Record<number, ImageData>> => {
    const cached = drawn.get(tone);
    if (cached) return cached;
    const drawing = Promise.all(
      sizes.map(async (size) => {
        const plain = await plainPixels(size);
        return [size, new ImageData(paint(plain.data, tone), size, size)] as const;
      }),
    ).then((icons) => Object.fromEntries(icons));
    // A failed drawing is tried again next time rather than remembered.
    void drawing.catch(() => drawn.delete(tone));
    drawn.set(tone, drawing);
    return drawing;
  };
  // The tooltip changes only once the icon has, so that the two never disagree. A tab that closed meanwhile has
  // no icon left to draw; any other failure is the caller's.
  const show: ToolbarIcon["show"] = async (tabId, badge) => {
    try {
      await (badge
        ? setIcon({ tabId, imageData: await marked(badge.tone) })
        : setIcon({ tabId, path: plainPaths }));
      await chrome.action.setTitle({ tabId, title: badge?.title ?? plainTitle });
    } catch (error) {
      if (!(error instanceof Error && closedTab.test(error.message))) throw error;
    }
  };
  return {
    show,
    // Tabs closing meanwhile have no icon left to restore.
    async clearAll() {
      const tabs = await chrome.tabs.query({});
      await Promise.allSettled(tabs.flatMap(({ id }) => (id ? [show(id, undefined)] : [])));
    },
  };
}

/** Calls `loading` with a tab's id whenever the tab starts loading a page; needs no tabs permission. */
export function followTabLoads(loading: (tabId: number) => void): void {
  chrome.tabs.onUpdated.addListener((tabId, change) => {
    if (change.status === "loading") loading(tabId);
  });
}
