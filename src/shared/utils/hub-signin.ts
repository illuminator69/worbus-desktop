/**
 * Worbus P2: signing this device in to the Worbus Server with the Navidrome account (design
 * §6.2, §6.5). Pure and import-free, so main (`main/features/core/hub/auth.ts`) and the renderer
 * share the types and `auth.harness.ts` can run every function here.
 *
 * The device secret itself never appears in this file's types: main keeps it, and nothing that
 * crosses to the renderer has a field that could carry it.
 */

/** What main says about this device's sign-in. Never the secret. */
export interface HubAuthState {
    /** The secret lives in memory only: this machine offers no OS encryption (R7). */
    memoryOnly: boolean;
    /**
     * Signed in before, but no secret is here now (memory only and restarted, the stored one could
     * not be read, or the server signed this device out). One silent sign-in is owed.
     */
    needsSignIn: boolean;
    /** A device secret is held. */
    signedIn: boolean;
}

export type HubSignInResult =
    | { deviceId: string; kind: 'signedIn'; user: HubUser }
    | { kind: SignInFailure };

/** Who a hub connection acts for: `welcome.user` and the `user` frame. */
export interface HubUser {
    admin: boolean;
    name: string;
    primary: boolean;
}

/**
 * - `navidromeRefused`, `navidromeUnreachable`, `tooManyAttempts`, `badRequest`: the hub's
 *   refusals (401, 503, 429, 400 with their codes).
 * - `oldServer`: 404, 405, or an answer that is not this route's JSON (R6). The token field.
 * - `unreachable`: the hub did not answer at all (refused, timed out, dropped). Never `oldServer`.
 * - `noAccount`: this app holds no Navidrome pair to send (no current server, or not a token
 *   credential). `noServer`: no Worbus Server address is set.
 */
export type SignInFailure =
    | 'badRequest'
    | 'navidromeRefused'
    | 'navidromeUnreachable'
    | 'noAccount'
    | 'noServer'
    | 'oldServer'
    | 'tooManyAttempts'
    | 'unreachable';

/** Subsonic token auth for one Navidrome account: `token = md5(password + salt)`. */
export interface SignInPair {
    salt: string;
    token: string;
    username: string;
}

/**
 * The current server's `u`/`s`/`t`, read from the credential the Navidrome login stored
 * (`u=<username>&s=<salt>&t=<token>`, navidrome-controller.ts `authenticate`). The username is
 * stored as typed, unescaped, so it is everything between `u=` and the last `&s=`. Anything else
 * (a password credential, a Jellyfin token, an empty one after logout) is no pair.
 */
export const parseSubsonicPair = (credential: null | string | undefined): null | SignInPair => {
    if (typeof credential !== 'string' || !credential.startsWith('u=')) return null;
    const match = /^u=(.*)&s=([^&]*)&t=([^&]*)$/s.exec(credential);
    if (!match) return null;
    const [, username, salt, token] = match;
    if (!username.trim() || salt.length < 6 || !/^[0-9a-f]{32}$/.test(token)) return null;
    return { salt, token, username };
};

/** `welcome.user` / the `user` frame / the sign-in answer's `user`, or null when malformed. */
export const parseHubUser = (raw: unknown): HubUser | null => {
    if (typeof raw !== 'object' || raw === null) return null;
    const { admin, name, primary } = raw as Record<string, unknown>;
    if (typeof name !== 'string' || typeof admin !== 'boolean' || typeof primary !== 'boolean') {
        return null;
    }
    return { admin, name, primary };
};

export interface SilentSignIn {
    /** Signed out by the server (or owed a sign-in at start). Resolves when settled. */
    signedOut: () => Promise<void>;
    /** A `welcome` arrived: the connection works, and the next signed-out earns a new try. */
    welcome: () => void;
}

/**
 * Close 4005, or the `signed_out` error before it: the client makes ONE silent sign-in with the
 * current server's account (design §6.5). A second signed-out before the next `welcome` (the
 * hub refused the fresh secret too, or there was no account) is not answered with another try:
 * the status says "Signed out of the Worbus Server" and waits for the user's Sign in.
 *
 * Two triggers that arrive together (the start-up check of a memory-only secret, and the 4005
 * of the hello that went out without one) share the attempt in flight.
 */
export interface SilentSignInDeps {
    currentPair: () => null | SignInPair;
    /** The attempt's outcome; `null` when the one silent try was already spent. */
    onOutcome: (result: HubSignInResult | null) => void;
    signIn: (pair: SignInPair) => Promise<HubSignInResult>;
}

export const createSilentSignIn = (deps: SilentSignInDeps): SilentSignIn => {
    let spent = false;
    let inFlight: null | Promise<void> = null;
    return {
        signedOut: () => {
            if (inFlight) return inFlight;
            if (spent) {
                deps.onOutcome(null);
                return Promise.resolve();
            }
            const pair = deps.currentPair();
            if (!pair) {
                deps.onOutcome({ kind: 'noAccount' });
                return Promise.resolve();
            }
            spent = true;
            const attempt = deps
                .signIn(pair)
                .then(
                    (result) => deps.onOutcome(result),
                    () => deps.onOutcome({ kind: 'unreachable' }),
                )
                .finally(() => {
                    inFlight = null;
                });
            inFlight = attempt;
            return attempt;
        },
        welcome: () => {
            spent = false;
        },
    };
};

/**
 * R23: what a sign-in's answer does to the typed (legacy) hub token. It is an upgrade bridge, not a
 * fallback: a sign-in that worked replaces it for good, and an account the server's Navidrome
 * refused must not reach the hub through it as the primary user. Every other answer keeps it: an
 * older server uses it, and after an unreachable or busy answer the next sign-in still needs it
 * to tell an older server apart (R31: main sends it only to an address that answered OldServer).
 * Main retires it (`hubAuth`), the renderer clears the field.
 */
export const tokenAfterSignIn = (kind: HubSignInResult['kind']): 'clear' | 'keep' =>
    kind === 'signedIn' || kind === 'navidromeRefused' ? 'clear' : 'keep';
