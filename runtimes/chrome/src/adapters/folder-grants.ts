import { pairingChallenge, pairingProofFile } from "@book-props/vault-contract";
import type { Grant, Grants } from "../extension/vault-session.ts";
import { access, enrollment, readCard, stored, type Enrollment } from "./folder-records.ts";

function grant({ binding, directory }: Enrollment): Grant {
  return {
    binding,
    async read() {
      const card = await readCard(directory).catch(() => undefined);
      return card?.grantId === binding.grantId &&
        card.origin === binding.origin &&
        card.scope === binding.scope
        ? card
        : undefined;
    },
    // Writes only the digest of the challenge; the code itself goes to the plugin over TLS.
    async prove(anchor) {
      const code = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))))
        .replace(/=/g, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_");
      const bytes = new TextEncoder().encode(pairingChallenge(anchor, code));
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      bytes.fill(0);
      const handle = await directory.getFileHandle(pairingProofFile, { create: true });
      const stream = await handle.createWritable();
      try {
        const hex = Array.from(new Uint8Array(digest), (byte) =>
          byte.toString(16).padStart(2, "0"),
        );
        await stream.write(hex.join(""));
        await stream.close();
      } catch (error) {
        await stream.abort().catch(() => undefined);
        throw error;
      }
      return code;
    },
  };
}

/** The connection folders the worker pairs through, as the options page left them in IndexedDB. */
export const folderGrants: Grants = {
  async read() {
    const entry = await stored("paired");
    return entry && grant(entry);
  },
  async selected(id) {
    const entry = await stored("selected");
    return entry?.binding.grantId === id ? grant(entry) : undefined;
  },
  commit(id) {
    return access("readwrite", (items, complete) => {
      const lookup = items.get("selected");
      lookup.onsuccess = () => {
        const entry = enrollment(lookup.result);
        if (entry?.binding.grantId !== id) return complete(false);
        items.put(entry, "paired");
        items.delete("selected");
        complete(true);
      };
    });
  },
  forget() {
    return access("readwrite", (items, complete) => {
      items.clear();
      complete(undefined);
    });
  },
};
