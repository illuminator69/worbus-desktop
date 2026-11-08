import { useMutation, useQueryClient } from '@tanstack/react-query';
import { t } from 'i18next';
import { useCallback, useEffect, useRef } from 'react';

import { api } from '/@/renderer/api';
import { usePlayerEvents } from '/@/renderer/features/player/audio-player/hooks/use-player-events';
import { usePlayer } from '/@/renderer/features/player/context/player-context';
import { createStartupSeek } from '/@/renderer/features/player/hooks/startup-seek';
import { songsQueries } from '/@/renderer/features/songs/api/songs-api';
import {
    setTimestamp,
    useCurrentServerId,
    usePlayerActions,
    usePlayerHydrated,
    usePlayerSong,
    usePlayerStatus,
    usePlayerStore,
    useTimestampStoreBase,
} from '/@/renderer/store';
import { toast } from '/@/shared/components/toast/toast';
import { PlayerStatus } from '/@/shared/types/types';

let startupRestoreSessionHandled = false;

export const useQueueRestoreTimestamp = () => {
    const { mediaSeekToTimestamp } = usePlayerActions();

    usePlayerEvents(
        {
            onQueueRestored: (properties) => {
                const { position } = properties;

                setTimeout(() => {
                    setTimestamp(position, { seek: true }); // navi-connect (Q-051)
                    mediaSeekToTimestamp(position);
                }, 100);
            },
        },
        [],
    );
};

export const QueueRestoreTimestampHook = () => {
    useQueueRestoreTimestamp();
    return null;
};

/**
 * navi-connect: the startup seek goes back to where this device was when it was closed, and fires
 * the first time playback starts - which, after a transfer back to this device, is the transfer's
 * own start. So the hub, once it has placed the playhead (a load, an adopted session, a seek),
 * withdraws it; or, when the engine was not up yet to take the hub's seek, retargets it to the
 * hub's position so the first play lands there (B-339). State in startup-seek.ts.
 */
const startupSeek = createStartupSeek();

export const withdrawStartupSeek = () => {
    startupSeek.withdraw();
};

/**
 * B-339: replace the pending startup seek's target with `sec`, on the song now current, and return
 * true. False when no startup seek is pending: after the first PLAYING (also when there was nothing
 * to restore), or once it was cancelled or withdrawn. The caller then seeks as usual.
 */
export const retargetStartupSeek = (sec: number): boolean =>
    startupSeek.retarget(sec, usePlayerStore.getState().getCurrentSong()?._uniqueId);

export const useInitialTimestampRestore = () => {
    const { mediaSeekToTimestamp } = usePlayerActions();
    const playerHydrated = usePlayerHydrated();
    const currentSong = usePlayerSong();
    const playerStatus = usePlayerStatus();
    const timestamp = useTimestampStoreBase((state) => state.timestamp);

    const startupRestoreInitializedRef = useRef(false);

    const applyStartupSeek = useCallback(() => {
        const seekTimestamp = startupSeek.takeOnPlaying(
            usePlayerStore.getState().getCurrentSong()?._uniqueId,
        );
        if (seekTimestamp === null) {
            return;
        }

        setTimeout(() => {
            mediaSeekToTimestamp(seekTimestamp);
        }, 100);
    }, [mediaSeekToTimestamp]);

    useEffect(() => {
        startupSeek.noteCurrentSong(currentSong?._uniqueId);
    }, [currentSong]);

    useEffect(() => {
        if (startupRestoreInitializedRef.current || startupRestoreSessionHandled) {
            return;
        }

        if (!playerHydrated || !currentSong) {
            return;
        }

        startupRestoreInitializedRef.current = true;
        startupRestoreSessionHandled = true;

        startupSeek.arm(timestamp, currentSong._uniqueId);

        if (playerStatus === PlayerStatus.PLAYING) {
            applyStartupSeek();
        }
    }, [applyStartupSeek, currentSong, playerHydrated, playerStatus, timestamp]);

    usePlayerEvents(
        {
            onPlayerStatus: (properties) => {
                if (properties.status === PlayerStatus.PLAYING) {
                    applyStartupSeek();
                }
            },
        },
        [applyStartupSeek],
    );
};

export const InitialTimestampRestoreHook = () => {
    useInitialTimestampRestore();
    return null;
};

export const useSaveQueue = () => {
    const serverId = useCurrentServerId();

    const mutation = useMutation({
        mutationFn: async () => {
            if (!serverId) {
                throw new Error(t('error.serverRequired'));
            }

            const state = usePlayerStore.getState();
            const queue = state.getQueue();

            if (queue.items.some((item) => item._serverId !== serverId)) {
                toast.error({
                    message: t('error.multipleServerSaveQueueError'),
                    title: t('error.genericError'),
                });

                throw new Error(`${t('error.multipleServerSaveQueueError')}`);
            }

            return api.controller.savePlayQueue({
                apiClientProps: { serverId },
                query: {
                    currentIndex: queue.items.length > 0 ? state.player.index : undefined,
                    positionMs: useTimestampStoreBase.getState().timestamp * 1000,
                    songs: queue.items.map((item) => item.id),
                },
            });
        },
        onError: (error) => {
            toast.error({
                message: (error as Error).message,
                title: t('error.saveQueueFailed'),
            });
        },
    });

    return mutation;
};

export const useRestoreQueue = () => {
    const serverId = useCurrentServerId();
    const player = usePlayer();
    const queryClient = useQueryClient();

    const handleRestoreQueue = useCallback(async () => {
        if (!serverId) return;

        try {
            const queue = await queryClient.fetchQuery(
                songsQueries.getQueue({ query: {}, serverId }),
            );

            if (queue) {
                player.setQueue(
                    queue.entry,
                    queue.currentIndex,
                    queue.positionMs !== undefined ? queue.positionMs / 1000 : undefined,
                );
            }
        } catch (error) {
            toast.error({
                message: (error as Error).message,
                title: t('error.genericError'),
            });
        }
    }, [player, queryClient, serverId]);

    return handleRestoreQueue;
};
