import type { LbBotStatus } from '/@/shared/types/lbbot-types';
import type { HubFinderState, HubServerRecord } from '/@/shared/utils/hub-addresses';
import type { HubSignInResult, HubUser } from '/@/shared/utils/hub-signin';
import type { LbIndexProgress } from '/@/shared/utils/lbbot-mode';

import isElectron from 'is-electron';
import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';

import { ActPins, NO_PINS } from '/@/renderer/features/hub/utils/act-pins';
import { credentialPending, HubRoles, rolesOf } from '/@/renderer/features/hub/utils/hub-roles';
import { SessionSleepTimer } from '/@/renderer/features/hub/utils/sleep-timer';

/**
 * Live navi-connect state for the UI (device picker + remote playerbar). Fed by
 * use-hub.tsx from the hub's `welcome`/`session`/`devices`/`progress` frames.
 * Not persisted — it's a mirror of transient hub state.
 */
export interface HubDevice {
    /** Cast bridges only: is the receiver app currently up on the speaker? */
    appRunning?: boolean | null;
    /** For a virtual device (a Chromecast), the hub id of the client bridging it. */
    bridgedBy?: null | string;
    caps: string[];
    id: string;
    isActive: boolean;
    /**
     * What the device is, as it said in `hello`: `computer`, `phone`, `tablet`, `speaker`, `tv`
     * or `group`. Absent from a client that does not say, and a later protocol may add values:
     * the picker draws its generic icon for both (device-rows.ts).
     */
    kind?: null | string;
    name: string;
    /**
     * A WebSocket claiming this id is attached. For a bridged Chromecast that is the
     * BRIDGE's socket — it says nothing about the speaker. See `reachable`.
     */
    online: boolean;
    platform: string;
    /**
     * The bridge's verdict on the hardware (PROTOCOL §3.2): `true` reached recently,
     * `false` connected-but-not-answering, `null`/absent unknown or not applicable —
     * which is every ordinary client, since a client IS its own hardware.
     */
    reachable?: boolean | null;
    /** 0..100: the level the device last reported, else the one it was last told. */
    volume?: number;
}

/** Can the session be handed to this device right now? Unknown reachability is permissive. */
export const isHubDeviceTransferable = (device: HubDevice): boolean =>
    device.online && device.reachable !== false;

/** Worbus P3: what main says about the Worbus Server's addresses (preload `HubServerState`). */
export interface HubServerState {
    activeAddress: null | string;
    record: HubServerRecord;
}

export interface HubTrack {
    album?: string;
    /** Navidrome album id. Additive on the wire and absent from any publisher that
     *  doesn't send it — without it the receiving client's playerbar has only the
     *  album *name*, so the album title cannot be a link until getSongDetail lands. */
    albumId?: string;
    artist?: string;
    /** Per-artist ids, for the same reason as `albumId`. Track artists, so they link
     *  to the artist route rather than the album-artist one. */
    artists?: { id: string; name: string }[];
    durationMs?: number;
    favorite?: boolean;
    id: string;
    imageUrl?: null | string;
    rating?: null | number;
    title?: string;
}

interface HubSlice extends HubState {
    actions: {
        /**
         * Apply a local rating/favorite edit to the mirrored remote queue.
         *
         * **Why this exists.** While playback is on another device every
         * user-visible field of the playing song is read off `remoteQueue` /
         * `remoteNowPlaying` here, not off `player.store`. The rating and
         * favorite mutations publish their optimistic update as a `USER_RATING`
         * / `USER_FAVORITE` event, and the only listener for those calls
         * `updateQueueRatings` on the **player** store — which nothing is
         * reading while remote is active. So the write succeeded, the server
         * took it, and the stars did not move until the remote device happened
         * to republish its queue. That delay is the whole of "the rating does
         * show up eventually".
         *
         * The hub is still the authority: the next `session` frame overwrites
         * this wholesale, exactly as an optimistic cache update is meant to be
         * overwritten by the real answer.
         */
        patchRemoteTracks: (
            ids: string[],
            patch: Partial<Pick<HubTrack, 'favorite' | 'rating'>>,
        ) => void;
        reset: () => void;
        setStore: (data: Partial<HubState>) => void;
    };
}

interface HubState {
    activeDeviceId: null | string;
    /**
     * The play state, position and volume this client has just commanded, shown over the
     * mirror below until the hub acknowledges the act that carried them (I-031, act-pins.ts).
     * Written by remote-queue's sendAct, released by use-hub on `ack`, cleared at `welcome`
     * and when the socket is lost. Always empty against a hub without `actAck`.
     */
    actPins: ActPins;
    /**
     * F2: when this client last pushed its hub settings to the transport (on start and on any
     * change of the switch, address, token or name). "Connecting" is the first few seconds after
     * it; after that a link that is still down reads as unreachable (server-status.ts).
     */
    attemptAt: number;
    /**
     * Worbus P2 (re-review N1): main has answered `hub-auth-state` once (or failed to). Until then
     * a signed-in device looks like one with no credential; roles stay least privilege meanwhile.
     */
    authKnown: boolean;
    /**
     * Worbus P2: a sign-in is owed and the silent one is under way (main's `needsSignIn` at start,
     * or the server's 4005). Counts as holding a credential (hub-credential.ts) until it answers.
     */
    authOwed: boolean;
    /**
     * F2: the hub answered this connection's token with an `auth` error (the same frame that
     * raises the toast). The transport stands down on it, so nothing else would say why the link
     * is down: the Server tab reads it for "the server refused the access token". Cleared by
     * `welcome` and whenever the hub settings are pushed again.
     */
    authRefused: boolean;
    /**
     * Worbus P2: main holds a device secret for this server (`hub-auth-state`, then each sign-in,
     * sign-out and server sign-out). The Server tab's Sign in / Sign out rows read it.
     */
    authSignedIn: boolean;
    connected: boolean;
    devices: HubDevice[];
    /**
     * What this hub does beyond the base protocol, from `welcome.features`. `actAck`: it
     * answers every `act` that carries a `cid` with an `ack`. `volumeTarget`: an `act:volume`
     * may name the device it is for. `sleepTimer`: it holds the session's sleep timer. Empty
     * for an older hub, which sends no such field, and while there is no connection.
     */
    features: string[];
    /** Worbus P3: main's finder (`hub-finder-state`): looking, what it found, or why nothing. */
    finder: HubFinderState;
    /**
     * Worbus P1: lb-bot's index build countdown, from `welcome.lbIndex.progress` and each
     * `index` frame's. Null when the last one carried none (an older peer, or the build is
     * long over). Read only by the Home bar (`useLbBotIndexProgress`). Not persisted.
     */
    lbProgress: LbIndexProgress | null;
    /**
     * Worbus P1 (B-263): lb-bot answered this connection 401 `signin_required` - it refused
     * the hub, which sends no bearer (an older hub) or the wrong one. lb-bot is then treated as
     * unavailable (`useLbBotAvailable`) until the next `welcome` clears it.
     */
    lbRefused: boolean;
    /**
     * lb-bot's availability and the hub's proxied routes, as the hub stated them
     * in its last `welcome` (`welcome.lb`). Null until a welcome carries one —
     * which an older hub never does, and then the `/lb/status` probe answers
     * instead (`useLbBotStatus`). Kept across a disconnect, like the probe's
     * cached answer was: the next welcome replaces it.
     */
    lbStatus: LbBotStatus | null;
    /**
     * Worbus P2: the hub answers this user `lbbot_too_old` (lb-bot is older than signed-in users,
     * and this user is not the primary one): lb-bot is unavailable to them. Set by the refusal and
     * by `welcome.lb` / the `lb` frame without `identity`; ended by an `lb` frame with it and by an
     * answer that got through (lbbot-mode.ts `tooOldAfterRefusal`, `tooOldFromLb`).
     */
    lbTooOld: boolean;
    myDeviceId: null | string;
    /** Whether the remote session is currently playing. */
    remoteIsPlaying: boolean;
    /**
     * The session's shuffled play order (queue indexes), or null when it plays in queue order
     * (PROTOCOL §4.2 `order`). Read to count what remains in PLAY order (I-040).
     */
    remoteOrder: null | number[];
    /** Position of the remote session at `remotePositionAt` (wall clock ms). */
    remotePositionAt: number;
    remotePositionMs: number;
    /** Lightweight mirror of the hub session queue (for now-playing display). */
    remoteQueue: HubTrack[];
    /** Current queue index of the remote session. */
    remoteQueueIndex: number;
    remoteRepeat: 'all' | 'none' | 'one';
    remoteShuffle: boolean;
    /** Saved-queue history id of the CURRENT session — the "Now Playing" record. */
    savedQueueId: null | string;
    /**
     * Worbus P3: main's server record and the live socket's address (`hub-server`), or null until
     * main has answered. The per-server key (`id:<serverId>`, else `hub.url`) is read from it.
     */
    server: HubServerState | null;
    /**
     * Worbus P2: the Worbus Server signed this device out (close 4005 / `signed_out`) and the one
     * silent sign-in did not work, or there was no account to make it with. The transport stands
     * down until a sign-in works; the Server tab says "Signed out of the Worbus Server" with a
     * Sign in button. Cleared by a sign-in that works and by `welcome`.
     */
    signedOut: boolean;
    /** Worbus P2: a sign-in is in flight (the button's, or the silent one). */
    signingIn: boolean;
    /**
     * Worbus P2: the answer to the last sign-in this session, or null before one. Read by the
     * Server tab for its sentence, and (`oldServer`) for whether the token field is shown.
     */
    signInResult: HubSignInResult | null;
    /**
     * The session's sleep timer, as the last `session` or `welcome` stated it and on this
     * client's clock (I-034, sleep-timer.ts). Null when the session has none, against a hub
     * that holds none, and once the link is lost - except on the device that was playing,
     * which keeps it until it has paused itself (use-hub's guard).
     */
    sleepTimer: null | SessionSleepTimer;
    /**
     * Worbus P2: who this connection acts for, from `welcome.user` and the `user` frame. Null for
     * an older hub (which sends neither: today's behaviour) and before the first welcome.
     */
    user: HubUser | null;
}

const initialState: HubState = {
    activeDeviceId: null,
    actPins: NO_PINS,
    attemptAt: 0,
    // The web build has no main process to ask.
    authKnown: !isElectron(),
    authOwed: false,
    authRefused: false,
    authSignedIn: false,
    connected: false,
    devices: [],
    features: [],
    finder: { kind: 'idle', results: [], scope: null },
    lbProgress: null,
    lbRefused: false,
    lbStatus: null,
    lbTooOld: false,
    myDeviceId: null,
    remoteIsPlaying: false,
    remoteOrder: null,
    remotePositionAt: 0,
    remotePositionMs: 0,
    remoteQueue: [],
    remoteQueueIndex: 0,
    remoteRepeat: 'none',
    remoteShuffle: false,
    savedQueueId: null,
    server: null,
    signedOut: false,
    signingIn: false,
    signInResult: null,
    sleepTimer: null,
    user: null,
};

export const useHubStore = createWithEqualityFn<HubSlice>()((set) => ({
    actions: {
        patchRemoteTracks: (ids, patch) =>
            set((state) => {
                const wanted = new Set(ids);
                // Returning the same object when nothing matched keeps this from
                // re-rendering every remote-aware subscriber on an edit to a
                // song that is not in this queue at all.
                if (!state.remoteQueue.some((track) => wanted.has(track.id))) return state;
                return {
                    ...state,
                    remoteQueue: state.remoteQueue.map((track) =>
                        wanted.has(track.id) ? { ...track, ...patch } : track,
                    ),
                };
            }),
        reset: () => set({ ...initialState }),
        setStore: (data) => set((state) => ({ ...state, ...data })),
    },
    ...initialState,
}));

export const useHubDevices = () => useHubStore((s) => s.devices, shallow);
export const useHubActiveDeviceId = () => useHubStore((s) => s.activeDeviceId);
export const useHubMyDeviceId = () => useHubStore((s) => s.myDeviceId);
export const useHubConnected = () => useHubStore((s) => s.connected);

/**
 * Whether lb-bot is known to be out of reach right now, outside React: the hub said it is
 * unavailable, or (Worbus P1, B-263) lb-bot refused this hub with a 401 `signin_required`. A
 * background read (the index mirror's pull, the override map, the ownership re-ask) is skipped
 * then, as it would fail the same way. Unknown (no welcome yet, an older hub) is not "down".
 */
export const lbBotDownNow = (): boolean => {
    const { lbRefused, lbStatus, lbTooOld } = useHubStore.getState();
    return lbStatus?.available === false || lbRefused || lbTooOld;
};
export const useHubActions = () => useHubStore((s) => s.actions);

/**
 * Worbus P2 (review M1): this device holds or is owed a device secret, or the server signed it
 * out - a hub of this round, which names its user. Until it has, roles are least privilege.
 */
export const hubCredentialPending = credentialPending;

/**
 * Worbus P2: the signed-in user's roles, from `hub.store.user` - the only role source for the hub
 * and lb-bot surfaces. No user (an older hub) is today's behaviour: admin and primary.
 */
export const useHubRoles = (): HubRoles =>
    useHubStore((s) => rolesOf(s.user, hubCredentialPending(s)), shallow);

/** The same, outside React. */
export const hubRolesNow = (): HubRoles => {
    const s = useHubStore.getState();
    return rolesOf(s.user, hubCredentialPending(s));
};

/** True when playback is live on ANOTHER device — i.e. show the remote view. */
export const useHubIsRemoteActive = () =>
    useHubStore(
        (s) =>
            s.connected &&
            s.activeDeviceId !== null &&
            s.myDeviceId !== null &&
            s.activeDeviceId !== s.myDeviceId,
    );

export const useHubRemoteNowPlaying = () =>
    useHubStore((s) => s.remoteQueue[s.remoteQueueIndex] ?? null, shallow);

export const useHubRemoteIsPlaying = () => useHubStore((s) => s.remoteIsPlaying);

export const useHubActiveDeviceName = () =>
    useHubStore((s) => s.devices.find((d) => d.id === s.activeDeviceId)?.name ?? 'remote device');

export const useHubActiveDeviceVolume = () =>
    useHubStore((s) => s.devices.find((d) => d.id === s.activeDeviceId)?.volume ?? 100);

export const useHubRemoteRepeat = () => useHubStore((s) => s.remoteRepeat);
export const useHubRemoteShuffle = () => useHubStore((s) => s.remoteShuffle);

/** The saved-queue history id of the current session (the "Now Playing" record), or null. */
export const useHubSavedQueueId = () => useHubStore((s) => s.savedQueueId);

/** Is there a hub connection, and does that hub list `feature` in `welcome.features`? */
export const useHubFeature = (feature: string) => useHubStore((s) => s.features.includes(feature));

/** The session's sleep timer, or null - see `HubState.sleepTimer`. */
export const useHubSleepTimer = () => useHubStore((s) => s.sleepTimer);
