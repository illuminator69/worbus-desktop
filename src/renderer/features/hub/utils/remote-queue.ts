import isElectron from 'is-electron';

import { api } from '/@/renderer/api';
import { getItemImageUrl } from '/@/renderer/components/item-image/item-image';
import {
    ACT_PIN_MS,
    ActPins,
    HubMirror,
    pinAct,
    pinsOnTrack,
    playPauseAct,
    prunePins,
    releasePin,
    shownDeviceVolume,
    shownPlaying,
    shownPositionMs,
    shownVolume,
} from '/@/renderer/features/hub/utils/act-pins';
import { commandedVolume, VolumeCommand } from '/@/renderer/features/hub/utils/volume-hold';
import { stationIdForPublish } from '/@/renderer/features/player/station/station-store';
import { isPreviewId, previewHubTrack } from '/@/renderer/features/preview/preview-track';
import { useHubStore, useSettingsStore } from '/@/renderer/store';
import { AddToQueueType } from '/@/renderer/store';
import { LibraryItem, Song } from '/@/shared/types/domain-types';
import { Play } from '/@/shared/types/types';

const hub = isElectron() ? window.api.hub : null;

/** Map Worbus for desktop's add-to-queue type to a remote enqueue mode. */
export const addToQueueTypeToRemoteMode = (type: AddToQueueType): 'end' | 'next' | 'now' => {
    if (typeof type === 'object' && 'edge' in type) {
        return type.edge === 'top' ? 'next' : 'end';
    }
    if (type === Play.NOW || type === Play.SHUFFLE) return 'now';
    if (type === Play.NEXT || type === Play.NEXT_SHUFFLE) return 'next';
    return 'end';
};

const rewriteToPublic = (url: null | string | undefined, base: string): string | undefined => {
    if (!url || !base) return url ?? undefined;
    try {
        const parsed = new URL(url);
        return `${base}${parsed.pathname}${parsed.search}`;
    } catch {
        return url;
    }
};

/**
 * Build hub Track payloads (id + streamUrl + metadata) from full Songs, so
 * URL-based receivers (the Chromecast bridge) can play them. Mirrors
 * use-hub's buildHubTracks but usable outside React (e.g. the player context).
 */
export const buildHubTracksForSongs = async (
    songs: Song[],
    serverId: string,
    publicServerUrl: string,
): Promise<Array<Record<string, unknown>>> => {
    const base = (publicServerUrl || '').trim().replace(/\/$/, '');
    return Promise.all(
        songs.map(async (song) => {
            // A preview publishes its own signed URL verbatim — see
            // `previewHubTrack`. Falling through would ask Navidrome for a
            // stream URL for an `ext:` id and publish the failure as `undefined`.
            if (isPreviewId(song.id)) return previewHubTrack(song);
            let streamUrl: string | undefined;
            try {
                streamUrl = (await api.controller.getStreamUrl({
                    apiClientProps: { serverId },
                    query: { id: song.id, skipAutoTranscode: true, transcode: false },
                })) as string;
            } catch {
                streamUrl = undefined;
            }
            const container = (song as Song & { container?: null | string }).container;
            return {
                album: song.album ?? undefined,
                // See use-hub's buildHubTracks: the ids ride along so a receiver can
                // link the album/artist without resolving the song again.
                albumId: song.albumId ?? undefined,
                artist: song.artistName,
                artists: song.artists?.length
                    ? song.artists.map((a) => ({ id: a.id, name: a.name }))
                    : undefined,
                durationMs: song.duration ?? undefined,
                id: song.id,
                imageUrl:
                    rewriteToPublic(
                        getItemImageUrl({
                            id: song.id,
                            imageUrl: song.imageUrl,
                            itemType: LibraryItem.SONG,
                            serverId: song._serverId,
                            type: 'itemCard',
                            useRemoteUrl: true,
                        }),
                        base,
                    ) || undefined,
                mime: container ? `audio/${container === 'mp3' ? 'mpeg' : container}` : undefined,
                streamUrl: rewriteToPublic(streamUrl, base),
                title: song.name,
            };
        }),
    );
};

/**
 * The last `act:volume` sent from here to a hub that acknowledges nothing. Marked in remoteAct,
 * which every volume change to a remote device goes through (slider, wheel, hotkeys, mute), so
 * there is one record of what was asked for while the `devices` frame that answers it is still
 * a round trip away - see volume-hold.ts. A hub with `actAck` gets a pin instead (sendAct).
 */
let lastVolumeCommand: null | VolumeCommand = null;

type HubSnapshot = ReturnType<typeof useHubStore.getState>;

/** `welcome.features`: this hub answers every act that carries a `cid` with an `ack`. */
const ACT_ACK = 'actAck';

/** The hub store's mirror, as act-pins.ts reads it. */
const mirrorOf = (s: HubSnapshot): HubMirror => ({
    activeDeviceId: s.activeDeviceId,
    index: s.remoteQueueIndex,
    isPlaying: s.remoteIsPlaying,
    positionAt: s.remotePositionAt,
    positionMs: s.remotePositionMs,
    trackId: s.remoteQueue[s.remoteQueueIndex]?.id ?? null,
});

/**
 * Does the hub acknowledge acts? Without it nothing is pinned and nothing is shown before the
 * hub's own frame says so: the timed holds of volume-hold.ts and the seek bar apply, as before.
 */
export const hubAcksActs = (s: HubSnapshot = useHubStore.getState()): boolean =>
    s.features.includes(ACT_ACK);

/**
 * The pins that still stand once a frame has put the session on row `index` of `queue` - for
 * use-hub to write in the same store update as the frame (`session`, `progress`). A position
 * pinned on another track goes: see pinsOnTrack.
 */
export const pinsAfterFrame = (index: number, queue: ReadonlyArray<{ id: string }>): ActPins =>
    pinsOnTrack(useHubStore.getState().actPins, { index, trackId: queue[index]?.id ?? null });

/**
 * Is the remote session playing, as this client shows it: the play or pause just sent from here
 * until the hub has answered for it (act-pins.ts), else what the hub last said.
 */
export const remotePlayingShown = (
    s: HubSnapshot = useHubStore.getState(),
    now = Date.now(),
): boolean => shownPlaying(s.actPins, mirrorOf(s), now);

/**
 * The remote session's position (ms) as this client shows it: where it just sought to until the
 * hub has answered, else the hub's ~1 Hz sample carried on from the wall clock.
 */
export const remotePositionMsShown = (
    s: HubSnapshot = useHubStore.getState(),
    now = Date.now(),
): number => shownPositionMs(s.actPins, mirrorOf(s), now);

/**
 * The level just asked of the active remote device, until the hub has answered for it. Null when
 * the device's row is the truth.
 */
export const remoteVolumePinned = (
    s: HubSnapshot = useHubStore.getState(),
    now = Date.now(),
): null | number => shownVolume(s.actPins, mirrorOf(s), now);

/**
 * The level just asked of the device `deviceId` from its row in the device picker, until the
 * hub has answered for it. Null when the row's own `volume` is the truth.
 */
export const deviceVolumePinned = (
    deviceId: string,
    s: HubSnapshot = useHubStore.getState(),
    now = Date.now(),
): null | number => shownDeviceVolume(s.actPins, deviceId, now);

/** Drop pins that lapsed with no ack, so whatever renders them looks again. */
const dropLapsedPins = () => {
    const s = useHubStore.getState();
    const pins = prunePins(s.actPins, Date.now());
    if (pins !== s.actPins) s.actions.setStore({ actPins: pins });
};

/** The hub answered the act `cid` (use-hub, on `ack`): the mirror shows through again. */
export const releaseActPin = (cid: string): void => {
    const s = useHubStore.getState();
    const pins = releasePin(s.actPins, cid);
    if (pins !== s.actPins) s.actions.setStore({ actPins: pins });
};

// A `cid` has to be unique on its connection. The count is per load of this module, and the
// prefix keeps two loads (a renderer reload) from ever minting the same one.
const cidPrefix = Math.random().toString(36).slice(2, 6);
let actCount = 0;

/**
 * Send one `act`. Every act this renderer sends leaves through here, so each carries a `cid`
 * (I-031, PROTOCOL §5.1): the hub answers it with `{t:'ack', cid, ok}` once the frames it caused
 * are written, and an older hub ignores the field. Returns the `cid`, or null with no transport.
 *
 * It is also where a commanded play state, position or volume is pinned (act-pins.ts), so no
 * sender can forget to: readers show the pin until use-hub releases it on that ack. Only
 * against a hub that acknowledges acts - an ack that never comes would hold every press for
 * the full 2.5 s.
 *
 * It does NOT check that the hub is connected or that another device is playing; the callers'
 * gates differ (remoteAct, sendHubAct, the queue publications in use-hub).
 */
export const sendAct = (action: string, extra?: Record<string, unknown>): null | string => {
    if (!hub) return null;
    actCount += 1;
    const cid = `${cidPrefix}-${actCount}`;
    hub.send({ action, t: 'act', ...extra, cid });
    const s = useHubStore.getState();
    if (hubAcksActs(s)) {
        const pins = pinAct(s.actPins, { ...extra, action }, cid, mirrorOf(s), Date.now());
        if (pins !== s.actPins) {
            s.actions.setStore({ actPins: pins });
            // Readers check the 2.5 s themselves when they read. This only makes them read
            // again if the pin lapses with nothing else changing (a paused session, no ack).
            setTimeout(dropLapsedPins, ACT_PIN_MS + 50);
        }
    }
    return cid;
};

/**
 * Fire an `act` directive at the hub when a remote session is active. Returns
 * true when it handled the command (caller should NOT also drive the local
 * player), false otherwise. Usable outside React (e.g. the player context),
 * which is what lets the normal playerbar controls transparently drive the
 * remote session.
 */
export const remoteAct = (action: string, extra?: Record<string, unknown>): boolean => {
    if (!hub || !isRemoteSessionActive()) return false;
    sendAct(action, extra);
    const s = useHubStore.getState();
    if (
        action === 'volume' &&
        typeof extra?.level === 'number' &&
        s.activeDeviceId !== null &&
        !hubAcksActs(s)
    ) {
        lastVolumeCommand = { at: Date.now(), deviceId: s.activeDeviceId, level: extra.level };
    }
    return true;
};

/**
 * The play/pause control while another device plays. A hub that acknowledges acts is sent the
 * explicit `play` or `pause` the user was shown, which a pin can stand for; an older hub gets
 * the hub-side toggle `playpause`, as before.
 */
export const remoteTogglePlayPause = (): boolean => {
    const s = useHubStore.getState();
    if (!hubAcksActs(s)) return remoteAct('playpause');
    return remoteAct(playPauseAct(s.actPins, mirrorOf(s), Date.now()));
};

/**
 * The level last asked of the active remote device, while that is newer than anything its
 * `devices` row can show - what a relative volume change steps from. Null when the row is the
 * truth again.
 */
export const commandedRemoteVolume = (): null | number =>
    commandedVolume(lastVolumeCommand, useHubStore.getState().activeDeviceId, Date.now());

/**
 * Fire an `act` at the hub whenever we're CONNECTED (independent of who's the active
 * receiver) — for shared-state management like saved-queue rename/delete. Returns true
 * when sent, so callers can fall back to a local-only action when offline.
 */
export const sendHubAct = (action: string, extra?: Record<string, unknown>): boolean => {
    if (!useHubStore.getState().connected) return false;
    return sendAct(action, extra) !== null;
};

/** True if playback is currently on another navi-connect device. */
export const isRemoteSessionActive = (): boolean => {
    const s = useHubStore.getState();
    return (
        s.connected &&
        s.activeDeviceId !== null &&
        s.myDeviceId !== null &&
        s.activeDeviceId !== s.myDeviceId
    );
};

/**
 * Route a set of songs to the REMOTE session: `now` replaces the queue and
 * plays, `next`/`end` enqueue. Returns true when handled (caller skips local).
 */
export const enqueueToRemote = async (
    songs: Song[],
    mode: 'end' | 'next' | 'now',
    startIndex = 0,
    // Resuming (rather than starting) a queue: carry the stored offset and the
    // saved-queue identity, so the hub refreshes THAT history record instead of
    // minting a duplicate for the same listening session.
    resume?: {
        positionMs?: number;
        savedQueueId?: string;
        sourceKind?: string;
        sourceName?: string;
    },
): Promise<boolean> => {
    if (!hub || !isRemoteSessionActive() || songs.length === 0) return false;
    const serverId = songs[0]._serverId;
    const publicServerUrl = useSettingsStore.getState().hub?.publicServerUrl ?? '';
    const tracks = await buildHubTracksForSongs(songs, serverId, publicServerUrl);

    if (mode === 'now') {
        // Start on the clicked track, not always track 1.
        const index = Math.max(0, Math.min(startIndex, songs.length - 1));
        sendAct('setQueue', {
            index,
            play: true,
            positionMs: Math.max(0, Math.round(resume?.positionMs ?? 0)),
            savedQueueId: resume?.savedQueueId,
            serverId,
            sourceKind: resume?.sourceKind,
            sourceName: resume?.sourceName,
            // I-040: a radio started here binds the session to its station; any other new
            // queue was unbound when its session began, and a setQueue without one unbinds.
            stationId: stationIdForPublish(),
            tracks,
        });
    } else {
        sendAct('enqueue', { at: mode === 'next' ? 'next' : 'end', tracks });
    }
    return true;
};
