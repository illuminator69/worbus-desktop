import { closeAllModals, openModal } from '@mantine/modals';
import { QueryClient, useIsFetching, useQueryClient } from '@tanstack/react-query';
import { nanoid } from 'nanoid/non-secure';
import { createContext, useCallback, useContext, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { queryKeys } from '/@/renderer/api/query-keys';
import { albumQueries } from '/@/renderer/features/albums/api/album-api';
import { artistsQueries } from '/@/renderer/features/artists/api/artists-api';
import { notePauseRequest, notePlayRequest } from '/@/renderer/features/hub/utils/play-request';
import {
    addToQueueTypeToRemoteMode,
    commandedRemoteVolume,
    enqueueToRemote,
    isRemoteSessionActive,
    remoteAct,
    remotePositionMsShown,
    remoteTogglePlayPause,
    remoteVolumePinned,
} from '/@/renderer/features/hub/utils/remote-queue';
import { keepsCurrentSong } from '/@/renderer/features/player/station/keep-current'; // navi-connect (B-175)
import { currentSongId } from '/@/renderer/features/player/station/station-client'; // navi-connect (B-175)
import {
    filterSongsByPlayerFilters,
    getAlbumArtistSongsById,
    getAlbumSongsById,
    getGenreSongsById,
    getPlaylistSongsById,
    getSongsByFolder,
} from '/@/renderer/features/player/utils';
import {
    beginQueueSession,
    isNewQueueSessionPending,
} from '/@/renderer/features/player/utils/saved-queue-source';
import { playlistsQueries } from '/@/renderer/features/playlists/api/playlists-api';
import { songsQueries } from '/@/renderer/features/songs/api/songs-api';
import {
    AddToQueueOptions,
    AddToQueueType,
    useHubStore,
    usePlayerActions,
    usePlayerStore,
    useSettingsStore,
    useSettingsStoreActions,
} from '/@/renderer/store';
import { logger } from '/@/renderer/utils/logger';
import { shuffle as shuffleArray } from '/@/renderer/utils/shuffle';
import { sortSongsByFetchedOrder } from '/@/shared/api/utils';
import { Checkbox } from '/@/shared/components/checkbox/checkbox';
import { ConfirmModal } from '/@/shared/components/modal/modal';
import { Stack } from '/@/shared/components/stack/stack';
import { Text } from '/@/shared/components/text/text';
import { toast } from '/@/shared/components/toast/toast';
import { useLocalStorage } from '/@/shared/hooks/use-local-storage';
import {
    AlbumListSort,
    instanceOfCancellationError,
    LibraryItem,
    PlaylistSongListResponse,
    QueueSong,
    Song,
} from '/@/shared/types/domain-types';
import { Play, PlayerRepeat, PlayerShuffle, PlayerStatus } from '/@/shared/types/types';

export interface PlayerContext {
    addToQueueByData: (
        data: Song[],
        type: AddToQueueType,
        playSongId?: string,
        contextPlaylistId?: null | string,
        // Bypasses confirmQueueChange entirely — for callers (the remote
        // control bridge) that already obtained confirmation themselves
        // before calling this, where the confirm modal this would otherwise
        // open has no way to reach whoever actually needs to answer it.
        skipConfirmation?: boolean,
        // navi-connect (I-040): runs when the change really happens, i.e. after a
        // "Discard the current queue?" was confirmed, never when it was cancelled.
        // A radio arms its station binding and names its session here.
        onApply?: () => void,
    ) => void;
    addToQueueByFetch: (
        serverId: string,
        id: string[],
        itemType: LibraryItem,
        type: AddToQueueType,
        options?: AddToQueueOptions,
    ) => void;
    addToQueueByListQuery: (
        serverId: string,
        query: any,
        itemType: LibraryItem,
        type: AddToQueueType,
    ) => Promise<void>;
    clearQueue: (skipConfirmation?: boolean) => void;
    clearSelected: (items: QueueSong[]) => void;
    decreaseVolume: (amount: number) => void;
    getQueue: () => QueueSong[];
    increaseVolume: (amount: number) => void;
    mediaNext: (toNextAlbum: boolean) => void;
    mediaPause: () => void;
    mediaPlay: (id?: string) => void;
    mediaPlayByIndex: (index: number) => void;
    mediaPrevious: (toPreviousAlbum: boolean) => void;
    mediaSeekToTimestamp: (timestamp: number) => void;
    mediaSkipBackward: () => void;
    mediaSkipForward: () => void;
    mediaStop: (options?: { reset?: boolean }) => void;
    mediaToggleMute: () => void;
    mediaTogglePlayPause: () => void;
    moveSelectedTo: (items: QueueSong[], edge: 'bottom' | 'top', uniqueId: string) => void;
    moveSelectedToBottom: (items: QueueSong[]) => void;
    moveSelectedToNext: (items: QueueSong[]) => void;
    moveSelectedToTop: (items: QueueSong[]) => void;
    // navi-connect (B-175): `data[0]` is the song playing now (here or on the remote device); it
    // keeps playing where it is and everything else in the queue is replaced by the rest of
    // `data`. Same confirmation, onApply and remote routing as addToQueueByData's Play.NOW.
    playKeepingCurrent: (data: Song[], skipConfirmation?: boolean, onApply?: () => void) => void;
    setQueue: (data: Song[], index?: number, position?: number) => void;
    setRepeat: (repeat: PlayerRepeat) => void;
    setShuffle: (shuffle: PlayerShuffle) => void;
    setSpeed: (speed: number) => void;
    setVolume: (volume: number) => void;
    shuffle: () => void;
    shuffleAll: () => void;
    shuffleSelected: (items: QueueSong[]) => void;
    toggleRepeat: () => void;
    toggleShuffle: () => void;
}

export const PlayerContext = createContext<PlayerContext>({
    addToQueueByData: () => {},
    addToQueueByFetch: async () => {},
    addToQueueByListQuery: async () => {},
    clearQueue: () => {},
    clearSelected: () => {},
    decreaseVolume: () => {},
    getQueue: () => [],
    increaseVolume: () => {},
    mediaNext: () => {},
    mediaPause: () => {},
    mediaPlay: () => {},
    mediaPlayByIndex: () => {},
    mediaPrevious: () => {},
    mediaSeekToTimestamp: () => {},
    mediaSkipBackward: () => {},
    mediaSkipForward: () => {},
    mediaStop: () => {},
    mediaToggleMute: () => {},
    mediaTogglePlayPause: () => {},
    moveSelectedTo: () => {},
    moveSelectedToBottom: () => {},
    moveSelectedToNext: () => {},
    moveSelectedToTop: () => {},
    playKeepingCurrent: () => {}, // navi-connect (B-175)
    setQueue: () => {},
    setRepeat: () => {},
    setShuffle: () => {},
    setSpeed: () => {},
    setVolume: () => {},
    shuffle: () => {},
    shuffleAll: () => {},
    shuffleSelected: () => {},
    toggleRepeat: () => {},
    toggleShuffle: () => {},
});

/**
 * Current volume (0-100) of the active remote device, for relative changes.
 *
 * The level this client last asked for outranks the device's row while the `devices` frame that
 * answers it is still on its way: stepping from the row made a second wheel notch, hotkey press
 * or mute click inside the round trip start from the level before the first. Against a hub that
 * acknowledges acts that level is pinned until its ack (I-031, act-pins.ts); against an older
 * one it stands for 2.5 s (volume-hold.ts). Only one of the two is ever set.
 */
const remoteActiveVolume = (): number => {
    const s = useHubStore.getState();
    return (
        remoteVolumePinned(s) ??
        commandedRemoteVolume() ??
        s.devices.find((d) => d.id === s.activeDeviceId)?.volume ??
        100
    );
};

/** How far the skip buttons jump, per the user's settings. */
const skipAmount = (direction: 'backward' | 'forward'): number => {
    const buttons = useSettingsStore.getState().general.skipButtons;
    return direction === 'forward'
        ? (buttons?.skipForwardSeconds ?? 10)
        : (buttons?.skipBackwardSeconds ?? 5);
};

/**
 * Skip relative to where the remote session actually is.
 *
 * The hub only understands absolute seeks, so the current position has to be interpolated the
 * same way the scrubber does: `remotePositionMs` is a ~1 Hz sample, and skipping from the
 * sample rather than from now would lose up to a second every press. And from the position
 * the scrubber SHOWS (I-031): a second press inside the round trip of the first steps on from
 * where that one sought to, not again from the sample.
 */
const remoteSeekBy = (deltaSeconds: number): boolean => {
    if (!isRemoteSessionActive()) return false;
    const positionMs = Math.max(0, remotePositionMsShown() + deltaSeconds * 1000);
    return remoteAct('seek', { positionMs: Math.round(positionMs) });
};

/**
 * Move a single queue row via the hub. Returns false when the request can't be expressed as one
 * `move` — the caller then says so rather than falling through to the local player.
 *
 * Multi-item moves are refused deliberately: `move` is a single from→to, and applying several in
 * sequence races the session frames coming back the other way.
 */
const remoteMoveTo = (items: { _uniqueId: string }[], edge: 'bottom' | 'next' | 'top'): boolean => {
    if (items.length !== 1) return false;
    const from = Number(items[0]._uniqueId.slice('remote:'.length));
    if (Number.isNaN(from)) return false;
    const s = useHubStore.getState();
    const last = Math.max(0, s.remoteQueue.length - 1);
    const desired =
        edge === 'top' ? 0 : edge === 'bottom' ? last : Math.min(last, s.remoteQueueIndex + 1);
    // `desired` is in pre-removal coordinates, and the hub pops `from` before inserting — so a
    // downward move lands one slot short. Same adjustment as moveSelectedTo below.
    const to = from < desired ? desired - 1 : desired;
    if (to === from) return true;
    return remoteAct('move', { from, to });
};

const getRootQueryKey = (itemType: LibraryItem, serverId: string) => {
    switch (itemType) {
        case LibraryItem.ALBUM:
            return queryKeys.songs.root(serverId);
        case LibraryItem.ALBUM_ARTIST:
            return queryKeys.songs.root(serverId);
        case LibraryItem.ARTIST:
            return queryKeys.songs.root(serverId);
        case LibraryItem.GENRE:
            return queryKeys.songs.root(serverId);
        case LibraryItem.PLAYLIST:
            return queryKeys.playlists.root(serverId);
        case LibraryItem.SONG:
            return queryKeys.songs.root(serverId);
        default:
            return queryKeys.songs.root(serverId);
    }
};

const isReplaceQueueType = (type: AddToQueueType): boolean => {
    if (typeof type === 'object') return false;
    return type === Play.NOW || type === Play.SHUFFLE;
};

// navi-connect: replacing the queue is the ONE thing that starts a new listening session, and
// therefore a new saved-queue history record. Every other queue mutation (next/last/insert,
// reorder, remove, Auto DJ top-up) keeps the current record. Call sites that know what they're
// playing (an album/playlist header, a radio generator) announce a name first — beginQueueSession
// keeps whichever announcement came last, and a bare replace falls back to inference.
const announceNewQueueSession = (type: AddToQueueType): void => {
    if (!isReplaceQueueType(type)) return;
    // navi-connect (B-058): and a replace starts playback the user asked for (Play.NOW / SHUFFLE,
    // from every play button, menu and Worbus for desktop's remote) - use-hub's guards must not pause it.
    notePlayRequest();
    if (isNewQueueSessionPending()) return; // a call site already named it
    beginQueueSession('manual');
};

// HashRouter puts the route in location.hash, not pathname.
const inferPlaylistContextFromUrl = (): null | string => {
    const route = window.location.hash.replace(/^#/, '');
    const match = route.match(/^\/playlists\/([^/]+)/);
    return match ? match[1] : null;
};

// Stamps each song with the playlist it was queued from, so the sidebar highlight
// can be derived from whichever song is currently playing (see useCurrentPlaylistContextId).
const tagPlaylistContext = (songs: Song[], contextPlaylistId: string): Song[] =>
    songs.map((song) => ({ ...song, _contextPlaylistId: contextPlaylistId }));

export const PlayerProvider = ({ children }: { children: React.ReactNode }) => {
    const { t } = useTranslation();
    const queryClient = useQueryClient();
    /** Volume to restore on unmute — the hub has no mute, only a level. */
    const mutedVolume = useRef(100);
    const storeActions = usePlayerActions();
    const settingsActions = useSettingsStoreActions();
    const timeoutIds = useRef<null | Record<string, ReturnType<typeof setTimeout>>>({});

    const [doNotShowAgain, setDoNotShowAgain] = useLocalStorage({
        defaultValue: false,
        key: 'large_fetch_confirmation',
    });

    const confirmQueueChange = useCallback(
        (onConfirm: () => void) => {
            const shouldConfirm = useSettingsStore.getState().general.confirmQueueChanges;

            if (!shouldConfirm || storeActions.getQueue().items.length === 0) {
                onConfirm();
                return;
            }

            openModal({
                children: (
                    <ConfirmModal
                        labels={{
                            cancel: t('common.cancel'),
                            confirm: t('common.confirm'),
                        }}
                        onConfirm={() => {
                            closeAllModals();
                            onConfirm();
                        }}
                    >
                        <Stack>
                            <Text>{t('form.queueChangeConfirmation.description')}</Text>
                            <Checkbox
                                label={t('common.doNotShowAgain')}
                                onChange={(event) => {
                                    settingsActions.setSettings({
                                        general: {
                                            confirmQueueChanges: !event.currentTarget.checked,
                                        },
                                    });
                                }}
                            />
                        </Stack>
                    </ConfirmModal>
                ),
                title: t('form.queueChangeConfirmation.title'),
            });
        },
        [settingsActions, storeActions, t],
    );

    const confirmLargeFetch = useCallback((): Promise<boolean> => {
        if (doNotShowAgain) {
            return Promise.resolve(true);
        }

        return new Promise((resolve) => {
            openModal({
                children: (
                    <ConfirmModal
                        labels={{
                            cancel: t('common.cancel'),
                            confirm: t('common.confirm'),
                        }}
                        onCancel={() => {
                            resolve(false);
                            closeAllModals();
                        }}
                        onConfirm={() => {
                            resolve(true);
                            closeAllModals();
                        }}
                    >
                        <Stack>
                            <Text>{t('form.largeFetchConfirmation.description')}</Text>
                            <Checkbox
                                label={t('common.doNotShowAgain')}
                                onChange={(event) => {
                                    setDoNotShowAgain(event.currentTarget.checked);
                                }}
                            />
                        </Stack>
                    </ConfirmModal>
                ),
                title: t('form.largeFetchConfirmation.title'),
            });
        });
    }, [doNotShowAgain, setDoNotShowAgain, t]);

    const addToQueueByData = useCallback(
        (
            data: Song[],
            type: AddToQueueType,
            playSongId?: string,
            contextPlaylistId?: null | string,
            skipConfirmation?: boolean,
            onApply?: () => void,
        ) => {
            const filters = useSettingsStore.getState().playback.filters;
            let filteredData = filterSongsByPlayerFilters(data, filters);
            const resolvedContextId =
                contextPlaylistId ??
                (isReplaceQueueType(type) ? inferPlaylistContextFromUrl() : null);
            if (resolvedContextId) {
                filteredData = tagPlaylistContext(filteredData, resolvedContextId);
            }

            const addToQueue = () => {
                onApply?.();
                announceNewQueueSession(type);

                // When playback is on another navi-connect device, route to it
                // instead of the (paused) local player.
                if (isRemoteSessionActive()) {
                    // Thread the clicked song → start index so Play.NOW on a specific
                    // track starts there remotely instead of at track 1.
                    const startIndex = playSongId
                        ? Math.max(
                              0,
                              filteredData.findIndex((song) => song.id === playSongId),
                          )
                        : 0;
                    void enqueueToRemote(
                        filteredData,
                        addToQueueTypeToRemoteMode(type),
                        startIndex,
                    );
                    return;
                }

                if (typeof type === 'object' && 'edge' in type && type.edge !== null) {
                    const edge = type.edge === 'top' ? 'top' : 'bottom';

                    logger.debug('Added to queue by data', {
                        data: data.length,
                        edge,
                        filtered: filteredData.length,
                        type,
                        uniqueId: type.uniqueId,
                    });

                    storeActions.addToQueueByUniqueId(
                        filteredData,
                        type.uniqueId,
                        edge,
                        playSongId,
                    );
                } else {
                    logger.debug('Added to queue by type', {
                        data: data.length,
                        filtered: filteredData.length,
                        type,
                    });

                    storeActions.addToQueueByType(filteredData, type as Play, playSongId);
                }
            };

            if (!skipConfirmation && isReplaceQueueType(type)) {
                confirmQueueChange(addToQueue);
            } else {
                addToQueue();
            }
        },
        [confirmQueueChange, storeActions],
    );

    // navi-connect (B-175)
    const playKeepingCurrent = useCallback(
        (data: Song[], skipConfirmation?: boolean, onApply?: () => void) => {
            const [current, ...rest] = data;
            if (!current) return;
            let tail = filterSongsByPlayerFilters(
                rest,
                useSettingsStore.getState().playback.filters,
            );
            // As Play.NOW tags what it queues from a playlist page (the sidebar's highlight).
            const contextPlaylistId = inferPlaylistContextFromUrl();
            if (contextPlaylistId) tail = tagPlaylistContext(tail, contextPlaylistId);

            const apply = () => {
                // The song can change while the confirmation is open (it ends, or is skipped):
                // keep only the song the radio was started from, else the old replace.
                if (!keepsCurrentSong(data, currentSongId())) {
                    logger.debug('The playing song changed, replacing the queue instead');
                    addToQueueByData(data, Play.NOW, undefined, undefined, true, onApply);
                    return;
                }

                onApply?.();
                announceNewQueueSession(Play.NOW);

                if (isRemoteSessionActive()) {
                    // The hub has no "replace after the current row": a setQueue at index 0 that
                    // carries the remote device's own position continues the song there.
                    void enqueueToRemote([current, ...tail], 'now', 0, {
                        positionMs: remotePositionMsShown(),
                    });
                    return;
                }

                logger.debug('Kept the current song, replaced the rest', { tail: tail.length });
                if (!storeActions.keepCurrentAndReplaceRest(current.id, tail)) {
                    // Checked above in the same tick, so not expected: the old replace.
                    storeActions.addToQueueByType([current, ...tail], Play.NOW);
                }
            };

            if (!skipConfirmation) {
                confirmQueueChange(apply);
            } else {
                apply();
            }
        },
        [addToQueueByData, confirmQueueChange, storeActions],
    );

    const addToQueueByFetch = useCallback(
        async (
            serverId: string,
            id: string[],
            itemType: LibraryItem,
            type: AddToQueueType,
            options?: AddToQueueOptions,
        ) => {
            let toastId: null | string = null;
            const fetchId = nanoid();

            timeoutIds.current = {
                ...timeoutIds.current,
                [fetchId]: setTimeout(() => {
                    toastId = toast.info({
                        autoClose: false,
                        message: t('player.playbackFetchCancel'),
                        onClose: () => {
                            queryClient.cancelQueries({
                                exact: false,
                                queryKey: getRootQueryKey(itemType, serverId),
                            });

                            queryClient.cancelQueries({
                                exact: false,
                                queryKey: queryKeys.player.fetch(),
                            });
                        },
                        title: t('player.playbackFetchInProgress'),
                    });
                }, 2000),
            };

            try {
                logger.debug('Added to queue by fetch', { ids: id, itemType, serverId, type });

                const songs = await queryClient.fetchQuery({
                    gcTime: 0,
                    queryFn: () => {
                        return fetchSongsByItemType(queryClient, serverId, {
                            id,
                            itemType,
                        });
                    },
                    queryKey: queryKeys.player.fetch(),
                    staleTime: 0,
                });

                clearTimeout(timeoutIds.current[fetchId] as ReturnType<typeof setTimeout>);
                delete timeoutIds.current[fetchId];
                if (toastId) {
                    toast.hide(toastId);
                }

                let sortedSongs: Song[] = [];

                // Playlists should use the native order of the playlist
                if (itemType === LibraryItem.PLAYLIST) {
                    sortedSongs = songs;
                } else {
                    sortedSongs = sortSongsByFetchedOrder(songs, id, itemType);
                }

                const filters = useSettingsStore.getState().playback.filters;
                let filteredSongs = filterSongsByPlayerFilters(sortedSongs, filters);

                if (options?.filter) {
                    filteredSongs = filteredSongs.filter(options.filter);
                }

                // Songs from multiple playlists are merged together, so there is no single
                // playlist to attribute them to: skip tagging (and URL inference) entirely.
                const isMultiPlaylist = itemType === LibraryItem.PLAYLIST && id.length > 1;
                const explicitId =
                    itemType === LibraryItem.PLAYLIST && id.length === 1 ? id[0] : null;
                const resolvedContextId =
                    explicitId ??
                    (!isMultiPlaylist && isReplaceQueueType(type)
                        ? inferPlaylistContextFromUrl()
                        : null);
                if (resolvedContextId) {
                    filteredSongs = tagPlaylistContext(filteredSongs, resolvedContextId);
                }

                const addToQueue = () => {
                    announceNewQueueSession(type);

                    if (isRemoteSessionActive()) {
                        void enqueueToRemote(filteredSongs, addToQueueTypeToRemoteMode(type));
                    } else if (typeof type === 'object' && 'edge' in type && type.edge !== null) {
                        const edge = type.edge === 'top' ? 'top' : 'bottom';
                        storeActions.addToQueueByUniqueId(filteredSongs, type.uniqueId, edge);
                    } else {
                        storeActions.addToQueueByType(filteredSongs, type as Play);
                    }
                };

                if (!options?.skipConfirmation && isReplaceQueueType(type)) {
                    confirmQueueChange(addToQueue);
                } else {
                    addToQueue();
                }
            } catch (err: any) {
                if (instanceOfCancellationError(err)) {
                    return;
                }

                clearTimeout(timeoutIds.current[fetchId] as ReturnType<typeof setTimeout>);
                delete timeoutIds.current[fetchId];
                if (toastId) {
                    toast.hide(toastId);
                }

                toast.error({
                    message: err.message,
                    title: t('error.genericError') as string,
                });
            }
        },
        [confirmQueueChange, queryClient, storeActions, t],
    );

    const addToQueueByListQuery = useCallback(
        async (serverId: string, query: any, itemType: LibraryItem, type: AddToQueueType) => {
            let toastId: null | string = null;
            let fetchId: null | string = null;

            logger.debug('Added to queue by list query', { itemType, query, serverId, type });

            try {
                let totalCount = 0;
                let listQueryFn: any;
                let listCountQueryFn: any;

                // Special handling for albums with random sort: fetch in name order, then shuffle client-side
                const isAlbumRandomSort =
                    itemType === LibraryItem.ALBUM && query.sortBy === AlbumListSort.RANDOM;

                const fetchQuery = isAlbumRandomSort
                    ? { ...query, sortBy: AlbumListSort.NAME }
                    : query;

                switch (itemType) {
                    case LibraryItem.ALBUM: {
                        listQueryFn = albumQueries.list;
                        listCountQueryFn = albumQueries.listCount;
                        break;
                    }
                    case LibraryItem.ALBUM_ARTIST: {
                        listQueryFn = artistsQueries.albumArtistList;
                        listCountQueryFn = artistsQueries.albumArtistListCount;
                        break;
                    }
                    case LibraryItem.ARTIST: {
                        listQueryFn = artistsQueries.artistList;
                        listCountQueryFn = artistsQueries.artistListCount;
                        break;
                    }
                    case LibraryItem.PLAYLIST: {
                        listQueryFn = playlistsQueries.list;
                        listCountQueryFn = playlistsQueries.listCount;
                        break;
                    }
                    case LibraryItem.SONG: {
                        listQueryFn = songsQueries.list;
                        listCountQueryFn = songsQueries.listCount;
                        break;
                    }
                    default: {
                        throw new Error(`Unsupported item type: ${itemType}`);
                    }
                }

                // Get total count
                const countResult = (await queryClient.fetchQuery({
                    ...listCountQueryFn({
                        query: { ...fetchQuery },
                        serverId,
                    }),
                    gcTime: 0,
                    queryKey: queryKeys.player.fetch(),
                    staleTime: 0,
                })) as number;
                totalCount = countResult || 0;

                const allResults: Song[] | string[] = [];
                const pageSize = 500;

                const confirmed = await confirmLargeFetch();
                if (!confirmed) {
                    return;
                }

                // Start timeout only after confirmation (if needed)
                fetchId = nanoid();

                timeoutIds.current = {
                    ...timeoutIds.current,
                    [fetchId]: setTimeout(() => {
                        toastId = toast.info({
                            autoClose: false,
                            message: t('player.playbackFetchCancel'),
                            onClose: () => {
                                logger.debug('Cancelled fetch', { itemType, serverId });

                                queryClient.cancelQueries({
                                    exact: false,
                                    queryKey: getRootQueryKey(itemType, serverId),
                                });

                                queryClient.cancelQueries({
                                    exact: false,
                                    queryKey: queryKeys.player.fetch(),
                                });
                            },
                            title: t('player.playbackFetchInProgress'),
                        });
                    }, 2000),
                };
                let startIndex = 0;

                while (startIndex < totalCount) {
                    const pageQuery = {
                        ...fetchQuery,
                        limit: pageSize,
                        startIndex,
                    };

                    const pageResult = (await queryClient.fetchQuery({
                        ...listQueryFn({
                            query: pageQuery,
                            serverId,
                        }),
                        gcTime: 0,
                        queryKey: queryKeys.player.fetch({ startIndex }),
                        staleTime: 0,
                    })) as { items: any[] };

                    if (pageResult?.items) {
                        if (itemType === LibraryItem.SONG) {
                            allResults.push(...pageResult.items);
                        } else {
                            const pageIds = pageResult.items.map((item: any) => item.id);
                            allResults.push(...pageIds);
                        }
                    }

                    // If we got fewer items than requested, we've reached the end
                    if (!pageResult?.items || pageResult.items.length < pageSize) {
                        break;
                    }

                    startIndex += pageSize;
                }

                if (fetchId && timeoutIds.current) {
                    clearTimeout(timeoutIds.current[fetchId] as ReturnType<typeof setTimeout>);
                    delete timeoutIds.current[fetchId];
                }

                if (toastId) {
                    toast.hide(toastId);
                }

                // Shuffle album IDs client-side if this was a random sort request
                let finalResults = allResults;
                if (isAlbumRandomSort && itemType === LibraryItem.ALBUM) {
                    finalResults = shuffleArray(allResults as string[]) as typeof allResults;
                }

                if (itemType === LibraryItem.SONG) {
                    addToQueueByData(finalResults as Song[], type);
                } else {
                    await addToQueueByFetch(serverId, finalResults as string[], itemType, type);
                }
            } catch (err: any) {
                if (instanceOfCancellationError(err)) {
                    return;
                }

                if (fetchId && timeoutIds.current) {
                    clearTimeout(timeoutIds.current[fetchId] as ReturnType<typeof setTimeout>);
                    delete timeoutIds.current[fetchId];
                }
                if (toastId) {
                    toast.hide(toastId);
                }

                toast.error({
                    message: err.message,
                    title: t('error.genericError') as string,
                });
            }
        },
        [queryClient, confirmLargeFetch, t, addToQueueByData, addToQueueByFetch],
    );

    /**
     * Say so instead of silently driving the dead local player.
     *
     * The transport actions below used to fall straight through to `storeActions` during a
     * remote session. That is worse than doing nothing: the local audio engine is not idle,
     * it is deliberately held silent, and poking it is how the runaway-audio class of bug
     * starts — the user hears their own machine start playing under a bar that says the
     * music is on the speaker. Anything without a hub equivalent must be a visible no-op.
     */
    const unsupportedOnRemote = useCallback((what: string) => {
        toast.warn({ message: `${what} isn't supported on a remote device.` });
    }, []);

    const clearQueue = useCallback(
        (skipConfirmation?: boolean) => {
            const run = () => {
                if (remoteAct('clear')) return;

                logger.debug('Cleared queue');

                storeActions.clearQueue();
            };

            // Same bypass as addToQueueByData's skipConfirmation — the
            // remote control bridge already obtained confirmation on the
            // phone itself before calling this, and the modal
            // confirmQueueChange would otherwise open has no way to reach
            // whoever actually needs to answer it.
            if (skipConfirmation) {
                run();
            } else {
                confirmQueueChange(run);
            }
        },
        [confirmQueueChange, storeActions],
    );

    const clearSelected = useCallback(
        (items: QueueSong[]) => {
            logger.debug('Cleared selected', { items: items.length });

            if (isRemoteSessionActive()) {
                // The hub removes one index at a time. Highest first, so each removal can't
                // shift the indexes of the ones still to go.
                const indexes = items
                    .map((item) => Number(item._uniqueId.slice('remote:'.length)))
                    .filter((n) => !Number.isNaN(n))
                    .sort((a, b) => b - a);
                indexes.forEach((index) => remoteAct('remove', { index }));
                return;
            }

            storeActions.clearSelected(items);
        },
        [storeActions],
    );

    const decreaseVolume = useCallback(
        (amount: number) => {
            if (isRemoteSessionActive()) {
                remoteAct('volume', { level: Math.max(0, remoteActiveVolume() - amount) });
                return;
            }

            logger.debug('Decreased volume', { amount });

            storeActions.decreaseVolume(amount);
        },
        [storeActions],
    );

    const getQueue = useCallback(() => {
        const queue = storeActions.getQueue();
        return queue.items;
    }, [storeActions]);

    const increaseVolume = useCallback(
        (amount: number) => {
            if (isRemoteSessionActive()) {
                remoteAct('volume', { level: Math.min(100, remoteActiveVolume() + amount) });
                return;
            }

            logger.debug('Increased volume', { amount });

            storeActions.increaseVolume(amount);
        },
        [storeActions],
    );

    const mediaNext = useCallback(
        (toNextAlbum: boolean) => {
            // When playback is on another navi-connect device, the playerbar's
            // controls drive the session instead of the (paused) local player.
            if (remoteAct('next')) return;

            logger.debug('Media next');

            storeActions.mediaNext(toNextAlbum);
        },
        [storeActions],
    );

    const mediaPause = useCallback(() => {
        if (remoteAct('pause')) return;

        logger.debug('Media pause');

        // navi-connect (B-058): withdraws the play the user asked for before it (play-request.ts).
        // mpv's own `paused` echo comes through here too; that only makes the guards stricter.
        notePauseRequest();
        storeActions.mediaPause();
    }, [storeActions]);

    const mediaPlay = useCallback(
        (id?: string) => {
            // In a remote session the queue rows carry a `remote:<index>`
            // sentinel uniqueId — a double-click on one means "jump there".
            // A plain mediaPlay() (e.g. resume) just resumes the session.
            if (isRemoteSessionActive()) {
                if (id?.startsWith('remote:')) {
                    remoteAct('jump', { index: Number(id.slice('remote:'.length)) });
                } else {
                    remoteAct('play');
                }
                return;
            }

            logger.debug('Media play', { id });

            // navi-connect (B-058): deliberately NOT marked as a requested play (notePlayRequest):
            // mpv's own `resumed` echo arrives through here too. Each caller marks its own.
            storeActions.mediaPlay(id);
        },
        [storeActions],
    );

    const mediaPlayByIndex = useCallback(
        (index: number) => {
            if (remoteAct('jump', { index })) return;

            logger.debug('Media play by index', { index });

            storeActions.mediaPlayByIndex(index);
        },
        [storeActions],
    );

    const mediaPrevious = useCallback(
        (toPreviousAlbum: boolean) => {
            if (remoteAct('previous')) return;

            logger.debug('Media previous');

            storeActions.mediaPrevious(toPreviousAlbum);
        },
        [storeActions],
    );

    const mediaStop = useCallback(
        (options?: { reset?: boolean }) => {
            // There is no hub `stop`: a remote receiver holds the session whether or not it
            // is playing. Pausing (and rewinding, when asked to reset) is the honest
            // equivalent — stopping would mean tearing down someone else's playback.
            if (isRemoteSessionActive()) {
                remoteAct('pause');
                if (options?.reset) remoteAct('seek', { positionMs: 0 });
                return;
            }

            logger.debug('Media stop', { reset: options?.reset });

            notePauseRequest(); // navi-connect (B-058): see mediaPause
            storeActions.mediaStop(options);
        },
        [storeActions],
    );

    const mediaSeekToTimestamp = useCallback(
        (timestamp: number) => {
            if (remoteAct('seek', { positionMs: Math.round(timestamp * 1000) })) return;

            logger.debug('Media seek to timestamp', { timestamp });

            storeActions.mediaSeekToTimestamp(timestamp);
        },
        [storeActions],
    );

    const mediaSkipBackward = useCallback(() => {
        if (remoteSeekBy(-skipAmount('backward'))) return;

        logger.debug('Media skip backward');

        storeActions.mediaSkipBackward();
    }, [storeActions]);

    const mediaSkipForward = useCallback(() => {
        if (remoteSeekBy(skipAmount('forward'))) return;

        logger.debug('Media skip forward');

        storeActions.mediaSkipForward();
    }, [storeActions]);

    const setQueue = useCallback(
        (data: Song[], index?: number, position?: number) => {
            confirmQueueChange(() => {
                logger.debug('Set queue', {
                    data: data.length,
                    index,
                    position,
                });

                notePlayRequest(); // navi-connect (B-058): a setQueue without `play` starts playing
                storeActions.setQueue(data, index, position);
            });
        },
        [confirmQueueChange, storeActions],
    );

    const setSpeed = useCallback(
        (speed: number) => {
            // Playback rate is a property of the audio engine doing the decoding, which is on
            // the other device (or is a Chromecast, which has no such control at all).
            if (isRemoteSessionActive()) {
                unsupportedOnRemote('Changing playback speed');
                return;
            }

            logger.debug('Set speed', { speed });

            storeActions.setSpeed(speed);
        },
        [storeActions, unsupportedOnRemote],
    );

    const mediaToggleMute = useCallback(() => {
        // No hub `mute`: mute is volume 0 with the old level remembered, which is exactly what
        // the local store does too. Muting locally would leave the remote device at full volume
        // while the UI showed it silenced.
        if (isRemoteSessionActive()) {
            const current = remoteActiveVolume();
            if (current > 0) {
                mutedVolume.current = current;
                remoteAct('volume', { level: 0 });
            } else {
                remoteAct('volume', { level: mutedVolume.current || 100 });
            }
            return;
        }

        logger.debug('Media toggle mute');

        storeActions.mediaToggleMute();
    }, [storeActions]);

    const mediaTogglePlayPause = useCallback(() => {
        if (remoteTogglePlayPause()) return;

        logger.debug('Media toggle play pause');

        // navi-connect (B-058): a toggle that starts playback is a play the user asked for - every
        // caller is a person (the play button, the mobile bars, the main process's play-pause:
        // tray, dock, thumbar, global shortcut, MPRIS, media keys).
        if (usePlayerStore.getState().player.status !== PlayerStatus.PLAYING) notePlayRequest();
        else notePauseRequest();
        storeActions.mediaTogglePlayPause();
    }, [storeActions]);

    const moveSelectedTo = useCallback(
        (items: QueueSong[], edge: 'bottom' | 'top', uniqueId: string) => {
            logger.debug('Moved selected to', { edge, items, uniqueId });

            // Remote session: reorder via the hub (rows carry `remote:<i>` ids).
            // The hub `move` act is a single from→to; a multi-item drag can't be
            // expressed atomically and applying them one-by-one races incoming
            // session frames, so surface it instead of silently doing nothing.
            if (isRemoteSessionActive()) {
                if (items.length === 1) {
                    const from = Number(items[0]._uniqueId.slice('remote:'.length));
                    const target = Number(uniqueId.slice('remote:'.length));
                    if (!Number.isNaN(from) && !Number.isNaN(target)) {
                        const desired = edge === 'bottom' ? target + 1 : target;
                        // The hub pops `from` then inserts at `to`, so adjust for the
                        // shift when moving an item downward.
                        const to = from < desired ? desired - 1 : desired;
                        if (to !== from) remoteAct('move', { from, to });
                    }
                } else if (items.length > 1) {
                    toast.warn({
                        message:
                            'Reordering multiple tracks at once isn’t supported on a remote device.',
                    });
                }
                return;
            }

            storeActions.moveSelectedTo(items, uniqueId, edge);
        },
        [storeActions],
    );

    const moveSelectedToBottom = useCallback(
        (items: QueueSong[]) => {
            logger.debug('Moved selected to bottom', { items });

            if (isRemoteSessionActive()) {
                if (!remoteMoveTo(items, 'bottom')) unsupportedOnRemote('Reordering these tracks');
                return;
            }

            storeActions.moveSelectedToBottom(items);
        },
        [storeActions, unsupportedOnRemote],
    );

    const moveSelectedToNext = useCallback(
        (items: QueueSong[]) => {
            logger.debug('Moved selected to next', { items });

            if (isRemoteSessionActive()) {
                if (!remoteMoveTo(items, 'next')) unsupportedOnRemote('Reordering these tracks');
                return;
            }

            storeActions.moveSelectedToNext(items);
        },
        [storeActions, unsupportedOnRemote],
    );

    const moveSelectedToTop = useCallback(
        (items: QueueSong[]) => {
            logger.debug('Moved selected to top', { items });

            if (isRemoteSessionActive()) {
                if (!remoteMoveTo(items, 'top')) unsupportedOnRemote('Reordering these tracks');
                return;
            }

            storeActions.moveSelectedToTop(items);
        },
        [storeActions, unsupportedOnRemote],
    );

    const setVolume = useCallback(
        (volume: number) => {
            if (remoteAct('volume', { level: Math.round(volume) })) return;

            logger.debug('Set volume', { volume });

            storeActions.setVolume(volume);
        },
        [storeActions],
    );

    const setRepeat = useCallback(
        (repeat: PlayerRepeat) => {
            // PlayerRepeat values ('none'/'all'/'one') match the hub's modes.
            if (remoteAct('repeat', { mode: repeat })) return;

            logger.debug('Set repeat', { repeat });

            storeActions.setRepeat(repeat);
        },
        [storeActions],
    );

    const setShuffle = useCallback(
        (shuffle: PlayerShuffle) => {
            if (remoteAct('shuffle', { on: shuffle === PlayerShuffle.TRACK })) return;

            logger.debug('Set shuffle', { shuffle });

            storeActions.setShuffle(shuffle);
        },
        [storeActions],
    );

    // Both of these mean "re-randomise the play order". The hub owns `order`, and re-asserting
    // shuffle:true is how you ask it to compute a fresh one.
    const shuffle = useCallback(() => {
        if (remoteAct('shuffle', { on: true })) return;

        logger.debug('Shuffle');

        storeActions.shuffle();
    }, [storeActions]);

    const shuffleAll = useCallback(() => {
        if (remoteAct('shuffle', { on: true })) return;

        logger.debug('Shuffle all');

        storeActions.shuffleAll();
    }, [storeActions]);

    const shuffleSelected = useCallback(
        (items: QueueSong[]) => {
            logger.debug('Shuffle selected', { items });

            // Shuffling a SUBSET has no hub equivalent — `shuffle` reorders the whole queue.
            if (isRemoteSessionActive()) {
                unsupportedOnRemote('Shuffling a selection');
                return;
            }

            storeActions.shuffleSelected(items);
        },
        [storeActions, unsupportedOnRemote],
    );

    const toggleRepeat = useCallback(() => {
        if (isRemoteSessionActive()) {
            const cur = useHubStore.getState().remoteRepeat;
            const next = cur === 'none' ? 'all' : cur === 'all' ? 'one' : 'none';
            remoteAct('repeat', { mode: next });
            return;
        }

        logger.debug('Toggle repeat');

        storeActions.toggleRepeat();
    }, [storeActions]);

    const toggleShuffle = useCallback(() => {
        if (isRemoteSessionActive()) {
            remoteAct('shuffle', { on: !useHubStore.getState().remoteShuffle });
            return;
        }

        logger.debug('Toggle shuffle');

        storeActions.toggleShuffle();
    }, [storeActions]);

    const contextValue: PlayerContext = useMemo(
        () => ({
            addToQueueByData,
            addToQueueByFetch,
            addToQueueByListQuery,
            clearQueue,
            clearSelected,
            decreaseVolume,
            getQueue,
            increaseVolume,
            mediaNext,
            mediaPause,
            mediaPlay,
            mediaPlayByIndex,
            mediaPrevious,
            mediaSeekToTimestamp,
            mediaSkipBackward,
            mediaSkipForward,
            mediaStop,
            mediaToggleMute,
            mediaTogglePlayPause,
            moveSelectedTo,
            moveSelectedToBottom,
            moveSelectedToNext,
            moveSelectedToTop,
            playKeepingCurrent, // navi-connect (B-175)
            setQueue,
            setRepeat,
            setShuffle,
            setSpeed,
            setVolume,
            shuffle,
            shuffleAll,
            shuffleSelected,
            toggleRepeat,
            toggleShuffle,
        }),
        [
            addToQueueByData,
            addToQueueByFetch,
            addToQueueByListQuery,
            clearQueue,
            clearSelected,
            decreaseVolume,
            getQueue,
            increaseVolume,
            mediaNext,
            mediaPause,
            mediaPlay,
            mediaPlayByIndex,
            mediaPrevious,
            mediaSeekToTimestamp,
            mediaSkipBackward,
            mediaSkipForward,
            mediaStop,
            mediaToggleMute,
            mediaTogglePlayPause,
            moveSelectedTo,
            moveSelectedToBottom,
            moveSelectedToNext,
            moveSelectedToTop,
            playKeepingCurrent, // navi-connect (B-175)
            setQueue,
            setRepeat,
            setShuffle,
            setSpeed,
            setVolume,
            shuffle,
            shuffleAll,
            shuffleSelected,
            toggleRepeat,
            toggleShuffle,
        ],
    );

    return <PlayerContext.Provider value={contextValue}>{children}</PlayerContext.Provider>;
};

export const usePlayer = () => {
    return useContext(PlayerContext);
};

/**
 * Fetches the songs from the server
 * @param queryClient - The query client to use to fetch the data
 * @param serverId - The library id to use to fetch the data
 * @param type - The type of the item to add to the queue
 * @param args - The arguments to use to fetch the data
 * @returns The songs to add to the queue
 */
export async function fetchSongsByItemType(
    queryClient: QueryClient,
    serverId: string,
    args: {
        id: string[];
        itemType: LibraryItem;
        params?: Record<string, any>;
    },
) {
    const songs: Song[] = [];

    switch (args.itemType) {
        case LibraryItem.ALBUM: {
            const albumSongsResponse = await getAlbumSongsById({
                id: args.id,
                query: args.params,
                queryClient,
                serverId,
            });
            songs.push(...albumSongsResponse.items);
            break;
        }

        case LibraryItem.ALBUM_ARTIST: {
            const albumArtistSongsResponse = await getAlbumArtistSongsById({
                id: args.id,
                query: args.params,
                queryClient,
                serverId,
            });
            songs.push(...albumArtistSongsResponse.items);
            break;
        }

        case LibraryItem.ARTIST: {
            const artistSongsResponse = await getAlbumArtistSongsById({
                id: args.id,
                query: args.params,
                queryClient,
                serverId,
            });
            songs.push(...artistSongsResponse.items);
            break;
        }

        case LibraryItem.FOLDER: {
            const folderSongsResponse = await getSongsByFolder({
                id: args.id,
                query: args.params,
                queryClient,
                serverId,
            });
            songs.push(...folderSongsResponse.items);
            break;
        }

        case LibraryItem.GENRE: {
            const genreSongsResponse = await getGenreSongsById({
                id: args.id,
                query: args.params,
                queryClient,
                serverId,
            });
            songs.push(...genreSongsResponse.items);
            break;
        }

        case LibraryItem.PLAYLIST: {
            const promises: Promise<PlaylistSongListResponse>[] = [];

            for (const id of args.id) {
                promises.push(
                    getPlaylistSongsById({
                        id,
                        query: args.params,
                        queryClient,
                        serverId,
                    }),
                );
            }

            const results = await Promise.all(promises);
            songs.push(...results.flatMap((r) => r.items));
            break;
        }
    }

    return songs;
}

export const useIsPlayerFetching = () => {
    const playerFetchCount = useIsFetching({ queryKey: queryKeys.player.fetch() });

    return playerFetchCount > 0;
};
