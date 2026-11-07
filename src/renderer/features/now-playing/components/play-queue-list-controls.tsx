import clsx from 'clsx';
import { RefObject, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import styles from './play-queue-list-controls.module.css';

import { ItemListHandle } from '/@/renderer/components/item-list/types';
import {
    QueueActionsMenu,
    QueueMenuSection,
    queueTableConfig,
    useQueueActions,
} from '/@/renderer/features/now-playing/components/queue-actions-menu';
import { QueueStationChips } from '/@/renderer/features/player/station/queue-station-chips';
import { ListConfigMenu } from '/@/renderer/features/shared/components/list-config-menu';
import { SearchInput } from '/@/renderer/features/shared/components/search-input';
import { usePlayerStoreBase } from '/@/renderer/store';
import { ActionIcon } from '/@/shared/components/action-icon/action-icon';
import { Box } from '/@/shared/components/box/box';
import { Divider } from '/@/shared/components/divider/divider';
import { Group } from '/@/shared/components/group/group';
import { ItemListKey } from '/@/shared/types/types';

const TIER_1_MAX = 480;
const TIER_2_MAX = 380;
const TIER_3_MAX = 300;

type OverflowTier = 0 | 1 | 2 | 3;

const getOverflowTier = (width: number): OverflowTier => {
    if (width <= TIER_3_MAX) return 3;
    if (width <= TIER_2_MAX) return 2;
    if (width <= TIER_1_MAX) return 1;
    return 0;
};

interface PlayQueueListOptionsProps {
    handleSearch: (value: string) => void;
    searchTerm?: string;
    tableRef: RefObject<ItemListHandle | null>;
    type: ItemListKey;
}

export const PlayQueueListControls = ({
    handleSearch,
    searchTerm,
    tableRef,
    type,
}: PlayQueueListOptionsProps) => {
    const { t } = useTranslation();
    const toolbarRef = useRef<HTMLDivElement>(null);
    const [overflowTier, setOverflowTier] = useState<OverflowTier>(0);

    useEffect(() => {
        const element = toolbarRef.current;
        if (!element) return;

        const updateTier = (width: number) => {
            setOverflowTier(getOverflowTier(width));
        };

        const observer = new ResizeObserver((entries) => {
            const entry = entries[0];
            if (!entry) return;
            updateTier(entry.contentRect.width);
        });

        observer.observe(element);

        const style = getComputedStyle(element);
        const horizontalPadding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
        updateTier(element.getBoundingClientRect().width - horizontalPadding);

        return () => observer.disconnect();
    }, []);

    const actions = useQueueActions(() => {
        const index = usePlayerStoreBase.getState().player.index;
        if (index !== -1) {
            tableRef.current?.scrollToIndex(index);
        }
    });
    const supportsQueue = actions.supportsQueue;

    const menuSections: QueueMenuSection[] = [
        ...(supportsQueue && overflowTier >= 1 ? (['saveRestore'] as const) : []),
        ...(overflowTier >= 3 ? (['shuffle', 'clear'] as const) : []),
        ...(overflowTier >= 2 ? (['goToCurrent', 'createPlaylist'] as const) : []),
    ];

    return (
        // The header's rule runs under the chips, so they read as part of the header. Nothing in
        // the header may be wider than the panel (B-146): it never scrolls the queue sideways.
        <div
            style={{
                borderBottom: '1px solid var(--theme-colors-border)',
                maxWidth: '100%',
                minWidth: 0,
                overflow: 'hidden',
                width: '100%',
            }}
        >
            <Group
                align="center"
                className={clsx(styles.toolbar, {
                    [styles.hasRestore]: supportsQueue,
                })}
                data-overflow-tier={overflowTier}
                gap="sm"
                justify="flex-start"
                px="md"
                py="xs"
                ref={toolbarRef}
                w="100%"
                wrap="nowrap"
            >
                <Group gap="xs" style={{ flexShrink: 0 }} wrap="nowrap">
                    {supportsQueue && (
                        <span className={styles.overflowTier1}>
                            <ActionIcon
                                disabled={actions.isFetching}
                                icon="upload"
                                iconProps={{ size: 'lg' }}
                                loading={actions.isSavingQueue}
                                onClick={() => actions.saveQueue()}
                                tooltip={{
                                    label: t('player.saveQueueToServer'),
                                }}
                                variant="subtle"
                            />
                            <ActionIcon
                                disabled={actions.isRestoreBusy}
                                icon="download"
                                iconProps={{ size: 'lg' }}
                                loading={actions.isFetching}
                                onClick={actions.restoreQueue}
                                tooltip={{
                                    label: t('player.restoreQueueFromServer'),
                                }}
                                variant="subtle"
                            />
                        </span>
                    )}
                    <span className={styles.overflowTier3}>
                        <ActionIcon
                            icon="mediaShuffle"
                            iconProps={{ size: 'lg' }}
                            onClick={actions.shuffleQueue}
                            tooltip={{ label: t('player.shuffle') }}
                            variant="subtle"
                        />
                        <ActionIcon
                            icon="delete"
                            iconProps={{ size: 'lg' }}
                            onClick={actions.clearQueue}
                            tooltip={{ label: t('action.clearQueue') }}
                            variant="subtle"
                        />
                    </span>
                    <span className={styles.overflowTier2}>
                        <ActionIcon
                            icon="goToItem"
                            iconProps={{ size: 'lg' }}
                            onClick={actions.goToCurrent}
                            tooltip={{ label: t('action.goToCurrent') }}
                            variant="subtle"
                        />
                        <ActionIcon
                            icon="playlistAdd"
                            iconProps={{ size: 'lg' }}
                            onClick={actions.createPlaylist}
                            tooltip={{ label: t('action.createPlaylistFromQueue') }}
                            variant="subtle"
                        />
                    </span>
                    <span className={styles.moreTrigger}>
                        <QueueActionsMenu
                            actions={actions}
                            listKey={type}
                            sections={menuSections}
                        />
                    </span>
                </Group>
                <Divider h="60%" orientation="vertical" style={{ alignSelf: 'center' }} />
                <Box style={{ display: 'flex', flex: 1, minWidth: 0 }}>
                    <SearchInput
                        enableHotkey={false}
                        fillContainer
                        onChange={(e) => handleSearch(e.target.value)}
                        value={searchTerm}
                    />
                </Box>
                <Divider h="60%" orientation="vertical" style={{ alignSelf: 'center' }} />
                <Box style={{ flexShrink: 0 }}>
                    <ListConfigMenu {...queueTableConfig(type)} />
                </Box>
            </Group>
            {/* navi-connect (I-041): autoplay as chips, under the queue's header. */}
            <QueueStationChips />
        </div>
    );
};
