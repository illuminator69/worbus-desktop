import type {
    HubAuthState,
    HubSignInResult,
    HubUser,
    SignInFailure,
    SignInPair,
} from '/@/shared/utils/hub-signin';

/**
 * Worbus P2: this device's credential for the Worbus Server (design §6.2, §6.5).
 *
 * The hub issues a device secret at `POST /hub/signin` in exchange for the current Navidrome
 * server's `u`/`s`/`t`. The secret lives here, in main, only:
 *   - encrypted with `safeStorage` into electron-store (`hubAuth.secret`, hex ciphertext);
 *   - or, where the OS offers no encryption (R7), in memory only, with a marker that a silent
 *     sign-in is owed after a restart.
 * Nothing that leaves main carries it: the IPC answers are `HubSignInResult` / `HubAuthState`,
 * whose types have no slot for it.
 *
 * Pure apart from what `HubAuthDeps` hands in, and import-free except for types, so
 * `auth.harness.ts` runs it under `node --test` with a fake hub, store and vault. `index.ts`
 * wires it to Electron.
 */

/** electron-store key: the secret's ciphertext (hex). Never written in plain. */
export const SECRET_KEY = 'hubAuth.secret';
/**
 * electron-store key: this device signed in and has not been signed out by its user. While set,
 * the shared token is not used as a fallback: a device the server signed out says so instead of
 * quietly becoming the primary user through the token.
 */
export const SIGNED_IN_KEY = 'hubAuth.signedIn';
/**
 * electron-store key: the typed token is retired (R23). The legacy hub token is an upgrade bridge,
 * not a fallback: once a sign-in has worked, or Navidrome refused this account, or the user signed
 * out (a "Sign out of this server", a Navidrome logout, a server switch), it is never sent again -
 * a device that was signed out, refused or switched would otherwise reconnect silently as the
 * primary user, in the owner's space. Only an older server's answer (R6, R24) brings it back.
 */
export const TOKEN_RETIRED_KEY = 'hubAuth.tokenRetired';

/**
 * electron-store key (R31): the hub addresses (`http(s)://host:port`) that answered OldServer - 404,
 * 405, a 2xx or 4xx that is not the sign-in JSON, or a 4001 to a secret hello (R24). The typed
 * token is sent only to one of these. Anywhere else a device holding a token and no secret
 * connects only after a sign-in works: a 429 or an unreachable Navidrome must not connect a
 * non-primary account on the shared token as the primary user (anti-goal §4).
 */
export const OLD_SERVERS_KEY = 'hubAuth.oldServers';
const OLD_SERVERS_MAX = 8;
/**
 * electron-store key (R27): the hub device id each account was given, by (hub address, account
 * name normalised as the hub keys users). R4 adopts the id a sign-in answers with; with one slot
 * for every account a switch back offered the other account's id and the hub minted another, so
 * ghost rows piled up in each user's pickers. `hub.deviceId` stays the current one (the hello,
 * `bridgedBy`); this map is what a sign-in offers.
 */
export const DEVICE_IDS_KEY = 'hub.deviceIds';

/**
 * electron-store key (re-review N4): the device id from before per-account ids, not yet claimed by
 * an account - offered at each sign-in that has no id of its own, until the hub keeps it.
 */
export const LEGACY_DEVICE_ID_KEY = 'hub.deviceIdLegacy';

/** The account part of a device-id key: trimmed, NFC, lower-cased (as the renderer compares). */
const accountName = (name: string): string => name.normalize('NFC').trim().toLowerCase();

/** The hub gives Navidrome 8 s for its check; past this it is not answering. */
export const SIGNIN_TIMEOUT_MS = 15_000;
const SIGNOUT_TIMEOUT_MS = 5_000;

export interface HubAuthDeps {
    /** What the sign-in names this device: the stored hub id and how it shows in pickers. */
    device: () => { id: string; kind: string; name: string; platform: string };
    fetch: (
        url: string,
        init: {
            body?: string;
            headers: Record<string, string>;
            method: string;
            signal?: AbortSignal;
        },
    ) => Promise<{ status: number; text: () => Promise<string> }>;
    /** `http(s)://host:port` of the Worbus Server, or null when no address is set. */
    httpBase: () => null | string;
    /** The typed token (older servers). Empty when none. */
    legacyToken: () => string;
    log: { info: (message: string) => void; warn: (message: string) => void };
    /** R4: the id the hub answered with becomes this device's hub id. */
    setDeviceId: (id: string) => void;
    store: {
        delete: (key: string) => void;
        get: (key: string) => unknown;
        set: (key: string, value: unknown) => void;
    };
    vault: {
        available: () => boolean;
        decrypt: (hex: string) => string;
        encrypt: (text: string) => string;
    };
}

/**
 * `ws://host:4790/connect` → `http://host:4790`, the path kept. Null for an empty address. P3: the
 * one normaliser (`shared/utils/hub-addresses.ts`); index.ts hands `httpBase` the active address.
 */
export { httpBaseOfAddress as httpBaseOf } from '../../../../shared/utils/hub-addresses.ts';

const parseUser = (raw: unknown): HubUser | null => {
    if (typeof raw !== 'object' || raw === null) return null;
    const { admin, name, primary } = raw as Record<string, unknown>;
    if (typeof name !== 'string' || typeof admin !== 'boolean' || typeof primary !== 'boolean') {
        return null;
    }
    return { admin, name, primary };
};

const REFUSALS: Record<string, { code: string; kind: SignInFailure }> = {
    400: { code: 'bad_request', kind: 'badRequest' },
    401: { code: 'navidrome_refused', kind: 'navidromeRefused' },
    429: { code: 'too_many_attempts', kind: 'tooManyAttempts' },
    503: { code: 'navidrome_unreachable', kind: 'navidromeUnreachable' },
};

/**
 * One answer of `/hub/signin`, by R6: a refusal is its code; any other 5xx is unreachable, whatever
 * its body; 404, 405, and a 2xx or 4xx that is not this route's JSON (an HTML page, a 200 without a
 * secret) is an older server.
 */
export const classifySignIn = (
    status: number,
    body: string,
): { result: HubSignInResult; secret?: string } => {
    let parsed: unknown = null;
    try {
        parsed = JSON.parse(body);
    } catch {
        parsed = null;
    }
    const obj =
        typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
    if (status === 200) {
        const user = parseUser(obj.user);
        const { deviceId, deviceSecret } = obj;
        if (
            typeof deviceId === 'string' &&
            deviceId &&
            typeof deviceSecret === 'string' &&
            deviceSecret &&
            user
        ) {
            return { result: { deviceId, kind: 'signedIn', user }, secret: deviceSecret };
        }
        return { result: { kind: 'oldServer' } };
    }
    const refusal = REFUSALS[status];
    if (refusal && obj.code === refusal.code) return { result: { kind: refusal.kind } };
    // R6 clarification: any other 5xx is a gateway failure (a reverse proxy's 502, 503 or 504
    // page), never an older hub - it keeps the token and is tried again.
    if (status >= 500) return { result: { kind: 'unreachable' } };
    return { result: { kind: 'oldServer' } };
};

/** What may cross to the renderer: an allow-listed copy, so no field can ride along. */
export const publicResult = (result: HubSignInResult): HubSignInResult =>
    result.kind === 'signedIn'
        ? {
              deviceId: result.deviceId,
              kind: 'signedIn',
              user: {
                  admin: result.user.admin,
                  name: result.user.name,
                  primary: result.user.primary,
              },
          }
        : { kind: result.kind };

export interface HubAuth {
    /** The secret, else the typed token at an older server only (R23, R31); else null. */
    bearer: () => null | string;
    /** What a `hello` carries: the secret, or the legacy token. */
    helloCredential: () => { auth: { deviceSecret: string } } | { token: string };
    /** Read the stored secret (start-up). */
    load: () => void;
    /**
     * R35: a `welcome` naming a user came from this address - a hub of this round (upgraded in
     * place). It is no older server: the token is not sent there again.
     */
    newServer: () => void;
    /**
     * An older server (R6; R24: a 4001 answering a hello that carried the secret): the secret is no
     * use there, no sign-in is owed, and the typed token is the credential again. Also at an
     * address that welcomed with a user this launch: R36 covers sign-in answers only, and a 4001
     * to a secret hello means the hub was rolled back to P1 (whose welcome names no user).
     */
    oldServer: () => void;
    /** The hub refused the secret (close 4005 / `signed_out`): forget it; a sign-in is owed. */
    signedOutByServer: () => void;
    signIn: (pair: SignInPair) => Promise<HubSignInResult>;
    /** `POST /hub/signout`, best effort, then forget the secret for good. */
    signOut: () => Promise<void>;
    state: () => HubAuthState;
}

export const createHubAuth = (deps: HubAuthDeps): HubAuth => {
    let secret: null | string = null;

    const memoryOnly = () => !deps.vault.available();
    const marked = () => deps.store.get(SIGNED_IN_KEY) === true;
    const retired = () => deps.store.get(TOKEN_RETIRED_KEY) === true;
    const oldServers = (): string[] => {
        const stored = deps.store.get(OLD_SERVERS_KEY);
        return Array.isArray(stored)
            ? stored.filter((x): x is string => typeof x === 'string')
            : [];
    };
    /**
     * R35: an OldServer verdict is about one moment. The persisted list says where to try the
     * token at all; it is used only once this launch has itself been answered OldServer there (one
     * 405 POST per launch on a P1 hub), so a hub upgraded in place is found at the next launch.
     */
    const answeredThisLaunch = new Set<string>();
    /**
     * R36: addresses that sent a `welcome` naming a user this launch - hubs of this round. An
     * OldServer answer from one (a proxy that does not forward /hub/*, say) is not believed: it
     * reads as unreachable, so a P2 welcome and an older-hub answer cannot hand the token back
     * and forth (restart, welcome, restart...) with no back-off.
     */
    const p2ThisLaunch = new Set<string>();
    const atP2Hub = () => {
        const base = deps.httpBase();
        return base !== null && p2ThisLaunch.has(base);
    };
    const atOldServer = () => {
        const base = deps.httpBase();
        return base !== null && answeredThisLaunch.has(base) && oldServers().includes(base);
    };
    const noteOldServer = (older: boolean) => {
        const base = deps.httpBase();
        if (!base) return;
        if (older) answeredThisLaunch.add(base);
        else answeredThisLaunch.delete(base);
        const rest = oldServers().filter((x) => x !== base);
        const next = older ? [...rest, base].slice(-OLD_SERVERS_MAX) : rest;
        if (next.length) deps.store.set(OLD_SERVERS_KEY, next);
        else deps.store.delete(OLD_SERVERS_KEY);
    };
    /**
     * The typed token: only for an address that answered OldServer (R31), and never once retired
     * (R23) or while this device holds a sign-in.
     */
    const token = () => (retired() || marked() || !atOldServer() ? '' : deps.legacyToken());
    const retire = () => deps.store.set(TOKEN_RETIRED_KEY, true);

    const keep = (value: string) => {
        secret = value;
        deps.store.set(SIGNED_IN_KEY, true);
        if (memoryOnly()) {
            // R7: nothing is written in plain anywhere; a restart owes a silent sign-in.
            deps.store.delete(SECRET_KEY);
            return;
        }
        deps.store.set(SECRET_KEY, deps.vault.encrypt(value));
    };

    const drop = (final: boolean) => {
        secret = null;
        deps.store.delete(SECRET_KEY);
        if (final) deps.store.delete(SIGNED_IN_KEY);
    };

    return {
        bearer: () => secret ?? (token() || null),

        helloCredential: () => (secret ? { auth: { deviceSecret: secret } } : { token: token() }),

        load: () => {
            secret = null;
            const stored = deps.store.get(SECRET_KEY);
            if (typeof stored !== 'string' || !stored) return;
            if (memoryOnly()) {
                deps.store.delete(SECRET_KEY);
                return;
            }
            try {
                const value = deps.vault.decrypt(stored);
                if (value) secret = value;
            } catch (error) {
                // A keyring that changed, or a profile copied to another machine. The marker
                // stays, so one silent sign-in replaces it.
                deps.log.warn(
                    `[hub] the stored device credential could not be read (${String(error)}) - a sign-in is owed`,
                );
                deps.store.delete(SECRET_KEY);
            }
        },

        newServer: () => {
            const base = deps.httpBase();
            if (base) p2ThisLaunch.add(base);
            noteOldServer(false);
        },

        oldServer: () => {
            const base = deps.httpBase();
            if (base) p2ThisLaunch.delete(base);
            drop(true);
            deps.store.delete(TOKEN_RETIRED_KEY);
            noteOldServer(true);
        },

        signedOutByServer: () => {
            if (secret) deps.log.warn('[hub] the Worbus Server signed this device out');
            drop(false);
        },

        signIn: async (pair) => {
            const base = deps.httpBase();
            if (!base) return { kind: 'noServer' };
            const device = deps.device();
            const idKey = JSON.stringify([base, accountName(pair.username)]);
            const stored = deps.store.get(DEVICE_IDS_KEY);
            const firstRead = typeof stored !== 'object' || stored === null;
            const ids: Record<string, string> = firstRead
                ? {}
                : { ...(stored as Record<string, string>) };
            // Re-review N4: today's single slot is the id of whichever account it was registered
            // under - not necessarily the one signing in first after the upgrade (bob on the
            // owner's computer, or another hub). It is kept unclaimed and offered to every sign-in
            // that has no id of its own, and becomes an account's only when the hub hands that same
            // id back (R4: the hub keeps a user's own id and mints for anyone else).
            if (firstRead) deps.store.set(LEGACY_DEVICE_ID_KEY, device.id);
            const legacy = deps.store.get(LEGACY_DEVICE_ID_KEY);
            const unclaimed = typeof legacy === 'string' && legacy ? legacy : undefined;
            const offered = typeof ids[idKey] === 'string' && ids[idKey] ? ids[idKey] : unclaimed;
            let status: number;
            let body: string;
            try {
                const res = await deps.fetch(`${base}/hub/signin`, {
                    body: JSON.stringify({
                        deviceId: offered,
                        kind: device.kind,
                        name: device.name,
                        platform: device.platform,
                        salt: pair.salt,
                        token: pair.token,
                        username: pair.username,
                    }),
                    headers: { 'Content-Type': 'application/json' },
                    method: 'POST',
                    signal: AbortSignal.timeout(SIGNIN_TIMEOUT_MS),
                });
                status = res.status;
                body = await res.text();
            } catch (error) {
                // Refused, timed out or dropped: unreachable, never an older server (R6).
                const cause = (error as { cause?: { code?: string } }).cause;
                deps.log.warn(
                    `[hub] sign-in: no answer from the Worbus Server (${(error as Error).name}` +
                        `${cause?.code ? ` ${cause.code}` : ''})`,
                );
                return { kind: 'unreachable' };
            }
            const classified = classifySignIn(status, body);
            // R36: this address welcomed with a user this launch - its older-hub answer is a
            // gateway's, not the hub's. Unreachable: the status line and the renderer's retry.
            const { result, secret: issued } =
                classified.result.kind === 'oldServer' && atP2Hub()
                    ? { result: { kind: 'unreachable' as const }, secret: undefined }
                    : classified;
            // R23: a sign-in that worked, or an account Navidrome refused, ends the typed token
            // (the same rule as the renderer's `tokenAfterSignIn`; this file stays import-free).
            if (result.kind === 'signedIn' || result.kind === 'navidromeRefused') retire();
            if (result.kind === 'signedIn' && issued) {
                keep(issued);
                // An address that signs in is not an older server any more (an upgraded hub).
                noteOldServer(false);
                deps.setDeviceId(result.deviceId);
                deps.store.set(DEVICE_IDS_KEY, { ...ids, [idKey]: result.deviceId });
                if (unclaimed && result.deviceId === unclaimed) {
                    deps.store.delete(LEGACY_DEVICE_ID_KEY);
                }
                deps.log.info(
                    `[hub] signed in as ${result.user.name} (admin=${result.user.admin}, ` +
                        `primary=${result.user.primary}); device credential length ${issued.length}` +
                        `${memoryOnly() ? ', kept in memory only (no OS encryption)' : ''}`,
                );
            } else {
                deps.log.warn(`[hub] sign-in answered ${status}: ${result.kind}`);
                // An older server does not do sign-in: a secret from another one is no use there,
                // and the token is its credential.
                if (result.kind === 'oldServer') {
                    drop(true);
                    deps.store.delete(TOKEN_RETIRED_KEY);
                    noteOldServer(true);
                }
            }
            return publicResult(result);
        },

        signOut: async () => {
            const held = secret;
            const base = deps.httpBase();
            drop(true);
            // R23 (b): the user's sign-out (and a Navidrome logout, a server switch) ends the typed
            // token as well - with only a token, it is the token being signed out.
            retire();
            if (!held || !base) return;
            try {
                const res = await deps.fetch(`${base}/hub/signout`, {
                    headers: { Authorization: `Bearer ${held}` },
                    method: 'POST',
                    signal: AbortSignal.timeout(SIGNOUT_TIMEOUT_MS),
                });
                deps.log.info(`[hub] signed out of the Worbus Server (${res.status})`);
            } catch (error) {
                deps.log.warn(
                    `[hub] sign-out did not reach the Worbus Server (${(error as Error).name}); forgotten here`,
                );
            }
        },

        state: () => ({
            memoryOnly: memoryOnly(),
            needsSignIn: !secret && marked(),
            signedIn: Boolean(secret),
        }),
    };
};
