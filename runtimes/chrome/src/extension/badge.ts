import type { Reply } from "./outcomes.ts";
import { statusLabel } from "./status.ts";

/** What the dot on a tab's toolbar icon says about the book its page shows. */
export type BadgeTone = "owned" | "ownedUnconfirmed" | "wanted" | "unchecked";
/** A tab's dot and the tooltip that spells it out. */
export type Badge = { tone: BadgeTone; title: string };
/** Draws a tab's toolbar icon; without a badge, the plain icon and title. */
export type ToolbarIcon = {
  show(tabId: number, badge: Badge | undefined): Promise<void>;
  /** Restores the plain icon on every tab. */
  clearAll(): Promise<void>;
};

/** The dot for a checked book: ownership before a wish, and none when the book is neither owned nor wanted. */
export function badgeFor(reply: Reply): Badge | undefined {
  const tone = toneOf(reply);
  return tone && { tone, title: `Book Props：${statusLabel(reply, true)}` };
}

function toneOf(reply: Reply): BadgeTone | undefined {
  // Without consent nothing was read, so there is nothing to mark.
  if (reply.kind === "consentRequired") return undefined;
  if (reply.kind !== "observed") return "unchecked";
  switch (reply.ownership) {
    case "sameEdition":
      return "owned";
    case "otherEdition":
    case "unknownEdition":
      return "ownedUnconfirmed";
    case "unowned":
      return reply.wanted ? "wanted" : undefined;
    case "undetermined":
      return "unchecked";
  }
}

/** A tab's turn to be marked: `mark` draws the answer only while `current`, that is, while nothing newer claimed the tab. */
export type BadgeClaim = {
  current(): boolean;
  mark(reply: Reply | undefined): Promise<void>;
};

/**
 * Keeps each tab's dot on the newest thing known about its page. Every check, clear and page load claims the
 * tab in turn, and a result arriving after a newer claim is dropped, so a slow answer cannot mark a page the
 * tab has left. Drawing never fails the check it follows: a tab that closed meanwhile has no icon to draw.
 */
export class TabBadges {
  private readonly icon: ToolbarIcon;
  private readonly latest = new Map<number, number>();
  private turns = 0;
  private drawing: Promise<void> = Promise.resolve();

  constructor(icon: ToolbarIcon) {
    this.icon = icon;
  }

  /** Claims the tab for a check or change starting now. */
  claim(tabId: number): BadgeClaim {
    const turn = ++this.turns;
    this.latest.set(tabId, turn);
    const current = (): boolean => this.latest.get(tabId) === turn;
    return {
      current,
      mark: (reply) => this.draw(current, () => this.icon.show(tabId, reply && badgeFor(reply))),
    };
  }

  clear = (tabId: number): Promise<void> => this.claim(tabId).mark(undefined);

  /** Removes every dot, and drops every answer still on its way. */
  clearAll = (): Promise<void> => {
    this.latest.clear();
    return this.draw(
      () => true,
      () => this.icon.clearAll(),
    );
  };

  // Draws one at a time and decides at drawing time, so that the last drawing is the newest claim's.
  private draw(current: () => boolean, paint: () => Promise<void>): Promise<void> {
    const drawn = this.drawing.then(() => (current() ? paint() : undefined)).catch(() => undefined);
    this.drawing = drawn;
    return drawn;
  }
}
