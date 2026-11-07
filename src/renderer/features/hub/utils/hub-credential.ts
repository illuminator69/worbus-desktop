/**
 * Worbus P2: whether this device can reach the Worbus Server at all (C1 of the lane review).
 *
 * Main holds the credential (`hubAuth.bearer()`): the device secret a sign-in issued, else - on an
 * older server only - the typed token. The renderer never sees the secret, so it asks a different
 * question with the same answer: is a secret held (`hub.store.authSignedIn`), or owed by a silent
 * sign-in that is running (`authOwed`), or is a token typed? Every renderer check of "is the hub set
 * up" goes through here: a signed-in device has no typed token, and a test of `hub.token` alone hid
 * moods, the lb-bot mirror and AudioMuse from every device that signed in with one tap.
 *
 * Pure and import-free, so `hub-credential.harness.ts` runs it.
 */

/** What `hub.store` says about the device secret main keeps. */
export interface HubSecretState {
    /** A silent sign-in is owed and running (a memory-only secret after a restart, a 4005). */
    authOwed: boolean;
    /** Main holds a device secret for this server. */
    authSignedIn: boolean;
}

export interface HubSettingLike {
    enabled: boolean;
    token: string;
    url: string;
}

/** A device secret is held, or one is on its way. */
export const hubSecretHeld = (s: HubSecretState): boolean => s.authSignedIn || s.authOwed;

/** A token is typed (the Advanced field of an older server, or one kept from before P2). */
export const hasTypedToken = (hub: Pick<HubSettingLike, 'token'> | undefined): boolean =>
    (hub?.token ?? '').trim() !== '';

/** The one test of "this device has a hub credential": a secret held or owed, or a typed token. */
export const hasHubCredential = (
    hub: Pick<HubSettingLike, 'token'> | undefined,
    secretHeld: boolean,
): boolean => secretHeld || hasTypedToken(hub);

/** Switched on, with an address and a credential: the hub's routes have something to answer. */
export const hubSetUp = (hub: HubSettingLike | undefined, secretHeld: boolean): boolean =>
    Boolean(hub?.enabled && hub.url && hasHubCredential(hub, secretHeld));
