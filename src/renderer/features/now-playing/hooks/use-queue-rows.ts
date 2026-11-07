import { createElement, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { shallow } from 'zustand/shallow';

import { TableGroupHeader } from '/@/renderer/components/item-list/item-table-list/item-table-list';
import { QueueGroupHeader } from '/@/renderer/features/now-playing/components/queue-group-header';
import {
    playingIndexOf,
    QueueGroup,
    queueGroups,
} from '/@/renderer/features/now-playing/utils/queue-grouping';
import { servedIdsOf, useStationStore } from '/@/renderer/features/player/station/station-store';
import { useStationWords } from '/@/renderer/features/player/station/use-station-words';
import { useHubIsRemoteActive, useHubStore, usePlayerSong } from '/@/renderer/store';
import { QueueSong } from '/@/shared/types/domain-types';

/** The playing row's id in the side queue: `remote:<index>` while another device plays. */
export const usePlayingRowId = (): string | undefined => {
    const isRemote = useHubIsRemoteActive();
    const remoteIndex = useHubStore((s) => s.remoteQueueIndex);
    const localId = usePlayerSong()?._uniqueId;
    return isRemote ? `remote:${remoteIndex}` : localId;
};

/**
 * The side queue's groups (F4), computed on the rows the table shows in the same render, so a
 * track change regroups and scrolls on one grouping. A row is the station's when it carries
 * `_stationId` or the bound station served its id to this client (`servedIdsOf`, the rule
 * `readSnapshot` uses). `groups` is memoized by its kinds, counts and the Autoplay header's
 * words: the table's cells compare it by reference.
 */
export const useQueueRows = (
    rows: QueueSong[],
    activeRowId: string | undefined,
    enabled: boolean,
): { groups: TableGroupHeader[] | undefined; playingIndex: number; signature: string } => {
    const { t } = useTranslation();
    const words = useStationWords();
    const station = useStationStore((s) => ({ bound: s.bound, served: s.served }), shallow);

    const { counts, playingIndex } = useMemo(() => {
        const served = servedIdsOf(station);
        const keys = rows.map((row) => row._uniqueId);
        const index = playingIndexOf(keys, activeRowId);
        const infos = rows.map((row) => ({
            stationAdded: Boolean(row._stationId) || served.has(row.id),
        }));
        // Nothing playing (or not in the shown rows): no headers at all.
        return { counts: index < 0 ? [] : queueGroups(infos, index), playingIndex: index };
    }, [activeRowId, rows, station]);

    const autoplayTrail = words.bound
        ? words.bound.stopped
            ? t('naviConnect.station.chipOff')
            : words.characterLabel(words.bound.character)
        : null;
    const signature = `${counts.map((g) => `${g.kind}:${g.count}`).join(',')}|${autoplayTrail ?? ''}`;

    const groups = useMemo((): TableGroupHeader[] | undefined => {
        if (counts.length === 0) return undefined;
        const trailOf = (group: QueueGroup): null | string => {
            if (group.kind === 'autoplay') return autoplayTrail;
            if (group.kind === 'queued' || group.kind === 'next') return String(group.count);
            return null;
        };
        return counts.map((group) => ({
            itemCount: group.count,
            render: () =>
                createElement(QueueGroupHeader, {
                    kind: group.kind,
                    trail: trailOf(group),
                }),
        }));
        // The signature stands for `counts` and `autoplayTrail`.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [signature]);

    return { groups: enabled ? groups : undefined, playingIndex, signature };
};
