import { useEffect } from 'react';

import { api } from '/@/renderer/api';
import { coverIdChanges, queueCoverAsks } from '/@/renderer/features/player/utils/queue-covers';
import { useCurrentServer } from '/@/renderer/store';
import { setQueueCoverIds, usePlayerStoreBase } from '/@/renderer/store/player.store';
import { logger } from '/@/renderer/utils/logger';
import { ServerType, SongListSort, SortOrder } from '/@/shared/types/domain-types';

/** Songs asked per request: `id=` repeated, so the batch bounds the URL (about 5 KB at 200). */
const ASK_BATCH = 200;

/** Servers whose queue was refreshed in this run of the app: "on start" means once. */
const refreshedServers = new Set<string>();

/**
 * B-437: once per start and server, after the persisted queue is read back and the session is valid
 * (mounted by the authentication outlet), ask Navidrome for the queue's songs again and move the
 * cover ids that changed (`queue-covers.ts`). A failed ask leaves the queue as it was; the next
 * start asks again.
 */
export const useQueueCoverRefresh = () => {
    const hydrated = usePlayerStoreBase((state) => state.hydrated);
    const server = useCurrentServer();
    const serverId = server?.id;
    const isNavidrome = server?.type === ServerType.NAVIDROME;

    useEffect(() => {
        if (!hydrated || !serverId || !isNavidrome || refreshedServers.has(serverId)) {
            return undefined;
        }
        const controller = new AbortController();
        void (async () => {
            const songs = Object.values(usePlayerStoreBase.getState().queue.songs);
            for (const ids of queueCoverAsks(songs, serverId, ASK_BATCH)) {
                try {
                    const answer = await api.controller.getSongList({
                        apiClientProps: { serverId, signal: controller.signal },
                        query: {
                            _custom: { id: ids },
                            limit: ids.length,
                            sortBy: SongListSort.ID,
                            sortOrder: SortOrder.ASC,
                            startIndex: 0,
                        },
                    });
                    const changes = coverIdChanges(songs, answer?.items ?? []);
                    if (changes.size > 0) setQueueCoverIds(changes);
                } catch (error) {
                    if (!controller.signal.aborted) {
                        logger.warn('Queue cover refresh failed', {
                            error: error instanceof Error ? error.message : String(error),
                        });
                    }
                    return;
                }
            }
            refreshedServers.add(serverId);
        })();
        return () => controller.abort();
    }, [hydrated, isNavidrome, serverId]);
};

export const QueueCoverRefresh = () => {
    useQueueCoverRefresh();
    return null;
};
