import isElectron from 'is-electron';

import { hasTypedToken } from '/@/renderer/features/hub/utils/hub-credential';
import { createFoundTap } from '/@/renderer/features/hub/utils/hub-found-tap';
import { flushQueryPersister } from '/@/renderer/lib/app-query-persister';
import { queryClient } from '/@/renderer/lib/react-query';
import { useAuthStore, useHubStore, useSettingsStore } from '/@/renderer/store';
import { logger } from '/@/renderer/utils/logger';
import {
    createSilentSignIn,
    HubSignInResult,
    parseSubsonicPair,
    SignInPair,
    tokenAfterSignIn,
} from '/@/shared/utils/hub-signin';

/**
 * Worbus P2: signing this device in to the Worbus Server (design §6.5). The pair is the current
 * Navidrome server's stored `u`/`s`/`t`; main posts it and keeps the secret. Everything the UI
 * shows about it is in `hub.store` (`signingIn`, `signInResult`, `signedOut`).
 */

const hub = isElectron() ? window.api.hub : null;

/** The current Navidrome server's sign-in pair, or null (no server, or not a token credential). */
export const currentServerPair = (): null | SignInPair =>
    parseSubsonicPair(useAuthStore.getState().currentServer?.credential);

/** The current server's account name, for "Sign in as <name>". */
export const currentServerUsername = (): null | string => currentServerPair()?.username ?? null;

const post = async (pair: SignInPair): Promise<HubSignInResult> => {
    if (!hub) return { kind: 'noServer' };
    useHubStore.getState().actions.setStore({ signingIn: true });
    try {
        return await hub.signIn(pair);
    } catch (error) {
        logger.warn('[hub] sign-in call failed', { error: String(error) });
        return { kind: 'unreachable' };
    }
};

/**
 * R23: the typed hub token goes from the settings (main retired it already). Pushing the empty
 * field to main does not reconnect: the token was not in use.
 */
const clearTypedToken = (): void => {
    const { hub: config } = useSettingsStore.getState();
    if (!hasTypedToken(config)) return;
    useSettingsStore.getState().actions.setSettings({ hub: { token: '' } });
};

/**
 * R28: every lb-bot answer goes, in memory and on disk (the persister writes the snapshot again on
 * each 'removed' event). A read in flight for the old account is cancelled first, so it cannot
 * land afterwards. The other account's listening, Fresh with its plays and the overrides are not
 * this account's to see; the pages refetch.
 */
export const clearLbQueries = (): void => {
    void queryClient.cancelQueries({ queryKey: ['lbbot'] });
    queryClient.removeQueries({ queryKey: ['lbbot'] });
    // Re-review N5: the snapshot on disk without them now, not within the persister's 1 s
    // throttle - once the removal's batched cache notifications (a 0 ms timer) have reached it.
    setTimeout(flushQueryPersister, 0);
};

const apply = (result: HubSignInResult | null, silent: boolean): void => {
    const { setStore } = useHubStore.getState().actions;
    // Whatever the answer, no sign-in is owed any more: it was made.
    setStore({ authOwed: false });
    if (result !== null && tokenAfterSignIn(result.kind) === 'clear') clearTypedToken();
    if (result === null) {
        setStore({ signedOut: true, signingIn: false });
        return;
    }
    logger.info(`[hub] sign-in${silent ? ' (silent)' : ''}: ${result.kind}`);
    if (result.kind === 'signedIn') {
        setStore({
            // Walk B4: the transport restarts with the secret; "connecting" until its welcome,
            // not "Can't reach" counted from a settings push made long before.
            attemptAt: Date.now(),
            authSignedIn: true,
            signedOut: false,
            signingIn: false,
            signInResult: result,
            user: result.user,
        });
        return;
    }
    if (result.kind === 'oldServer') {
        // An older server does not do sign-in: main dropped any secret, the token field shows.
        setStore({ authSignedIn: false, signedOut: false, signingIn: false, signInResult: result });
        return;
    }
    // A failed silent sign-in leaves the device signed out (the status says so, review I2); a
    // failed tap says why it failed.
    setStore(
        silent
            ? { signedOut: true, signingIn: false, signInResult: result }
            : { signedOut: false, signingIn: false, signInResult: result },
    );
};

/** The Server tab's "Sign in as <name>". */
export const signInWithCurrentServer = async (): Promise<HubSignInResult> => {
    cancelSignInRetry();
    const pair = currentServerPair();
    const result: HubSignInResult = pair ? await post(pair) : { kind: 'noAccount' };
    apply(result, false);
    return result;
};

/**
 * The one silent sign-in after the server signed this device out (close 4005), or at start when a
 * memory-only secret was lost to a restart (R7). `welcome()` re-arms it.
 */
export const silentSignIn = createSilentSignIn({
    currentPair: currentServerPair,
    onOutcome: (result) => apply(result, true),
    signIn: post,
});

/**
 * "Sign out of this server": main closes the socket, posts `/hub/signout` and forgets the secret.
 * `reconnect: false` (a Navidrome logout, a server switch) leaves the transport down.
 */
export const signOutOfServer = async (opts: { reconnect: boolean }): Promise<void> => {
    const { setStore } = useHubStore.getState().actions;
    // R23 (b): the typed token goes with the secret (main retires it too): a signed-out device is
    // not connected, never the primary user through the shared token.
    clearTypedToken();
    cancelSignInRetry();
    // R28: what lb-bot answered this account is not the next one's.
    clearLbQueries();
    setStore({
        authOwed: false,
        authSignedIn: false,
        signedOut: false,
        signInResult: null,
        user: null,
    });
    if (!hub) return;
    try {
        await hub.signOut(opts);
    } catch (error) {
        logger.warn('[hub] sign-out call failed', { error: String(error) });
    }
};

/** Read main's view of this device's sign-in into the store; true when a sign-in is owed. */
export const refreshAuthState = async (): Promise<boolean> => {
    if (!hub) return false;
    try {
        const state = await hub.authState();
        useHubStore
            .getState()
            .actions.setStore({ authOwed: state.needsSignIn, authSignedIn: state.signedIn });
        return state.needsSignIn;
    } finally {
        useHubStore.getState().actions.setStore({ authKnown: true });
    }
};

let upgrading: null | Promise<void> = null;

/**
 * R31, R35: a device waiting on a sign-in (the hub unreachable, busy, its Navidrome down) has no
 * transport connecting in the background - it has no credential to connect with. It asks again
 * on its own, as the transport's backoff would have.
 */
const RETRY_SIGN_IN_MS = 30_000;
let retryTimer: null | ReturnType<typeof setTimeout> = null;
const WAITING = new Set<HubSignInResult['kind']>([
    'navidromeUnreachable',
    'tooManyAttempts',
    'unreachable',
]);

/** The waiting retry ends: a sign-out, a logout or a switch, or the user's own tap (R36 tidy-up). */
export const cancelSignInRetry = (): void => {
    if (retryTimer !== null) clearTimeout(retryTimer);
    retryTimer = null;
};

const retryLater = (kind: HubSignInResult['kind']): void => {
    cancelSignInRetry();
    if (!WAITING.has(kind)) return;
    retryTimer = setTimeout(() => {
        retryTimer = null;
        void reconcileSignIn();
    }, RETRY_SIGN_IN_MS);
};

/**
 * R23 (a), as R31 replaced it: a device holding a typed token and no secret signs in with the
 * current server's account before it connects. Signed in: the secret replaces the token for good.
 * Refused: the token is retired. An older server: the token is its credential there (the token
 * field shows), and only there. Anything else (unreachable, busy, Navidrome down, no account
 * here) leaves the device unconnected - main sends the token to no address that has not answered
 * OldServer - with that status shown, and the next connect (a settings push, the network coming
 * back, a launch) tries again. Main's answer decides whether one is due: never over a held or
 * owed secret.
 */
export const upgradeFromToken = async (): Promise<void> => {
    if (!hub || upgrading) return upgrading ?? undefined;
    const { hub: config } = useSettingsStore.getState();
    if (!config.enabled || !config.url.trim() || !hasTypedToken(config)) return;
    // This session already found an older server: it does not do sign-in.
    if (useHubStore.getState().signInResult?.kind === 'oldServer') return;
    const pair = currentServerPair();
    upgrading = (async () => {
        const state = await hub.authState();
        if (state.signedIn || state.needsSignIn) return;
        // R31: every answer is shown - the device is not connected until one works.
        const result: HubSignInResult = pair ? await post(pair) : { kind: 'noAccount' };
        logger.info(`[hub] sign-in from the token: ${result.kind}`);
        apply(result, false);
        retryLater(result.kind);
    })()
        .catch((error) => {
            logger.warn('[hub] sign-in from the token failed', { error: String(error) });
            useHubStore.getState().actions.setStore({ signingIn: false });
        })
        .finally(() => {
            upgrading = null;
        });
    return upgrading;
};

/**
 * After the hub settings are pushed (at start, and on every change): read main's view of the
 * sign-in, then - only with Connect on and an address (M4) - make the sign-in that is due: the one
 * silent sign-in a lost memory-only secret owes (R7), or the upgrade from a typed token (R23).
 */
export const reconcileSignIn = async (): Promise<void> => {
    if (!hub) return;
    const needsSignIn = await refreshAuthState().catch(() => false);
    const { hub: config } = useSettingsStore.getState();
    if (!config.enabled || !config.url.trim()) return;
    if (needsSignIn) return silentSignIn.signedOut();
    if (!useHubStore.getState().authSignedIn) return upgradeFromToken();
};

/**
 * Worbus P3 (design §6.4): a found server's "Sign in as <name>" (or an older one's "Use this
 * address"), on the Server tab and in the post-sign-in prompt: one tap saves its addresses as
 * found, sets `hub.url` to the tapped one, turns Connect on and signs in.
 */
export const signInToFound = createFoundTap({
    edit: (edit) => hub?.serverEdit(edit) ?? Promise.resolve(null),
    setHub: (patch) => useSettingsStore.getState().actions.setSettings({ hub: patch }),
    signIn: () => signInWithCurrentServer(),
    stopLooking: () => hub?.finderCancel(),
});
