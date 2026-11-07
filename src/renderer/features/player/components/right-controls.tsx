import { t } from 'i18next';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import styles from './right-controls.module.css';

import { useRemoteAwarePlayerSong } from '/@/renderer/features/hub/hooks/use-remote-aware';
import { PopoverPlayQueue } from '/@/renderer/features/now-playing/components/popover-play-queue';
import { useToggleQueuePanel } from '/@/renderer/features/now-playing/hooks/use-queue-panel-toggle';
import {
    useQueueOverlayVisible,
    useRightSidebarVisible,
} from '/@/renderer/features/now-playing/hooks/use-right-sidebar-visible';
import { DeviceControl } from '/@/renderer/features/player/components/device-control';
import { MoreControl } from '/@/renderer/features/player/components/more-control';
import { VolumeGroup } from '/@/renderer/features/player/components/volume-group';
import { useCreateFavorite } from '/@/renderer/features/shared/mutations/create-favorite-mutation';
import { useDeleteFavorite } from '/@/renderer/features/shared/mutations/delete-favorite-mutation';
import { useHotkeys } from '/@/renderer/hooks/use-hotkeys';
import { useHotkeySettings, usePlayerData, useSideQueueType } from '/@/renderer/store';
import { ActionIcon } from '/@/shared/components/action-icon/action-icon';
import { LibraryItem, QueueSong } from '/@/shared/types/domain-types';

/**
 * The bar's right cluster (F1), one row that never wraps: device control | queue | volume (with
 * the rating above it) | More. A hairline separates the groups; the device control renders
 * nothing without a hub, and the hairline that would follow it is then the first child and hidden.
 */
export const RightControls = () => (
    <div className={styles.cluster}>
        <DeviceControl />
        <span aria-hidden className={styles.vr} />
        <QueueButton />
        <span aria-hidden className={styles.vr} />
        <VolumeGroup />
        <span aria-hidden className={styles.vr} />
        <MoreControl />
    </div>
);

const QueueButton = () => {
    const { t } = useTranslation();
    // The icon says whether the panel is on screen; the toggle keeps the raw flag (on Now Playing
    // there is no panel, and the flag is what a click must flip).
    const isOverlayShown = useQueueOverlayVisible();
    const isPanelShown = useRightSidebarVisible() || isOverlayShown;
    const sideQueueType = useSideQueueType();
    // The rail's and the panel header's toggle too (R14): on a narrow window the queue opens over
    // the page, and the saved flag stays the user's.
    const toggleQueuePanel = useToggleQueuePanel();
    const { bindings } = useHotkeySettings();
    const [popoverOpened, setPopoverOpened] = useState(false);
    const handleToggleQueue = () => {
        if (sideQueueType !== 'sideQueue') setPopoverOpened((prev) => !prev);
        else toggleQueuePanel();
    };
    useHotkeys([
        [bindings.toggleQueue.isGlobal ? '' : bindings.toggleQueue.hotkey, handleToggleQueue],
    ]);
    if (sideQueueType === 'sideQueue') {
        return (
            <ActionIcon
                // The overlay's click-outside leaves this button to toggle it.
                data-queue-toggle
                icon={isPanelShown ? 'panelRightClose' : 'panelRightOpen'}
                iconProps={{ size: 'lg' }}
                onClick={(e) => {
                    e.stopPropagation();
                    handleToggleQueue();
                }}
                size="sm"
                tooltip={{
                    label: isPanelShown ? t('naviConnect.queue.hide') : t('naviConnect.queue.show'),
                    openDelay: 0,
                }}
                variant="subtle"
            />
        );
    }
    return (
        <PopoverPlayQueue
            onClose={() => setPopoverOpened(false)}
            onToggle={(e) => {
                e.stopPropagation();
                handleToggleQueue();
            }}
            opened={popoverOpened}
        />
    );
};

export const FavoriteButton = () => {
    const currentSong = useRemoteAwarePlayerSong();
    const { bindings } = useHotkeySettings();
    const addToFavoritesMutation = useCreateFavorite({});
    const removeFromFavoritesMutation = useDeleteFavorite({});
    const handleAddToFavorites = (song: QueueSong | undefined) => {
        if (!song?.id) return;
        addToFavoritesMutation.mutate({
            apiClientProps: { serverId: song._serverId || '' },
            query: { id: [song.id], type: LibraryItem.SONG },
        });
    };
    const handleRemoveFromFavorites = (song: QueueSong | undefined) => {
        if (!song?.id) return;
        removeFromFavoritesMutation.mutate({
            apiClientProps: { serverId: song._serverId || '' },
            query: { id: [song.id], type: LibraryItem.SONG },
        });
    };
    const handleToggleFavorite = (song: QueueSong | undefined) => {
        if (!song?.id) return;
        song.userFavorite ? handleRemoveFromFavorites(song) : handleAddToFavorites(song);
    };
    useFavoritePreviousSongHotkeys({
        handleAddToFavorites,
        handleRemoveFromFavorites,
        handleToggleFavorite,
    });
    useHotkeys([
        [
            bindings.favoriteCurrentAdd.isGlobal ? '' : bindings.favoriteCurrentAdd.hotkey,
            () => handleAddToFavorites(currentSong),
        ],
        [
            bindings.favoriteCurrentRemove.isGlobal ? '' : bindings.favoriteCurrentRemove.hotkey,
            () => handleRemoveFromFavorites(currentSong),
        ],
        [
            bindings.favoriteCurrentToggle.isGlobal ? '' : bindings.favoriteCurrentToggle.hotkey,
            () => handleToggleFavorite(currentSong),
        ],
    ]);
    return (
        <ActionIcon
            icon="favorite"
            iconProps={{ fill: currentSong?.userFavorite ? 'primary' : undefined, size: 'lg' }}
            onClick={(e) => {
                e.stopPropagation();
                handleToggleFavorite(currentSong);
            }}
            size="sm"
            tooltip={{
                label: currentSong?.userFavorite ? t('player.unfavorite') : t('player.favorite'),
                openDelay: 0,
            }}
            variant="subtle"
        />
    );
};

const useFavoritePreviousSongHotkeys = ({
    handleAddToFavorites,
    handleRemoveFromFavorites,
    handleToggleFavorite,
}: {
    handleAddToFavorites: (song: QueueSong | undefined) => void;
    handleRemoveFromFavorites: (song: QueueSong | undefined) => void;
    handleToggleFavorite: (song: QueueSong | undefined) => void;
}) => {
    const { bindings } = useHotkeySettings();
    const { previousSong } = usePlayerData();
    useHotkeys([
        [
            bindings.favoritePreviousAdd.isGlobal ? '' : bindings.favoritePreviousAdd.hotkey,
            () => handleAddToFavorites(previousSong),
        ],
        [
            bindings.favoritePreviousRemove.isGlobal ? '' : bindings.favoritePreviousRemove.hotkey,
            () => handleRemoveFromFavorites(previousSong),
        ],
        [
            bindings.favoritePreviousToggle.isGlobal ? '' : bindings.favoritePreviousToggle.hotkey,
            () => handleToggleFavorite(previousSong),
        ],
    ]);
    return null;
};
