import { z } from "zod";

export const endpoint = "/book-props/v1";
export const maxRequestBytes = 24 * 1024;
export const maxReplyBytes = 2048;
const code = z.string().regex(/^[A-Za-z0-9_-]{22}$/);
const token = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const text = z.string().min(1).max(512);
const pageText = z.string().min(1).max(2048);
const id = z.uuid();
const action = z.enum(["inspect", "purchase", "setWish", "clearWish", "reconcile", "open"]);
const ownership = z.enum([
  "sameEdition",
  "otherEdition",
  "unknownEdition",
  "unowned",
  "undetermined",
]);
export const product = z.strictObject({
  title: text.optional(),
  authors: z.array(text).max(24).optional(),
  isbns: z.array(z.string().min(1).max(40)).max(12).optional(),
  label: text.optional(),
  publisher: text.optional(),
  publishedOn: text.optional(),
  cover: pageText.optional(),
});
const purchaseKey = z.strictObject({
  clientId: id,
  requestId: id,
  issuedAt: z.number().int().nonnegative(),
});
/** An opaque name for the paired Vault and book folder; equal values mean the same folder. */
export const vaultScope = z.string().regex(/^[0-9a-f]{64}$/);
export const request = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("pair"), code }),
  z.strictObject({ action: z.literal("status") }),
  z.strictObject({ action: z.literal("inspect"), product }),
  z.strictObject({ action: z.literal("purchase"), product, purchase: purchaseKey }),
  z.strictObject({ action: z.literal("setWish"), product }),
  z.strictObject({ action: z.literal("clearWish"), product }),
  z.strictObject({ action: z.literal("reconcile"), product, purchase: purchaseKey }),
  z.strictObject({
    action: z.literal("open"),
    product,
    intent: z.enum(["purchase", "setWish", "clearWish"]).optional(),
  }),
]);
export const requestEnvelope = z
  .strictObject({ request, token: token.optional() })
  .refine((value) => (value.request.action === "pair") === (value.token === undefined));
export const response = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("paired"),
    token,
    expiresAt: z.number().int(),
    scope: vaultScope,
  }),
  z.strictObject({ kind: z.literal("connected") }),
  z.strictObject({ kind: z.literal("observed"), ownership, wanted: z.boolean() }),
  z.strictObject({ kind: z.literal("needsInput") }),
  z.strictObject({ kind: z.literal("opened") }),
  z.strictObject({ kind: z.literal("saved") }),
  z.strictObject({ kind: z.literal("replayed") }),
  z.strictObject({ kind: z.literal("unknown") }),
  z.strictObject({ kind: z.literal("unavailable") }),
  z.strictObject({ kind: z.literal("unreadable") }),
  z.strictObject({ kind: z.literal("conflict") }),
  z.strictObject({ kind: z.literal("notSaved") }),
  z.strictObject({ kind: z.literal("unauthorized") }),
  z.strictObject({ kind: z.literal("invalidRequest") }),
]);
export type Product = z.output<typeof product>;
export type Response = z.output<typeof response>;
export type Request = z.output<typeof request>;
export type RequestAction = z.output<typeof action>;

export function connectionOrigin(value: string): string | undefined {
  if (!/^https:\/\/bp-[0-9a-f]{32}\.localhost:[1-9][0-9]{0,4}$/.test(value)) return undefined;
  try {
    const origin = new URL(value).origin;
    return origin === value ? origin : undefined;
  } catch {
    return undefined;
  }
}

const pairingFields = z.strictObject({
  origin: z.string().refine((value) => connectionOrigin(value) !== undefined),
  anchor: z.base64().min(4).max(1400),
  code,
});
const pairing = pairingFields.extend({ version: z.literal(1) });
export type Pairing = z.output<typeof pairingFields>;

export function encodePairing(value: Pairing): string {
  return JSON.stringify({ version: 1, ...value });
}

export function decodePairing(text: string): Pairing | undefined {
  if (text.length > maxReplyBytes) return undefined;
  try {
    const decoded = pairing.safeParse(JSON.parse(text));
    if (!decoded.success) return undefined;
    const { origin, anchor, code } = decoded.data;
    return { origin, anchor, code };
  } catch {
    return undefined;
  }
}
