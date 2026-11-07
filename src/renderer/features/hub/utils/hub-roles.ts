import type { HubUser } from '../../../../shared/utils/hub-signin.ts';

/**
 * Worbus P2 (design §6.5): which hub and lb-bot surfaces a signed-in user sees, and what a change
 * of Navidrome account does to this device's hub sign-in. Pure (type imports only) so
 * `hub-roles.harness.ts` runs it.
 *
 * `hub.store.user` (`welcome.user`, replaced by each `user` frame) is the only role source for
 * these surfaces; Navidrome's own `isAdmin` in the auth store keeps gating only what it gated
 * before. lb-bot's own table stays the authority: these gates only hide what lb-bot would refuse.
 */

export interface HubRoles {
    admin: boolean;
    primary: boolean;
}

/**
 * Whether a hub of this round is in play although no `user` has been heard: a device secret held
 * or owed, the server signed this device out (review M1), or main has not yet said which it is
 * (re-review N1: the launch window before `hub-auth-state` answers). Roles are least privilege
 * then, so nothing gated flashes on and off.
 */
export const credentialPending = (s: {
    authKnown: boolean;
    authOwed: boolean;
    authSignedIn: boolean;
    signedOut: boolean;
}): boolean => !s.authKnown || s.authSignedIn || s.authOwed || s.signedOut;

/** No `user` at all: an older hub, which sends none. Today's behaviour: everything shown. */
export const TODAY_ROLES: HubRoles = { admin: true, primary: true };

/** A device secret held or owed, and no `user` heard yet: nothing gated is shown (review M1). */
export const LEAST_ROLES: HubRoles = { admin: false, primary: false };

/**
 * The roles a `user` gives. No user means today's behaviour only for a device on a typed token or
 * with no credential (an older hub sends none); with a device secret held or owed (`signedIn`) a
 * hub of this round will name the user, so until it does - before the first welcome, while signed
 * out - nothing admin or primary-only is shown, rather than flashing on for everyone.
 */
export const rolesOf = (user: HubUser | null | undefined, signedIn = false): HubRoles =>
    user ? { admin: user.admin, primary: user.primary } : signedIn ? LEAST_ROLES : TODAY_ROLES;

/**
 * Each gated surface and the flag it needs. A non-admin keeps browse, the wishlist and Scan now
 * (P1's table); the listening history and everything built from it is the primary user's (the
 * hub sends `HUB_ND_USER`'s credentials for the fingerprint).
 */
export const ROLE_GATES = {
    /** Fix album match (the context menu, the gap box's album controls, the album dialog). */
    albumMatch: 'admin',
    /** Fix MusicBrainz match on an artist (the scan's "match manually", the MBID dialog). */
    artistMatch: 'admin',
    /** Getting albums: acquire, the fill buttons (retry, cancel, MP3), Activity. */
    downloads: 'admin',
    /** The fingerprint mix kind and the direct AudioMuse fingerprint. */
    fingerprint: 'primary',
    libraryMatches: 'admin',
    /** My Listening / Statistics. */
    listening: 'primary',
    /** Merge into one name. */
    merge: 'admin',
    needsAttention: 'admin',
    /** The hub's seedless station. */
    yourMix: 'primary',
} as const satisfies Record<string, keyof HubRoles>;

export type RoleGate = keyof typeof ROLE_GATES;

export const allows = (roles: HubRoles, gate: RoleGate): boolean => roles[ROLE_GATES[gate]];

/**
 * A page behind a role gate, opened directly (history, a stale link: walk B1, B7). The hub named
 * a user without the flag: `leave` - the page is absent, as its sidebar entry is. A secret in play
 * and no user heard yet: `wait` - nothing is painted (no cached answer of another account). No user
 * and no secret (an older hub): `show`, as today.
 */
export const routeAccess = (
    user: HubUser | null,
    pending: boolean,
    gate: RoleGate,
): 'leave' | 'show' | 'wait' => {
    if (user) return allows(rolesOf(user), gate) ? 'show' : 'leave';
    return pending ? 'wait' : 'show';
};

/**
 * lb-bot (or the hub) refused an action for a role the client still believed it had - a demotion
 * the `user` frame has not brought yet. Lower the flag now, so the action hides in place instead
 * of being offered again; the next `user` frame or welcome restates the real flags. No user (an
 * older hub): nothing to lower, lb-bot's refusal holds the line.
 */
export const userAfterRefusal = (
    user: HubUser | null,
    code: string | undefined,
): HubUser | null => {
    if (!user) return user;
    if (code === 'admin_only' && user.admin) return { ...user, admin: false };
    if (code === 'primary_only' && user.primary) return { ...user, primary: false };
    return user;
};

/** What a change of the current Navidrome server means for the hub sign-in. */
export type AccountChange = 'logout' | 'none' | 'switch';

/**
 * A Navidrome user name as an account identity (re-review N2): trimmed, Unicode-normalised and
 * lower-cased. Navidrome logins are case-insensitive and `getUser` answers the stored lower-case
 * name, so a server added as "Owner" (or with a stray space) is the hub's "owner".
 */
export const accountName = (name: string): string => name.normalize('NFC').trim().toLowerCase();

/**
 * Which Navidrome account a server entry is (review I1): its id, the user name lower-cased (as the
 * hub keys users) and the address. Editing the current entry's user or address keeps its id, and
 * is still another account. Null: no current server.
 */
export const accountKey = (
    server: null | undefined | { id: string; url: string; username: string },
): null | string =>
    server ? JSON.stringify([server.id, accountName(server.username), server.url]) : null;

export const accountChange = (
    previousKey: null | string | undefined,
    nextKey: null | string | undefined,
): AccountChange => {
    if ((previousKey ?? null) === (nextKey ?? null)) return 'none';
    return nextKey ? 'switch' : 'logout';
};

/**
 * At a welcome (review M7): this device holds a secret for a user other than the current server's
 * account - a crash between the server change and the hub sign-out, or a change that was missed.
 * Names compare lower-cased. On a token (R23 upgrades it) or with no account here, nothing to say.
 */
export const accountMismatch = (
    user: HubUser | null,
    username: null | string,
    signedIn: boolean,
): boolean =>
    Boolean(
        signedIn &&
        user &&
        username &&
        accountName(username) !== '' &&
        accountName(user.name) !== accountName(username),
    );

export interface AccountFollowDeps {
    /** The lb-bot fill ledger (an admin's downloads and their history: review M5). */
    clearFills: () => void;
    /**
     * Every lb-bot query answer, in memory and on disk (R28): the old account's listening, Fresh
     * with its plays, overrides - none of it is the new account's to see.
     */
    clearLbQueries: () => void;
    clearMirror: () => void;
    clearSavedQueues: () => void;
    /** Connect is on and an address is set: a sign-in has somewhere to go. */
    hubOn: () => boolean;
    signIn: () => Promise<unknown>;
    /** Sign out of the hub and leave the transport down. */
    signOut: () => Promise<void>;
}

/**
 * A Navidrome logout signs the device out of the Worbus Server (the owner's 2026-11-02 answer)
 * and drops what the old account left here: the lb-bot mirror, the fill ledger and the saved-queue
 * cache, which
 * the next welcome would otherwise push up into the new account's space. A switch then signs in
 * again with the new server's account; its refusal (`navidrome_refused`) is what the Server tab
 * shows.
 */
export const followAccount = async (
    change: AccountChange,
    deps: AccountFollowDeps,
): Promise<void> => {
    if (change === 'none') return;
    await deps.signOut();
    deps.clearMirror();
    deps.clearSavedQueues();
    deps.clearFills();
    deps.clearLbQueries();
    if (change === 'switch' && deps.hubOn()) await deps.signIn();
};

/**
 * {@link followAccount}, one change at a time (review M7): two quick switches would otherwise
 * interleave their sign-outs and sign-ins, and the last to answer would win.
 */
export const createAccountFollower = (
    deps: AccountFollowDeps,
): ((change: AccountChange) => Promise<void>) => {
    let queue: Promise<void> = Promise.resolve();
    return (change) => {
        queue = queue.then(
            () => followAccount(change, deps),
            () => followAccount(change, deps),
        );
        return queue;
    };
};
