import { closeAllModals, openModal } from '@mantine/modals';
import clsx from 'clsx';
import { useMemo } from 'react';

import styles from './continue-listening-row.module.css';

import { api } from '/@/renderer/api';
import { ItemImage } from '/@/renderer/components/item-image/item-image';
import { sendHubAct } from '/@/renderer/features/hub/utils/remote-queue';
import { type ArrivalProps, useArrival } from '/@/renderer/features/motion/use-arrival';
import { useRestoreSavedQueue } from '/@/renderer/features/player/hooks/use-saved-queues';
import { restartQueueSession } from '/@/renderer/features/player/utils/saved-queue-source';
import { SaveAsPlaylistForm } from '/@/renderer/features/playlists/components/save-as-playlist-form';
import { savedQueuePreviewModalProps } from '/@/renderer/features/saved-queues/components/saved-queue-preview-modal';
import {
    savedQueueTitle as queueTitle,
    savedQueueCoverSongId,
    savedQueueSubtitle,
} from '/@/renderer/features/saved-queues/utils/saved-queue-format';
import {
    SavedQueue,
    useContinueListening,
    useCurrentServerId,
    useHubSavedQueueId,
    useHubStore,
    useSavedQueuesActions,
} from '/@/renderer/store';
import { ActionIcon } from '/@/shared/components/action-icon/action-icon';
import { ContextMenu } from '/@/shared/components/context-menu/context-menu';
import { DropdownMenu } from '/@/shared/components/dropdown-menu/dropdown-menu';
import { Icon } from '/@/shared/components/icon/icon';
import { toast } from '/@/shared/components/toast/toast';
import { LibraryItem } from '/@/shared/types/domain-types';

interface CardProps {
    arrival?: ArrivalProps;
    entry: SavedQueue;
    isActive: boolean;
    serverId: string;
}

const ContinueListeningCard = ({ arrival, entry, isActive, serverId }: CardProps) => {
    const { isRestoring, restore } = useRestoreSavedQueue();
    const { remove } = useSavedQueuesActions();

    const openPreview = () => {
        openModal(savedQueuePreviewModalProps(entry, isRestoring, () => void restore(entry)));
    };

    // Local first (instant, and covers rows the hub hasn't been told about yet), then
    // the hub act so the deletion propagates to every client and is tombstoned there.
    const doRemove = () => {
        const wasLive = useHubStore.getState().savedQueueId === entry.id;
        remove(entry.id);
        sendHubAct('deleteSavedQueue', { id: entry.id });
        // Deleting the record the live queue publishes into leaves it homeless — start a
        // new session so it reappears under a fresh card.
        if (wasLive) restartQueueSession();
    };

    const saveAsPlaylist = () => {
        openModal({
            children: (
                <SaveAsPlaylistForm
                    body={{ name: queueTitle(entry) }}
                    onCancel={closeAllModals}
                    onSuccess={async (data) => {
                        try {
                            await api.controller.addToPlaylist({
                                apiClientProps: { serverId },
                                body: { songId: entry.songs.map((song) => song.id) },
                                query: { id: data?.id || '' },
                            });
                            toast.success({ message: `Saved ${entry.songs.length} tracks` });
                        } catch (err) {
                            toast.error({
                                message: (err as Error).message,
                                title: 'Could not add tracks to the playlist',
                            });
                        }
                    }}
                    serverId={serverId}
                />
            ),
            title: 'Save queue as playlist',
        });
    };

    // One list for both menus: the "..." on the cover and a right-click, as on the
    // app's cards.
    const menu: { label: string; onSelect: () => void }[] = [
        { label: 'Resume', onSelect: () => void restore(entry) },
        { label: 'Preview queue', onSelect: openPreview },
        { label: 'Save as playlist', onSelect: saveAsPlaylist },
        { label: 'Remove from history', onSelect: doRemove },
    ];

    // The card is the button (a click resumes); the ellipsis beside it opens the menu, and a
    // right-click opens the same menu.
    return (
        <ContextMenu>
            <ContextMenu.Target>
                <div
                    className={clsx(styles.card, arrival?.className)}
                    data-arrive={arrival?.['data-arrive']}
                    data-continue-card={entry.id}
                    style={arrival?.style}
                >
                    <button
                        aria-busy={isRestoring || undefined}
                        className={styles.main}
                        disabled={isRestoring}
                        onClick={() => void restore(entry)}
                        type="button"
                    >
                        <ItemImage
                            containerClassName={styles.cover}
                            // Resolved from the resume track's id with our own credentials:
                            // a peer's `coverImageUrl` is an authed URL for its server.
                            id={savedQueueCoverSongId(entry)}
                            itemType={LibraryItem.SONG}
                            type="table"
                        />
                        <span className={styles.text}>
                            <span className={styles.title}>
                                {`${isActive ? '▶ ' : ''}${queueTitle(entry)}`}
                            </span>
                            <span className={styles.subtitle}>
                                {savedQueueSubtitle(entry, isActive)}
                            </span>
                        </span>
                        <Icon className={styles.glyph} icon="mediaPlay" />
                    </button>
                    <DropdownMenu>
                        <DropdownMenu.Target>
                            <ActionIcon
                                aria-label="Queue actions"
                                className={styles.more}
                                icon="ellipsisHorizontal"
                                size={28}
                                variant="subtle"
                            />
                        </DropdownMenu.Target>
                        <DropdownMenu.Dropdown>
                            {menu.map((item) => (
                                <DropdownMenu.Item key={item.label} onClick={item.onSelect}>
                                    {item.label}
                                </DropdownMenu.Item>
                            ))}
                        </DropdownMenu.Dropdown>
                    </DropdownMenu>
                </div>
            </ContextMenu.Target>
            <ContextMenu.Content>
                {menu.map((item) => (
                    <ContextMenu.Item key={item.label} onSelect={item.onSelect}>
                        {item.label}
                    </ContextMenu.Item>
                ))}
            </ContextMenu.Content>
        </ContextMenu>
    );
};

/**
 * Saved queues as a grid of cards: one column, two from a page width of 520 px, three from
 * 960 px (CSS container queries on the page); the cards past the visible count are not shown,
 * so they are not in the tab order either. The first three arrive.
 */
export const SavedQueueCards = ({
    activeId,
    entries,
}: {
    activeId?: null | string;
    entries: SavedQueue[];
}) => {
    const serverId = useCurrentServerId();
    const { propsFor } = useArrival(entries.length > 0);
    const arrivals = useMemo(
        () => entries.slice(0, 3).map((_, index) => propsFor(index)),
        [entries, propsFor],
    );

    if (!serverId || entries.length === 0) {
        return null;
    }

    return (
        <div className={styles.grid}>
            {entries.map((entry, index) => (
                <ContinueListeningCard
                    arrival={arrivals[index]}
                    entry={entry}
                    isActive={entry.id === activeId}
                    key={entry.id}
                    serverId={serverId}
                />
            ))}
        </div>
    );
};

/** Continue listening: the live queue first, then the newest. Nothing when there are none. */
export const ContinueListeningRow = () => {
    const serverId = useCurrentServerId();
    const activeId = useHubSavedQueueId();
    const raw = useContinueListening(serverId, 12);

    const entries = useMemo(
        () =>
            raw.slice().sort((a, b) => {
                if (a.id === activeId) return -1;
                if (b.id === activeId) return 1;
                return b.updatedAt - a.updatedAt;
            }),
        [activeId, raw],
    );

    return <SavedQueueCards activeId={activeId} entries={entries} />;
};
