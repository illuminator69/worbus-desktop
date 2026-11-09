import { useCallback, useEffect, useRef, useState } from 'react';

import {
    enqueueToRemote,
    isRemoteSessionActive,
} from '/@/renderer/features/hub/utils/remote-queue';
import { resolveHubTracks } from '/@/renderer/features/hub/utils/resolve-songs';
import { usePlayer } from '/@/renderer/features/player/context/player-context';
import {
    beginQueueSession,
    consumeQueueSession,
    findMatchingSavedQueueId,
    isNewQueueSessionPending,
    resolveQueueSource,
} from '/@/renderer/features/player/utils/saved-queue-source';
import {
    playingQueueIndex,
    SavedQueue,
    useCurrentServerId,
    useHubStore,
    usePlayerActions,
    usePlayerStore,
    usePlayerStoreBase,
    useSavedQueuesActions,
    useSavedQueuesStore,
    useTimestampStoreBase,
} from '/@/renderer/store';
import { toast } from '/@/shared/components/toast/toast';
import { QueueSong } from '/@/shared/types/domain-types';

// navi-connect: automatically capture the current queue as a rolling "saved queue" (Continue
// Listening), and restore one on demand. Mirrors Worbus for Android's SavedQueueRepository upsert/cheap-path.

// How often the moving cursor/position of an UNCHANGED queue is persisted (avoids localStorage
// thrash on every 1 Hz timestamp tick; a song/queue change always writes immediately).
const PROGRESS_WRITE_INTERVAL_MS = 10_000;
// Coalesce a burst of queue edits into one write.
const CAPTURE_DEBOUNCE_MS = 1200;

/**
 * Mounted once (next to the other player hooks). Observes the local player and keeps the saved-queue
 * history current. Remote sessions are not captured here — the active receiver owns them.
 */
export const useSavedQueuesCapture = () => {
    const serverId = useCurrentServerId();
    const { updateProgress, upsert } = useSavedQueuesActions();

    const sessionIdRef = useRef<null | string>(null);
    const lastProgressWriteRef = useRef<number>(0);
    const debounceRef = useRef<null | ReturnType<typeof setTimeout>>(null);

    useEffect(() => {
        if (!serverId) return undefined;

        const writeState = (force: boolean) => {
            // When the hub is connected it OWNS the shared saved-queue history (it records
            // our published queue and broadcasts it back into this same store). Local capture
            // then would fork a second, differently-id'd entry — so only capture OFFLINE, as
            // the fallback cache. On reconnect, use-hub syncs these local rows up.
            if (useHubStore.getState().connected) return;
            const state = usePlayerStore.getState();
            const items = state.getQueue().items;
            // A cleared queue keeps its last snapshot in history rather than blanking it,
            // but it does end the session — the next play starts a fresh record.
            if (items.length === 0) {
                sessionIdRef.current = null;
                return;
            }

            // The playing row of `items` (queue order): under shuffle the play position named
            // another song for the card and its cover (B-367).
            const index = Math.min(Math.max(playingQueueIndex(state), 0), items.length - 1);
            const current = items[index];
            const positionSeconds = Math.max(
                0,
                Math.round(useTimestampStoreBase.getState().timestamp || 0),
            );
            const now = Date.now();

            // A NEW record is minted only when a play call site announced a new session (or
            // we have none yet). Reorder / remove / play-next / Auto DJ top-up / shuffle all
            // keep the same record — they're edits to the queue you're listening to, not a
            // new thing to remember.
            const announced = isNewQueueSessionPending();
            const startNew = !sessionIdRef.current || announced;

            if (startNew) {
                const { id: resumedId, kind, name } = resolveQueueSource(items);
                consumeQueueSession();
                // Resuming a saved queue keeps ITS id, so the card is refreshed, not cloned.
                // And if the hub was driving this same queue a moment ago (the socket just
                // dropped mid-listen), continue ITS record rather than minting a second
                // card for music that never stopped playing.
                // And if this queue is already in the history (a relaunch republishing the
                // restored queue, a replay of the same album), refresh THAT card.
                const hubId = useHubStore.getState().savedQueueId;
                const id =
                    resumedId ??
                    (!announced && hubId ? hubId : null) ??
                    findMatchingSavedQueueId(items.map((item) => item.id)) ??
                    crypto.randomUUID();
                sessionIdRef.current = id;
                lastProgressWriteRef.current = now;
                upsert({
                    // Frozen at birth: the card's art must not drift with playback.
                    coverImageUrl: items[0]?.imageUrl ?? null,
                    createdAt: now,
                    currentIndex: index,
                    currentSongId: current?.id,
                    currentSongName: current?.name,
                    id,
                    positionSeconds,
                    repeat: state.player.repeat,
                    serverId,
                    shuffle: state.player.shuffle,
                    songCount: items.length,
                    songs: items,
                    sourceKind: kind,
                    sourceName: name,
                    updatedAt: now,
                });
                return;
            }

            const activeEntry = useSavedQueuesStore
                .getState()
                .queues.find((q) => q.id === sessionIdRef.current);
            if (!activeEntry) {
                // The record was deleted under us — next write starts a new session.
                sessionIdRef.current = null;
                return;
            }

            const membershipChanged =
                activeEntry.songs.length !== items.length ||
                activeEntry.songs.some((s, n) => s.id !== items[n]?.id);

            if (membershipChanged) {
                lastProgressWriteRef.current = now;
                upsert({
                    ...activeEntry,
                    currentIndex: index,
                    currentSongId: current?.id,
                    currentSongName: current?.name,
                    positionSeconds,
                    songCount: items.length,
                    songs: items,
                    updatedAt: now,
                });
                return;
            }

            if (!force && now - lastProgressWriteRef.current < PROGRESS_WRITE_INTERVAL_MS) return;
            lastProgressWriteRef.current = now;
            updateProgress(sessionIdRef.current!, {
                currentIndex: index,
                currentSongId: current?.id,
                currentSongName: current?.name,
                positionSeconds,
            });
        };

        // Queue/song/index/mode changes → immediate (debounced) full-or-adopt write.
        const unsubscribePlayer = usePlayerStoreBase.subscribe(
            (state) => {
                const items = state.getQueue().items;
                return [
                    playingQueueIndex(state),
                    items.length,
                    items[0]?.id ?? '',
                    items[items.length - 1]?.id ?? '',
                    state.player.repeat,
                    state.player.shuffle,
                ].join('|');
            },
            () => {
                if (debounceRef.current) clearTimeout(debounceRef.current);
                debounceRef.current = setTimeout(() => writeState(true), CAPTURE_DEBOUNCE_MS);
            },
        );

        // Position advancing → throttled cursor write, so Continue Listening resumes near the spot.
        const unsubscribeTimestamp = useTimestampStoreBase.subscribe(() => writeState(false));

        return () => {
            unsubscribePlayer();
            unsubscribeTimestamp();
            if (debounceRef.current) clearTimeout(debounceRef.current);
            // Capture the final position on unmount (app close / server switch).
            writeState(true);
        };
    }, [serverId, updateProgress, upsert]);
};

export const SavedQueuesCaptureHook = () => {
    useSavedQueuesCapture();
    return null;
};

/**
 * Songs stored in a saved queue may be bare hub metadata (a record minted by the other client, or
 * adopted from the hub broadcast). Those carry no `_serverId`, which is exactly what gates the
 * stream-URL query — restoring them leaves the player in PLAYING with no source. Re-resolve them
 * against this server before handing them to anything that plays.
 */
const ensurePlayableSongs = async (
    entry: SavedQueue,
    serverId: null | string,
): Promise<QueueSong[]> => {
    // `albumId` is the tell for a stub: `placeholderSong` leaves it undefined, and a record adopted
    // from the hub is made entirely of stubs. Checking only `_serverId` missed them all (stubs DO
    // carry one), so cross-client restores played with no album, no container and no real duration.
    const needsResolve = entry.songs.some((song) => !song._serverId || !song.albumId);
    if (!needsResolve) return entry.songs;
    const resolved = await resolveHubTracks(
        entry.songs.map((song) => ({
            album: song.album,
            artist: song.artistName,
            durationMs: song.duration,
            id: song.id,
            imageUrl: song.imageUrl,
            title: song.name,
        })),
        serverId ?? entry.serverId,
    );
    return resolved as unknown as QueueSong[];
};

/**
 * Load a saved queue back into the player at its stored index/position and resume playback.
 * Resolution is async, so callers get an `isRestoring` flag to disable their control meanwhile.
 */
export const useRestoreSavedQueue = () => {
    const player = usePlayer();
    const serverId = useCurrentServerId();
    const { setRepeat, setShuffle } = usePlayerActions();
    const [isRestoring, setIsRestoring] = useState(false);

    const restore = useCallback(
        async (entry: SavedQueue) => {
            if (entry.songs.length === 0) return;
            setIsRestoring(true);
            try {
                const songs = await ensurePlayableSongs(entry, serverId);
                // Resuming this record continues ITS session — reuse its id and identity so
                // the hub refreshes that history entry instead of minting a duplicate.
                beginQueueSession(entry.sourceKind, entry.name ?? entry.sourceName, entry.id);
                // Playback is on another device: restore THERE, at the stored position,
                // reusing this record's id. Otherwise the click silently started the queue
                // locally from 0 while the remote session kept playing something else.
                if (isRemoteSessionActive()) {
                    await enqueueToRemote(songs, 'now', entry.currentIndex, {
                        positionMs: Math.round((entry.positionSeconds ?? 0) * 1000),
                        savedQueueId: entry.id,
                        sourceKind: entry.sourceKind,
                        sourceName: entry.name ?? entry.sourceName,
                    });
                    return;
                }
                player.setQueue(songs, entry.currentIndex, entry.positionSeconds);
                // Best-effort restore of the transport modes the queue was saved with.
                setRepeat(entry.repeat);
                setShuffle(entry.shuffle);
                player.mediaPlay();
            } catch (err) {
                toast.error({
                    message: (err as Error).message,
                    title: 'Could not restore that queue',
                });
            } finally {
                setIsRestoring(false);
            }
        },
        [player, serverId, setRepeat, setShuffle],
    );

    return { isRestoring, restore };
};
