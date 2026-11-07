import { useMemo } from 'react';

import { useRemoteAwarePlayerSong } from '/@/renderer/features/hub/hooks/use-remote-aware';
import { PlayingFrom, playingFrom } from '/@/renderer/features/now-playing/utils/playing-from';
import { useStationWords } from '/@/renderer/features/player/station/use-station-words';
import { findMatchingSavedQueueId } from '/@/renderer/features/player/utils/saved-queue-source';
import { realSourceName } from '/@/renderer/features/saved-queues/utils/saved-queue-format';
import {
    useHubActiveDeviceName,
    useHubIsRemoteActive,
    useHubSavedQueueId,
    useHubStore,
    usePlayerStoreBase,
} from '/@/renderer/store';
import { useSavedQueuesStore } from '/@/renderer/store/saved-queues.store';

/**
 * What the side queue's header says it is playing from (F4): the session's saved-queue record,
 * the station and, while another device plays, that device. The hub's `savedQueueId` is trusted
 * only while its record holds the playing song: after a queue replace it still names the queue
 * before it for a moment. Otherwise the record is found by membership.
 */
export const usePlayingFrom = (): PlayingFrom => {
    const words = useStationWords();
    const isRemote = useHubIsRemoteActive();
    const deviceName = useHubActiveDeviceName();
    const savedQueueId = useHubSavedQueueId();
    const queues = useSavedQueuesStore((s) => s.queues);
    const playingId = useRemoteAwarePlayerSong()?.id;
    const localQueue = usePlayerStoreBase((s) => s.queue);
    const remoteQueue = useHubStore((s) => s.remoteQueue);

    // The queue's song ids, recomputed only when the queue itself changes.
    const ids = useMemo(
        () =>
            isRemote
                ? remoteQueue.map((track) => track.id)
                : localQueue.default.map((key) => localQueue.songs[key]?.id ?? ''),
        [isRemote, localQueue, remoteQueue],
    );

    const record = useMemo(() => {
        if (!playingId) return null;
        const byHub = queues.find((queue) => queue.id === savedQueueId);
        if (byHub?.songs.some((song) => song.id === playingId)) return byHub;
        const matched = findMatchingSavedQueueId(ids);
        return queues.find((queue) => queue.id === matched) ?? null;
    }, [ids, playingId, queues, savedQueueId]);

    const engine = words.mode !== 'fallback';
    return playingFrom({
        autoplay: words.autoplay,
        device: isRemote ? deviceName : null,
        engine,
        kind: record?.sourceKind ?? null,
        name: record?.name ?? null,
        sourceName: record ? (realSourceName(record) ?? null) : null,
        stationName: words.bound ? words.stationName(words.bound) : null,
        stationState: !words.bound ? 'absent' : words.bound.stopped ? 'stopped' : 'bound',
    });
};
