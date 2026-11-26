import type { BadgeTone } from "../extension/badge.ts";

// Each tone's colour as 0xRRGGBB, saturated enough to tell apart at a glance on light and dark toolbars.
const toneColours: Record<BadgeTone, number> = {
  owned: 0x1e8e3e,
  ownedUnconfirmed: 0xf29900,
  wanted: 0x1a73e8,
  unchecked: 0x80868b,
};

/**
 * A square icon's straight-alpha RGBA pixels, row by row as canvas image data holds them, with a filled dot in
 * its bottom-right corner, cut free from the glyph by a transparent ring so that it reads on any toolbar colour.
 * The dot spans 7/16 of the icon and the ring 1/16. The 16-pixel glyph is drawn pixel by pixel, so its dot is
 * too; larger icons are smooth, so their dot's edge is antialiased.
 */
export function markIcon(
  pixels: Uint8ClampedArray,
  tone: BadgeTone,
): Uint8ClampedArray<ArrayBuffer> {
  const size = Math.sqrt(pixels.length / 4);
  const dot = (size * 7) / 32;
  const ring = dot + size / 16;
  const centre = size - dot;
  const samples = size <= 16 ? 1 : 4;
  const colour = toneColours[tone];
  const rgb = [colour >> 16, (colour >> 8) & 0xff, colour & 0xff];
  const marked = new Uint8ClampedArray(pixels);
  for (let at = 0; at < marked.length; at += 4) {
    const x = (at / 4) % size;
    const y = Math.floor(at / 4 / size);
    const cut = coverage(x - centre, y - centre, ring, samples);
    if (cut === 0) continue;
    const fill = coverage(x - centre, y - centre, dot, samples);
    // The ring erases the glyph beneath it (destination-out), then the dot is laid over (source-over).
    const below = ((marked[at + 3] ?? 0) / 255) * (1 - cut);
    const alpha = fill + below * (1 - fill);
    rgb.forEach((channel, offset) => {
      const under = marked[at + offset] ?? 0;
      marked[at + offset] = alpha && (channel * fill + under * below * (1 - fill)) / alpha;
    });
    marked[at + 3] = alpha * 255;
  }
  return marked;
}

/** How much of the pixel whose top-left corner lies at (`left`, `top`) from a circle's centre the circle covers. */
function coverage(left: number, top: number, radius: number, samples: number): number {
  let inside = 0;
  for (let row = 0; row < samples; row++)
    for (let column = 0; column < samples; column++) {
      const dx = left + (column + 0.5) / samples;
      const dy = top + (row + 0.5) / samples;
      if (dx * dx + dy * dy <= radius * radius) inside++;
    }
  return inside / samples ** 2;
}
