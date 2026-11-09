import { useQueryClient } from '@tanstack/react-query';
import React, { useEffect, useRef } from 'react';

import { api } from '/@/renderer/api';
import { eventEmitter } from '/@/renderer/events/event-emitter';
import { isRemoteSessionActive } from '/@/renderer/features/hub/utils/remote-queue';
import { runAutoDjAlbumIds } from '/@/renderer/features/player/auto-dj/auto-dj-albums';
import { runAutoDjSongs } from '/@/renderer/features/player/auto-dj/auto-dj-songs';
import { useIsPlayerFetching, usePlayer } from '/@/renderer/features/player/context/player-context';
import { remainingRemote } from '/@/renderer/features/player/station/station-logic';
import { useStationMode, useStationStore } from '/@/renderer/features/player/station/station-store';
import {
    AUTO_DJ_STRATEGY,
    playingQueueIndex,
    playOrder,
    playPosition,
    useAutoDJSettings,
    useCurrentServer,
    useCurrentServerId,
    useHubStore,
    usePlayerStore,
    usePlayerStoreBase,
    useSettingsStore,
} from '/@/renderer/store';
import { logger } from '/@/renderer/utils/logger';
import { hasFeature } from '/@/shared/api/utils';
import { LibraryItem, QueueSong } from '/@/shared/types/domain-types';
import { ServerFeature } from '/@/shared/types/features-types';
import { Play } from '/@/shared/types/types';

// navi-connect (I-040): this is upstream's Auto DJ, and it runs only when the hub's station
// engine cannot (no hub, a hub without `station`, a probe that answered unavailable, or a
// `start` that answered 503). With the engine, use-station-autoplay.ts continues the queue as a
// station instead. Two fork additions remain, both marked: the local listener stands down while
// another navi-connect device plays, and a second listener tops up THAT device's session.

export const useAutoDJ = () => {
    const queryClient = useQueryClient();
    const serverId = useCurrentServerId();
    const server = useCurrentServer();
    const player = usePlayer();
    const settings = useAutoDJSettings();
    const isFetching = useIsPlayerFetching();
    const remoteRunningRef = useRef(false);

    const hasSimilarSongsMusicFolder = hasFeature(server, ServerFeature.SIMILAR_SONGS_MUSIC_FOLDER);

    useEffect(() => {
        const albumStrategy = settings.albumStrategy ?? AUTO_DJ_STRATEGY.SIMILAR;
        const songStrategy = settings.songStrategy ?? AUTO_DJ_STRATEGY.SIMILAR;

        const selector = (state: ReturnType<typeof usePlayerStoreBase.getState>) => {
            const queue = state.getQueue();
            const index = playingQueueIndex(state);
            // What is left to play after the playing song, in play order.
            const remaining = Math.max(0, playOrder(state).length - playPosition(state) - 1);

            return { index, remaining, song: queue.items[index] };
        };

        const listener = async (properties: ReturnType<typeof selector>) => {
            // navi-connect: while another navi-connect device is the active receiver, the
            // local player store is frozen; the remote listener below tops up that session.
            if (isRemoteSessionActive()) {
                return;
            }

            if (!settings.enabled) {
                return;
            }

            if (!properties.song?.id) {
                return;
            }

            if (properties.remaining >= settings.timing) {
                return;
            }

            logger.info('Auto DJ triggered', {
                remaining: properties.remaining,
                songId: properties.song?.id,
                songName: properties.song?.name,
            });

            try {
                const queue = usePlayerStore.getState().getQueue();

                const hasMusicFolder = server?.musicFolderId && server.musicFolderId.length > 0;
                const musicFolderId =
                    hasMusicFolder && server?.musicFolderId ? server.musicFolderId : undefined;
                const trySimilarSongs =
                    !hasMusicFolder || (hasMusicFolder && hasSimilarSongsMusicFolder);

                const runnerDepsBase = {
                    allowDuplicates: settings.allowDuplicates,
                    itemCount: settings.itemCount,
                    musicFolderId,
                    onlySimilar: settings.onlySimilar,
                    queryClient,
                    server,
                    serverId,
                    trySimilarSongs,
                };

                if (settings.mode === 'albums') {
                    if (!serverId) {
                        return;
                    }

                    const queueAlbumIdSet = new Set(
                        queue.items
                            .map((item) => item.albumId)
                            .filter((id): id is string => Boolean(id)),
                    );

                    const albumsToAdd = await runAutoDjAlbumIds({
                        ...runnerDepsBase,
                        albumStrategy,
                        currentSong: properties.song,
                        queueAlbumIdSet,
                    });

                    if (albumsToAdd.length > 0) {
                        await player.addToQueueByFetch(
                            serverId,
                            albumsToAdd,
                            LibraryItem.ALBUM,
                            Play.LAST,
                        );

                        eventEmitter.emit('AUTODJ_QUEUE_ADDED', {
                            songCount: albumsToAdd.length,
                        });
                    }

                    return;
                }

                if (!serverId) {
                    return;
                }

                const queueSongIdSet = new Set(queue.items.map((item) => item.id));

                const songsToAdd = await runAutoDjSongs({
                    ...runnerDepsBase,
                    currentSong: properties.song,
                    queueSongIdSet,
                    songStrategy,
                });

                if (songsToAdd.length > 0) {
                    player.addToQueueByData(songsToAdd, Play.LAST);

                    eventEmitter.emit('AUTODJ_QUEUE_ADDED', {
                        songCount: songsToAdd.length,
                    });
                }
            } catch (error) {
                logger.error('Auto DJ failed', {
                    error: (error as Error).message,
                    songId: properties.song?.id,
                });
            }
        };

        const unsubscribe = usePlayerStoreBase.subscribe(selector, listener, {
            equalityFn: (a, b) => {
                return a.song?._uniqueId === b.song?._uniqueId && a.remaining === b.remaining;
            },
        });

        // navi-connect: drive Auto DJ off the HUB session when another device is the active
        // receiver (the local player store doesn't advance then). The adds route to the remote
        // session through the intercepted player context.
        const runRemoteAutoDj = async (nowId: string) => {
            if (remoteRunningRef.current || !serverId) {
                return;
            }
            remoteRunningRef.current = true;

            try {
                // The hub track only carries an id: resolve the full song so the runner has
                // genres/albumArtists/albumId for its fallbacks.
                const seed = await api.controller
                    .getSongDetail({ apiClientProps: { serverId }, query: { id: nowId } })
                    .catch(() => null);
                if (!seed) {
                    return;
                }

                const remoteQueue = useHubStore.getState().remoteQueue;

                const hasMusicFolder = server?.musicFolderId && server.musicFolderId.length > 0;
                const musicFolderId =
                    hasMusicFolder && server?.musicFolderId ? server.musicFolderId : undefined;
                const trySimilarSongs =
                    !hasMusicFolder || (hasMusicFolder && hasSimilarSongsMusicFolder);

                const runnerDepsBase = {
                    allowDuplicates: settings.allowDuplicates,
                    itemCount: settings.itemCount,
                    musicFolderId,
                    onlySimilar: settings.onlySimilar,
                    queryClient,
                    server,
                    serverId,
                    trySimilarSongs,
                };

                if (settings.mode === 'albums') {
                    const albumsToAdd = await runAutoDjAlbumIds({
                        ...runnerDepsBase,
                        albumStrategy,
                        currentSong: seed as unknown as QueueSong,
                        // The hub queue carries album NAMES, not ids: best-effort (album dedupe
                        // relies on ids), so pass an empty set.
                        queueAlbumIdSet: new Set<string>(),
                    });

                    if (albumsToAdd.length > 0) {
                        await player.addToQueueByFetch(
                            serverId,
                            albumsToAdd,
                            LibraryItem.ALBUM,
                            Play.LAST,
                        );
                        eventEmitter.emit('AUTODJ_QUEUE_ADDED', { songCount: albumsToAdd.length });
                    }
                    return;
                }

                const queueSongIdSet = new Set(remoteQueue.map((track) => track.id));
                const songsToAdd = await runAutoDjSongs({
                    ...runnerDepsBase,
                    currentSong: seed as unknown as QueueSong,
                    queueSongIdSet,
                    songStrategy,
                });

                if (songsToAdd.length > 0) {
                    player.addToQueueByData(songsToAdd, Play.LAST);
                    eventEmitter.emit('AUTODJ_QUEUE_ADDED', { songCount: songsToAdd.length });
                }
            } catch (error) {
                logger.error('Auto DJ failed', {
                    error: (error as Error).message,
                    songId: nowId,
                });
            } finally {
                remoteRunningRef.current = false;
            }
        };

        // useHubStore has no subscribeWithSelector middleware, so dedupe by hand: only act
        // when the remote now-playing track or remaining count changes.
        let lastRemoteSig = '';
        const onHub = (state: ReturnType<typeof useHubStore.getState>, force = false) => {
            const isRemote =
                state.connected &&
                state.activeDeviceId !== null &&
                state.myDeviceId !== null &&
                state.activeDeviceId !== state.myDeviceId;
            if (!isRemote) {
                lastRemoteSig = '';
                return;
            }

            // Play order, so a shuffled session is topped up at its real end (I-040).
            const remaining = remainingRemote(
                state.remoteQueueIndex,
                state.remoteQueue.length,
                state.remoteOrder,
            );
            const nowId = state.remoteQueue[state.remoteQueueIndex]?.id;
            if (!nowId) {
                return;
            }

            const sig = `${nowId}:${remaining}`;
            if (sig === lastRemoteSig && !force) {
                return;
            }
            lastRemoteSig = sig;

            if (!settings.enabled || remaining >= settings.timing) {
                return;
            }

            void runRemoteAutoDj(nowId);
        };
        const unsubscribeRemote = useHubStore.subscribe((state) => onHub(state));

        // navi-connect (I-040): the station engine just failed (a 503) with the queue already
        // at its end. Upstream's listener only fires on a change, and at the last track none
        // may come, so look once now that Auto DJ has taken over.
        if (useStationStore.getState().actions.consumeFallbackKick()) {
            void listener(selector(usePlayerStoreBase.getState()));
            onHub(useHubStore.getState(), true);
        }

        return () => {
            unsubscribe();
            unsubscribeRemote();
        };
    }, [
        hasSimilarSongsMusicFolder,
        isFetching,
        player,
        queryClient,
        server,
        serverId,
        settings.enabled,
        settings.albumStrategy,
        settings.allowDuplicates,
        settings.itemCount,
        settings.mode,
        settings.onlySimilar,
        settings.songStrategy,
        settings.timing,
    ]);
};

const AutoDJHookInner = () => {
    useAutoDJ();
    return null;
};

export const AutoDJHook = () => {
    const isAutoDJEnabled = useSettingsStore((state) => state.autoDJ.enabled);
    // navi-connect (I-040): only when the hub's station engine is not there to do this.
    const stationMode = useStationMode();

    if (!isAutoDJEnabled || stationMode !== 'fallback') {
        return null;
    }

    return React.createElement(AutoDJHookInner);
};
