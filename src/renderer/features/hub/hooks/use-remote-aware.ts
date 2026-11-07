import { useEffect, useState } from 'react';
import { generatePath, useNavigate } from 'react-router';

import { api } from '/@/renderer/api';
import { remoteNextIndex } from '/@/renderer/features/hub/utils/remote-next';
import {
    hubAcksActs,
    isRemoteSessionActive,
    remoteAct,
    remotePlayingShown,
    remotePositionMsShown,
    remoteVolumePinned,
} from '/@/renderer/features/hub/utils/remote-queue';
import { AppRoute } from '/@/renderer/router/routes';
import {
    useCurrentServerId,
    useHubActiveDeviceVolume,
    useHubIsRemoteActive,
    useHubRemoteNowPlaying,
    useHubRemoteRepeat,
    useHubRemoteShuffle,
    useHubStore,
    usePlayerData,
    usePlayerRepeat,
    usePlayerShuffle,
    usePlayerSong,
    usePlayerStatus,
    usePlayerStore,
    usePlayerVolume,
} from '/@/renderer/store';
import { HubTrack } from '/@/renderer/store/hub.store';
import { usePlayerTimestamp } from '/@/renderer/store/timestamp.store';
import { LibraryItem, QueueSong, Song } from '/@/shared/types/domain-types';
import { PlayerRepeat, PlayerShuffle, PlayerStatus } from '/@/shared/types/types';

/**
 * Player hooks that transparently follow the REMOTE session when playback is on
 * another navi-connect device, so existing UI (lyrics, side queue) reflects
 * what's actually playing instead of the frozen local player.
 */

// Remote tracks arrive with only id + plain album/artist NAMES. To make the
// playerbar's album/artist links work we resolve the full Song once per id
// (cached; in-flight deduped across the components that call the hook).
const remoteDetailCache = new Map<string, Song>();
const remoteDetailInflight = new Map<string, Promise<null | Song>>();
// A lookup that failed (an error, or no song) is not asked again for a minute. The side queue
// resolves each mounted remote row (useRemoteRowArtists), and rows remount while scrolling:
// without this, a failing server was asked again for every row on every remount.
const REMOTE_DETAIL_RETRY_MS = 60_000;
const remoteDetailFailedAt = new Map<string, number>();

const resolveRemoteDetail = (serverId: string, id: string): Promise<null | Song> => {
    const cached = remoteDetailCache.get(id);
    if (cached) return Promise.resolve(cached);
    const failedAt = remoteDetailFailedAt.get(id);
    if (failedAt !== undefined && Date.now() - failedAt < REMOTE_DETAIL_RETRY_MS) {
        return Promise.resolve(null);
    }
    let inflight = remoteDetailInflight.get(id);
    if (!inflight) {
        inflight = api.controller
            .getSongDetail({ apiClientProps: { serverId }, query: { id } })
            .then((song) => {
                if (song) remoteDetailCache.set(id, song as Song);
                return (song as Song) ?? null;
            })
            .catch(() => null)
            .then((song) => {
                if (song) remoteDetailFailedAt.delete(id);
                else remoteDetailFailedAt.set(id, Date.now());
                return song;
            })
            .finally(() => remoteDetailInflight.delete(id));
        remoteDetailInflight.set(id, inflight);
    }
    return inflight;
};

/**
 * Build a `QueueSong` from a hub wire track.
 *
 * The single place this conversion happens. There used to be three of these — the now-playing
 * hook, the OS snapshot below, and the side queue — each with a slightly different field set, so
 * whether a remote track carried its rating, its album id, or its artist links depended on which
 * part of the UI you happened to be looking at.
 *
 * Two things are load-bearing and were duplicated as comments in all three copies:
 * - **Cover art is built from the Navidrome id with OUR server credentials**, never from the
 *   publisher's `imageUrl`, which may be a LAN or tokened URL this client cannot reach. The song
 *   id doubles as the cover-art id across this system. `imageUrl` is kept as an explicit
 *   `undefined` so `ItemImage` falls back to the id and the table's song-row branch still matches.
 * - `resolved` is the lazily fetched full song, and is now a *fallback*. A publisher that
 *   sends `albumId`/`artists` (this client does; see buildHubTracks) makes the playerbar's
 *   links work on the first frame instead of only once getSongDetail has round-tripped —
 *   which is the whole of the "the artist name isn't clickable on remote playback" report.
 *   An older publisher sends neither, and the resolve still covers it.
 */
export const hubTrackToQueueSong = (
    track: HubTrack,
    serverId: string,
    resolved?: null | Song,
    uniqueId?: string,
): QueueSong =>
    ({
        _itemType: LibraryItem.SONG,
        _serverId: serverId,
        ...(uniqueId ? { _uniqueId: uniqueId } : {}),
        album: track.album ?? resolved?.album ?? '',
        albumArtists: resolved?.albumArtists,
        albumId: resolved?.albumId ?? track.albumId ?? undefined,
        artistName: track.artist ?? '',
        artists:
            resolved?.artists && resolved.artists.length > 0
                ? resolved.artists
                : track.artists && track.artists.length > 0
                  ? track.artists
                  : track.artist
                    ? [{ id: '', name: track.artist }]
                    : [],
        duration: track.durationMs ?? 0,
        id: track.id,
        imageId: resolved?.imageId ?? track.id,
        imageUrl: undefined,
        name: track.title ?? '',
        userFavorite: track.favorite ?? false,
        userRating: track.rating ?? null,
    }) as unknown as QueueSong;

/**
 * The artists of a side-queue row, with ids. A row built from a remote session's wire track
 * (`_uniqueId` `remote:<i>`) carries names only when the publisher sends no ids (Worbus for Android), so its
 * artists would draw as plain text. The table only mounts the rows near the viewport, so each
 * mounted row resolves its song once (cached, in flight deduped) and swaps in the real artists.
 * A local row, or a remote one whose artists already carry ids, never asks.
 */
export const useRemoteRowArtists = (song: QueueSong | undefined): QueueSong['artists'] => {
    const rowId = song?._uniqueId;
    const songId = song?.id;
    const serverId = song?._serverId;
    const named = song?.artists ?? [];
    const needsIds =
        !!rowId?.startsWith('remote:') && !!songId && !!serverId && !named.some((a) => !!a.id);
    const [detail, setDetail] = useState<null | Song>(null);

    useEffect(() => {
        if (!needsIds || !songId || !serverId) {
            setDetail(null);
            return undefined;
        }
        let cancelled = false;
        void resolveRemoteDetail(serverId, songId).then((resolved) => {
            if (!cancelled) setDetail(resolved);
        });
        return () => {
            cancelled = true;
        };
    }, [needsIds, serverId, songId]);

    if (!needsIds) return named;
    const resolved = detail?.id === songId ? detail : (remoteDetailCache.get(songId ?? '') ?? null);
    return resolved?.artists && resolved.artists.length > 0 ? resolved.artists : named;
};

/** The current song — remote now-playing when remote-active, else local. */
export const useRemoteAwarePlayerSong = (): QueueSong | undefined => {
    const isRemote = useHubIsRemoteActive();
    const localSong = usePlayerSong();
    const remote = useHubRemoteNowPlaying();
    const serverId = useCurrentServerId();
    const [detail, setDetail] = useState<null | Song>(null);

    // Resolve the full song for the remote now-playing track (album id + artist
    // ids) so the playerbar links navigate correctly.
    const remoteId = isRemote ? remote?.id : undefined;
    useEffect(() => {
        if (!remoteId || !serverId) {
            setDetail(null);
            return undefined;
        }
        let cancelled = false;
        void resolveRemoteDetail(serverId, remoteId).then((song) => {
            if (!cancelled) setDetail(song);
        });
        return () => {
            cancelled = true;
        };
    }, [remoteId, serverId]);

    if (!isRemote || !remote) return localSong;

    const resolved = detail?.id === remote.id ? detail : (remoteDetailCache.get(remote.id) ?? null);

    return hubTrackToQueueSong(remote, serverId ?? '', resolved);
};

/**
 * The next song: the remote session's when remote-active, else local. The remote one walks the
 * session's play order and honours its repeat (remoteNextIndex), as the local player does.
 */
export const useRemoteAwareNextSong = (): QueueSong | undefined => {
    const isRemote = useHubIsRemoteActive();
    const { nextSong } = usePlayerData();
    const next = useHubStore((state) => {
        const nextIndex = remoteNextIndex({
            index: state.remoteQueueIndex,
            length: state.remoteQueue.length,
            order: state.remoteOrder,
            repeat: state.remoteRepeat,
        });
        return nextIndex === null ? undefined : state.remoteQueue[nextIndex];
    });
    const serverId = useCurrentServerId();

    if (!isRemote) return nextSong;
    if (!next) return undefined;
    return hubTrackToQueueSong(next, serverId ?? '', remoteDetailCache.get(next.id));
};

/**
 * Non-hook snapshot of "what is actually playing", for the OS-facing integrations (media
 * session, window bar title, native menu) that live outside React's render path.
 *
 * These MUST follow the remote session. Reporting the frozen local player to the OS meant
 * Windows believed playback was paused while a remote device played, so the media hotkey
 * sent `play` instead of `pause` — pressing pause with the app unfocused unpaused the
 * remote session. The now-playing thumbnail was stale for the same reason.
 */
export const getRemoteAwareSnapshot = (): {
    isRemote: boolean;
    song: QueueSong | undefined;
    status: PlayerStatus;
} => {
    const hubState = useHubStore.getState();
    // The one predicate, shared with remoteAct's gate — this used to be a fourth hand-rolled
    // copy, and one of the four disagreed with the others about whether `connected` counted.
    const isRemote = isRemoteSessionActive();
    const player = usePlayerStore.getState();
    if (!isRemote) {
        return { isRemote, song: player.getCurrentSong(), status: player.player.status };
    }
    const remote = hubState.remoteQueue[hubState.remoteQueueIndex];
    return {
        isRemote,
        song: remote
            ? hubTrackToQueueSong(
                  remote,
                  usePlayerStore.getState().getCurrentSong()?._serverId ?? '',
                  remoteDetailCache.get(remote.id),
              )
            : undefined,
        status: hubState.remoteIsPlaying ? PlayerStatus.PLAYING : PlayerStatus.PAUSED,
    };
};

/** Shuffle state — remote session's when remote-active, else local. */
export const useRemoteAwareShuffle = (): PlayerShuffle => {
    const isRemote = useHubIsRemoteActive();
    const localShuffle = usePlayerShuffle();
    const remoteShuffle = useHubRemoteShuffle();

    if (!isRemote) return localShuffle;
    return remoteShuffle ? PlayerShuffle.TRACK : PlayerShuffle.NONE;
};

/** Repeat state — remote session's when remote-active, else local. */
export const useRemoteAwareRepeat = (): PlayerRepeat => {
    const isRemote = useHubIsRemoteActive();
    const localRepeat = usePlayerRepeat();
    const remoteRepeat = useHubRemoteRepeat();

    if (!isRemote) return localRepeat;
    return remoteRepeat === 'one'
        ? PlayerRepeat.ONE
        : remoteRepeat === 'all'
          ? PlayerRepeat.ALL
          : PlayerRepeat.NONE;
};

/**
 * Volume (0-100): the active remote device's when remote-active, else local. The remote one is
 * the level just sent from here until the hub has answered for it (I-031, act-pins.ts), then
 * the device's row.
 */
export const useRemoteAwareVolume = (): number => {
    const isRemote = useHubIsRemoteActive();
    const localVolume = usePlayerVolume();
    const rowVolume = useHubActiveDeviceVolume();
    const pinnedVolume = useHubStore((s) => remoteVolumePinned(s));

    return isRemote ? (pinnedVolume ?? rowVolume) : localVolume;
};

/** Playback position in SECONDS — interpolated remote position, or local. */
export const useRemoteAwareTimestamp = (): number => {
    const isRemote = useHubIsRemoteActive();
    const localTs = usePlayerTimestamp();
    // The position runs on while the hub says "playing", and a position just sought to (I-031,
    // act-pins.ts) while this client shows "playing" - a play sent from here included.
    const isRunning = useHubStore((s) => s.remoteIsPlaying || remotePlayingShown(s));
    // Nothing ticks while the session is paused, so render again when a seek from here is
    // pinned, and when that pin gives way to the hub's answer.
    useHubStore((s) => s.actPins.position);
    const [, force] = useState(0);

    // Tick locally between the hub's ~1 Hz progress frames while remote-playing.
    useEffect(() => {
        if (!isRemote || !isRunning) return undefined;
        const timer = setInterval(() => force((n) => n + 1), 250);
        return () => clearInterval(timer);
    }, [isRemote, isRunning]);

    if (!isRemote) return localTs;

    // Deliberately impure: the hub publishes position at ~1 Hz, so the live value has to be
    // interpolated from the wall clock (inside remotePositionMsShown). The 250 ms interval above
    // is what re-renders this, and the "unstable across re-renders" a purity rule warns about is
    // exactly the intent - a clock that advances. Moving it into state would add a render's
    // worth of lag to the progress bar.
    return remotePositionMsShown() / 1000;
};

/**
 * Playback status: remote play/pause when remote-active, else local. The remote one is the
 * play or pause just sent from here until the hub has answered for it (I-031, act-pins.ts),
 * then the hub's own word.
 */
export const useRemoteAwareStatus = (): PlayerStatus => {
    const isRemote = useHubIsRemoteActive();
    const localStatus = usePlayerStatus();
    const remotePlaying = useHubStore((s) => remotePlayingShown(s));

    if (!isRemote) return localStatus;
    return remotePlaying ? PlayerStatus.PLAYING : PlayerStatus.PAUSED;
};

/**
 * Returns a seek function that routes to the remote device when remote-active.
 * Returns false (didn't handle it) otherwise, so callers fall back to local.
 */
export const useRemoteSeek = (): ((sec: number) => boolean) => {
    return (sec: number) => {
        const positionMs = Math.round(sec * 1000);
        if (!remoteAct('seek', { positionMs })) return false;
        // A hub that acknowledges acts: remoteAct has pinned the position, and the bar and the
        // lyrics show the pin until the ack. The mirror stays the hub's word, so a seek it
        // refuses leaves nothing behind.
        if (hubAcksActs()) return true;
        // An older hub: optimistically advance the mirror so the scrubber thumb stays where
        // the user dropped it instead of snapping back until the next ~1 Hz frame.
        useHubStore.getState().actions.setStore({
            remotePositionAt: Date.now(),
            remotePositionMs: positionMs,
        });
        return true;
    };
};

/**
 * Navigate to the album/artist of a remote track. Remote tracks only carry a
 * song id, so the album/artist ids are resolved on demand via getSongDetail.
 */
export const useRemoteSongNavigation = () => {
    const navigate = useNavigate();
    const serverId = useCurrentServerId();

    const resolve = async (songId: string): Promise<null | Song> => {
        if (!serverId) return null;
        try {
            return (await api.controller.getSongDetail({
                apiClientProps: { serverId },
                query: { id: songId },
            })) as Song;
        } catch {
            return null;
        }
    };

    return {
        goToAlbum: async (songId: string) => {
            const song = await resolve(songId);
            if (song?.albumId) {
                navigate(generatePath(AppRoute.LIBRARY_ALBUMS_DETAIL, { albumId: song.albumId }));
            }
        },
        goToArtist: async (songId: string) => {
            const song = await resolve(songId);
            const artistId = song?.albumArtists?.[0]?.id ?? song?.artists?.[0]?.id;
            if (artistId) {
                navigate(
                    generatePath(AppRoute.LIBRARY_ALBUM_ARTISTS_DETAIL, {
                        albumArtistId: artistId,
                    }),
                );
            }
        },
        resolve,
    };
};
