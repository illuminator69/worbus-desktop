import { useTranslation } from 'react-i18next';

import styles from './queue-rail.module.css';

import { ItemImage } from '/@/renderer/components/item-image/item-image';
import { useRemoteAwareNextSong } from '/@/renderer/features/hub/hooks/use-remote-aware';
import { usePlayingFrom } from '/@/renderer/features/now-playing/hooks/use-playing-from';
import { useToggleQueuePanel } from '/@/renderer/features/now-playing/hooks/use-queue-panel-toggle';
import {
    useQueueOverlayVisible,
    useQueueRailVisible,
} from '/@/renderer/features/now-playing/hooks/use-right-sidebar-visible';
import { useHubIsRemoteActive, useHubStore, usePlayerData } from '/@/renderer/store';
import { ActionIcon } from '/@/shared/components/action-icon/action-icon';
import { Tooltip } from '/@/shared/components/tooltip/tooltip';
import { LibraryItem } from '/@/shared/types/domain-types';

/** The queue panel, collapsed: a 44px column with the queue's length, where the panel stands when open. */
export const QueueRail = () => {
    const { t } = useTranslation();
    const visible = useQueueRailVisible();
    // The player bar's queue toggle (R14): on a narrow window it opens the panel over the page
    // and leaves the saved flag alone, as before.
    const open = useToggleQueuePanel();
    // Hide while the folded queue stands open over the page beside it, as the bar's icon says.
    const overlayOpen = useQueueOverlayVisible();
    const toggleLabel = overlayOpen ? t('naviConnect.queue.hide') : t('naviConnect.queue.show');
    // The session's queue, as the window bar counts it: the hub's mirror while another device plays.
    const isRemote = useHubIsRemoteActive();
    const remoteQueueLength = useHubStore((state) => state.remoteQueue.length);
    const local = usePlayerData();
    const queueLength = isRemote ? remoteQueueLength : local.queueLength;
    // What plays next, from the source the player bar and the full-screen player read: the local
    // player's (repeat and shuffle applied), or the hub session's while another device plays.
    const next = useRemoteAwareNextSong();
    // Whether something follows the last song: the panel header's own state, so the rail and
    // the header cannot disagree about it (autoplay, a running station, or Auto DJ).
    const continues = ['autoDj', 'continues', 'running'].includes(usePlayingFrom().state);

    if (!visible) return null;

    const nextArtist = next?.artistName || next?.artists?.map((artist) => artist.name).join(', ');
    const nextLabel = next
        ? nextArtist
            ? t('naviConnect.queue.railNext', { artist: nextArtist, title: next.name })
            : t('naviConnect.queue.railNextTitle', { title: next.name })
        : undefined;
    // Nothing next in a queue that has songs: its end, with repeat off. An empty queue says Up
    // next. With autoplay on the end is not the end: the label says autoplay takes over.
    const atEnd = queueLength > 0 && !next;
    const label = !atEnd
        ? t('page.fullscreenPlayer.upNext')
        : continues
          ? t('naviConnect.queue.group.autoplay')
          : t('naviConnect.queue.endOfQueue');

    return (
        <aside className={styles.rail} id="queue-rail">
            <ActionIcon
                aria-label={toggleLabel}
                className={styles.button}
                // The bar's own pair (R14): open here, close in the panel's header.
                icon={overlayOpen ? 'panelRightClose' : 'panelRightOpen'}
                iconProps={{ size: 'lg' }}
                onClick={open}
                size="compact-md"
                tooltip={{ label: toggleLabel, position: 'left' }}
                variant="subtle"
            />
            {queueLength > 0 && <span className={styles.count}>{queueLength}</span>}
            <span aria-hidden className={styles.label}>
                {label}
            </span>
            {next && (
                <>
                    <Tooltip label={nextLabel} multiline position="left" w={220}>
                        <button
                            aria-label={nextLabel}
                            className={styles.cover}
                            onClick={open}
                            type="button"
                        >
                            <ItemImage
                                id={next.imageId}
                                itemType={LibraryItem.SONG}
                                serverId={next._serverId}
                                src={next.imageUrl}
                                type="table"
                            />
                        </button>
                    </Tooltip>
                    <span aria-hidden className={styles.next}>
                        <span className={styles.nextTitle}>{next.name}</span>
                        {nextArtist && <span className={styles.nextArtist}>{nextArtist}</span>}
                    </span>
                </>
            )}
        </aside>
    );
};
