/**
 * The version of the disclosure on the settings page; raise it whenever the data practices or
 * their description change, which asks every user to agree again.
 * 2: the disclosure names the identifiers sent with a purchase.
 */
export const consentVersion = 2;
/** The user's agreement to the disclosure of `version`, given at `at` (epoch milliseconds). */
export type ConsentRecord = { version: number; at: number };
/** Keeps the agreement on this browser profile. */
export type ConsentStore = {
  read(): Promise<ConsentRecord | undefined>;
  write(record: ConsentRecord): Promise<void>;
  clear(): Promise<void>;
  /** Calls `changed` after the record changes in any extension context, including this one. */
  watch(changed: () => void): void;
};
/** Why the browser started the extension anew; "other" covers browser and shared module updates. */
export type InstallReason = "install" | "update" | "other";

/** Whether the user agreed to the current data practices, which every page read and Vault request needs. */
export class Consent {
  private readonly store: ConsentStore;

  constructor(store: ConsentStore) {
    this.store = store;
  }

  given = async (): Promise<boolean> => (await this.store.read())?.version === consentVersion;

  agree = (): Promise<void> => this.store.write({ version: consentVersion, at: Date.now() });

  withdraw = (): Promise<void> => this.store.clear();

  /** Calls `listener` after each change of the record; listeners ask `given` again instead of trusting the order of changes. */
  follow = (listener: () => void): void => {
    this.store.watch(listener);
  };

  /** A new install, or an update the user has not agreed to (such as one that changed the practices), shows the disclosure. */
  needsDisclosure = async (reason: InstallReason): Promise<boolean> =>
    reason !== "other" && !(await this.given());
}
