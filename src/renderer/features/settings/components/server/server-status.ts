import type { HubSignInResult, HubUser } from '../../../../../shared/utils/hub-signin.ts';

import {
    DEFAULT_HUB_URL,
    hubConfiguredFrom,
    normaliseHubAddress as normaliseAddress,
} from '../../../../../shared/utils/hub-addresses.ts';
import { hasHubCredential } from '../../../hub/utils/hub-credential.ts';
import { SIGN_IN_REFUSAL_TEXT } from '../../../hub/utils/hub-failure.ts';

/**
 * The Server tab's words (F2). Pure (relative imports only) so `server-status.harness.ts` can run it.
 *
 * Everything here is read from state the app already holds: the settings (`hub.*`), the hub store
 * (`connected`, the refusal flag, the attempt time), `welcome.lb` through `useLbBotAvailable`, the
 * CLAP probe the sidebar already runs, and the station mode. Nothing asks the server anything.
 */

export { DEFAULT_HUB_URL };

/** How long after switching on (or changing the address or token) "connecting" is still true. */
export const CONNECT_GRACE_MS = 8000;

export type HubLink =
    | 'connected'
    | 'connecting'
    | 'notConfigured'
    | 'off'
    | 'refused'
    | 'unreachable';

export interface HubLinkInput {
    /** When this client last pushed its hub settings to the transport (start or any change). */
    attemptAt: number;
    /** The server answered the token with an `auth` error; cleared by the next welcome. */
    authRefused: boolean;
    connected: boolean;
    enabled: boolean;
    now: number;
    /** Worbus P2: main holds a device secret (a signed-in device has no typed token). */
    signedIn?: boolean;
    token: string;
    url: string;
}

/**
 * Whether anything was ever set. The stored address defaults to localhost, which looks like a
 * value but is not one, so a profile with the switch off, no token and the default address is
 * "not configured".
 */
export const isHubConfigured = (s: {
    enabled: boolean;
    signedIn?: boolean;
    token: string;
    url: string;
}): boolean =>
    hubConfiguredFrom({
        enabled: s.enabled,
        hasCredential: hasHubCredential(s, s.signedIn === true),
        url: s.url,
    });

export const hubLink = (i: HubLinkInput): HubLink => {
    if (i.enabled && i.connected) return 'connected';
    if (!i.enabled) return isHubConfigured(i) ? 'off' : 'notConfigured';
    // The untouched default shows as an empty field, so with no credential it is not an address
    // yet.
    if (
        i.url.trim() === '' ||
        (i.url === DEFAULT_HUB_URL && !hasHubCredential(i, i.signedIn === true))
    ) {
        return 'notConfigured';
    }
    if (i.authRefused) return 'refused';
    return i.now - i.attemptAt < CONNECT_GRACE_MS ? 'connecting' : 'unreachable';
};

export const statusSentence = (link: HubLink, address: string): string => {
    switch (link) {
        case 'connected':
            return `Connected to ${address}`;
        case 'connecting':
            return `Connecting to ${address}...`;
        case 'notConfigured':
            return "Not set up. Enter your Worbus Server's address, with Connect on.";
        case 'off':
            return 'Connect is off.';
        case 'refused':
            return 'The server refused the access token. Check it below.';
        case 'unreachable':
            return `Can't reach ${address}. This app keeps trying in the background.`;
    }
};

export interface CapabilityInput {
    /** The CLAP probe's cached answer; undefined until some other screen has run it (no line). */
    clap: boolean | undefined;
    /** `welcome.lb.available` (or the probe's answer for an older server), not refused. */
    libraryTools: boolean;
    /** The library tools answered 401: they refused this device. */
    libraryToolsRefused: boolean;
    /** Worbus P2: lb-bot is older than signed-in users, and this user is not the primary one. */
    libraryToolsTooOld?: boolean;
    /** Cast speakers the server lists (devices a client is bridging). */
    speakers: number;
    stations: 'fallback' | 'pending' | 'stations';
}

export interface CapabilityLine {
    id: 'audiomuse' | 'casting' | 'library' | 'stations';
    text: string;
}

export const capabilityLines = (i: CapabilityInput): CapabilityLine[] => {
    const lines: CapabilityLine[] = [
        {
            id: 'library',
            text: i.libraryToolsTooOld
                ? // R26: the cause, in the hub's own words - not a permission refusal.
                  "Library tools: this server's lb-bot is too old for signed-in users"
                : i.libraryToolsRefused
                  ? 'Library tools: the server refused this device'
                  : i.libraryTools
                    ? 'Library tools: ready'
                    : 'Library tools: not set up on this server',
        },
    ];
    // This tab only reads the AudioMuse probe's cached answer and never runs it, so until another
    // part of the app has asked, there is nothing to say: no line, rather than a "checking" that
    // could stay on screen for the whole session.
    if (i.clap !== undefined) {
        lines.push({
            id: 'audiomuse',
            text: i.clap
                ? 'AudioMuse: mood search is ready'
                : 'AudioMuse: mood search is not available',
        });
    }
    lines.push(
        {
            id: 'stations',
            // 'pending' always ends: the station service probes on every connection and that
            // request has a timeout, so it settles as stations or fallback.
            text:
                i.stations === 'pending'
                    ? 'Stations: checking'
                    : i.stations === 'stations'
                      ? 'Stations: ready'
                      : 'Stations: not available on this server. Autoplay runs on this computer instead.',
        },
        {
            id: 'casting',
            text:
                i.speakers > 0
                    ? `Casting: ${i.speakers} ${i.speakers === 1 ? 'speaker' : 'speakers'} on your network`
                    : 'Casting: no speakers found yet',
        },
    );
    return lines;
};

/** What the Address field shows: the untouched default is an empty field with a placeholder. */
export const addressFieldValue = (url: string, configured: boolean): string =>
    !configured && url === DEFAULT_HUB_URL ? '' : url;

/**
 * What gets stored for a typed address: the one rule both processes share (P3,
 * `shared/utils/hub-addresses.ts`: `ws://` added, `http(s)://` becomes `ws(s)://`, a trailing
 * `/connect` and `/` dropped, the path kept). Empty is the default; a value the rule cannot read
 * (another scheme) is kept as typed, as before, and the transport fails on it visibly.
 */
export const normaliseHubAddress = (input: string): string => {
    const value = input.trim();
    if (value === '') return DEFAULT_HUB_URL;
    return normaliseAddress(value) ?? value;
};

// --- Worbus P2: signing in (design §6.2, §6.5) ---------------------------------------------------

export type ServerStatusId =
    | 'badRequest'
    | 'navidromeRefused'
    | 'navidromeUnreachable'
    | 'noAccount'
    | 'notSignedIn'
    | 'oldServer'
    | 'signedIn'
    | 'signedOut'
    | 'signingIn'
    | 'tooManyAttempts'
    | HubLink;

export interface SignInInput {
    /** Main has answered what it holds (`hub.store.authKnown`); absent reads as known. */
    authKnown?: boolean;
    /** A token is typed (the field shown for older servers, or one kept from before). */
    hasToken: boolean;
    /** The last sign-in's answer this session (`hub.store.signInResult`). */
    result: HubSignInResult | null;
    /** Main holds a device secret (`hub.store.authSignedIn`). */
    signedIn: boolean;
    /** The server signed this device out and the silent sign-in did not work. */
    signedOut: boolean;
    signingIn: boolean;
    /** `welcome.user` / the `user` frame: who the connection acts for. */
    user: HubUser | null;
    /** The current music server's account name, or null when there is none to sign in with. */
    username: null | string;
}

const REFUSED_SIGN_IN = new Set<HubSignInResult['kind']>([
    'badRequest',
    'navidromeRefused',
    'navidromeUnreachable',
    'noAccount',
    'tooManyAttempts',
]);

/**
 * The one status the line shows. A refusal of the last sign-in outranks the link (it says why
 * the link is what it is); a link that works says who it acts for; a device with no secret and no
 * token is "not signed in", never "connecting" - the transport has nothing to connect with.
 */
export const serverStatus = (link: HubLink, s: SignInInput): ServerStatusId => {
    if (link === 'notConfigured') return link;
    if (s.signingIn) return 'signingIn';
    // Design §6.5: the server signed this device out and the silent sign-in did not work - that
    // is the state, whatever the silent attempt was answered (review I2).
    if (s.signedOut && link !== 'connected' && link !== 'off') return 'signedOut';
    if (s.result && !s.signedIn && REFUSED_SIGN_IN.has(s.result.kind)) {
        return s.result.kind as ServerStatusId;
    }
    if (link === 'off') return link;
    if (link === 'connected') {
        if (s.signedIn && s.user) return 'signedIn';
        // Walk B5: a connection with neither a secret nor a token is one being torn down (Sign
        // out clears the secret before the transport says so; main never connects without a
        // credential). Not "Connected". Before main has answered, a welcome is believed.
        if (s.authKnown !== false && !s.signedIn && !s.hasToken) return 'notSignedIn';
        return 'connected';
    }
    if (s.result?.kind === 'oldServer' && !s.hasToken) return 'oldServer';
    if (!s.signedIn && !s.hasToken) return 'notSignedIn';
    return link;
};

export const serverStatusSentence = (
    id: ServerStatusId,
    address: string,
    s: SignInInput,
): string => {
    switch (id) {
        case 'badRequest':
            return 'The Worbus Server could not read this sign-in. Try again.';
        case 'navidromeRefused':
            return SIGN_IN_REFUSAL_TEXT.navidromeRefused;
        case 'navidromeUnreachable':
            return SIGN_IN_REFUSAL_TEXT.navidromeUnreachable;
        case 'noAccount':
            return 'There is no music server account to sign in with. Sign in to your Navidrome server first.';
        case 'notSignedIn':
            return s.username
                ? `Not signed in. Sign in as ${s.username} below to connect.`
                : 'Not signed in. Sign in to your Navidrome server first, then sign in here.';
        case 'oldServer':
            return 'This Worbus Server is older and has no sign-in. Enter its access token under Advanced.';
        case 'signedIn':
            return s.user?.admin
                ? `Signed in as ${s.user.name} · admin`
                : `Signed in as ${s.user?.name ?? ''}`;
        case 'signedOut':
            return SIGN_IN_REFUSAL_TEXT.signedOut;
        case 'signingIn':
            return s.username ? `Signing in as ${s.username}...` : 'Signing in...';
        case 'tooManyAttempts':
            return SIGN_IN_REFUSAL_TEXT.tooManyAttempts;
        default:
            return statusSentence(id, address);
    }
};

/** The token field ("Server token, for older servers") exists only after an older server (R6). */
export const showTokenField = (result: HubSignInResult | null): boolean =>
    result?.kind === 'oldServer';
