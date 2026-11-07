import { openContextModal } from '@mantine/modals';
import { useIsFetching } from '@tanstack/react-query';
import { MouseEvent, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { queryKeys } from '/@/renderer/api/query-keys';
import { SONG_TABLE_COLUMNS } from '/@/renderer/components/item-list/item-table-list/default-columns';
import { usePlayer } from '/@/renderer/features/player/context/player-context';
import { useRestoreQueue, useSaveQueue } from '/@/renderer/features/player/hooks/use-queue-restore';
import { openCreatePrefilledPlaylistModal } from '/@/renderer/features/playlists/components/create-playlist-form';
import {
    ListConfigMenuFormProps,
    SONG_DISPLAY_TYPES,
} from '/@/renderer/features/shared/components/list-config-menu';
import { MoreButton } from '/@/renderer/features/shared/components/more-button';
import { useCurrentServer } from '/@/renderer/store';
import { hasFeature } from '/@/shared/api/utils';
import { DropdownMenu } from '/@/shared/components/dropdown-menu/dropdown-menu';
import { Icon } from '/@/shared/components/icon/icon';
import { toast } from '/@/shared/components/toast/toast';
import { ServerFeature } from '/@/shared/types/features-types';
import { ItemListKey, ListDisplayType } from '/@/shared/types/types';

/** The queue table's settings form, as the toolbar's settings button has always opened it. */
export const queueTableConfig = (listKey: ItemListKey): ListConfigMenuFormProps => ({
    displayTypes: [{ hidden: true, value: ListDisplayType.GRID }, ...SONG_DISPLAY_TYPES],
    listKey,
    optionsConfig: {
        table: {
            itemsPerPage: { hidden: true },
            pagination: { hidden: true },
        },
    },
    tableColumnsData: SONG_TABLE_COLUMNS,
});

/** Every queue action the toolbar and the side queue's header offer, in one place. */
export const useQueueActions = (onGoToCurrent: () => void) => {
    const { t } = useTranslation();
    const server = useCurrentServer();
    const player = usePlayer();
    const supportsQueue = hasFeature(server, ServerFeature.SERVER_PLAY_QUEUE);
    const isFetching = Boolean(
        useIsFetching({ queryKey: queryKeys.player.fetch({ type: 'queue' }) }),
    );
    const { isPending: isSavingQueue, mutate: saveQueueMutation } = useSaveQueue();
    const restoreQueue = useRestoreQueue();

    const saveQueue = useCallback(() => {
        saveQueueMutation(undefined, {
            onSuccess: () => {
                toast.success({ message: t('form.saveQueue.success') });
            },
        });
    }, [saveQueueMutation, t]);

    return {
        clearQueue: () => player.clearQueue(),
        createPlaylist: (e?: MouseEvent<HTMLButtonElement>) =>
            openCreatePrefilledPlaylistModal(server, player.getQueue(), e),
        goToCurrent: onGoToCurrent,
        isFetching,
        isRestoreBusy: isSavingQueue || isFetching,
        isSavingQueue,
        restoreQueue,
        saveQueue,
        shuffleQueue: () => player.shuffleAll(),
        supportsQueue,
    };
};

export type QueueActions = ReturnType<typeof useQueueActions>;

export type QueueMenuSection =
    | 'clear'
    | 'createPlaylist'
    | 'goToCurrent'
    | 'saveRestore'
    | 'shuffle'
    | 'tableSettings';

interface QueueActionsMenuProps {
    actions: QueueActions;
    listKey: ItemListKey;
    sections: readonly QueueMenuSection[];
}

/** The queue's `...` menu: the sections asked for, in the toolbar's order. */
export const QueueActionsMenu = ({ actions, listKey, sections }: QueueActionsMenuProps) => {
    const { t } = useTranslation();
    const has = (section: QueueMenuSection) => sections.includes(section);

    return (
        <DropdownMenu position="bottom-start">
            <DropdownMenu.Target>
                <MoreButton />
            </DropdownMenu.Target>
            <DropdownMenu.Dropdown>
                {has('saveRestore') && actions.supportsQueue && (
                    <>
                        <DropdownMenu.Item
                            disabled={actions.isFetching || actions.isSavingQueue}
                            leftSection={<Icon icon="upload" />}
                            onClick={() => actions.saveQueue()}
                        >
                            {t('player.saveQueueToServer')}
                        </DropdownMenu.Item>
                        <DropdownMenu.Item
                            disabled={actions.isRestoreBusy}
                            leftSection={<Icon icon="download" />}
                            onClick={actions.restoreQueue}
                        >
                            {t('player.restoreQueueFromServer')}
                        </DropdownMenu.Item>
                    </>
                )}
                {has('shuffle') && (
                    <DropdownMenu.Item
                        leftSection={<Icon icon="mediaShuffle" />}
                        onClick={actions.shuffleQueue}
                    >
                        {t('player.shuffle')}
                    </DropdownMenu.Item>
                )}
                {has('clear') && (
                    <DropdownMenu.Item
                        leftSection={<Icon icon="delete" />}
                        onClick={actions.clearQueue}
                    >
                        {t('action.clearQueue')}
                    </DropdownMenu.Item>
                )}
                {has('goToCurrent') && (
                    <DropdownMenu.Item
                        leftSection={<Icon icon="goToItem" />}
                        onClick={actions.goToCurrent}
                    >
                        {t('action.goToCurrent')}
                    </DropdownMenu.Item>
                )}
                {has('createPlaylist') && (
                    <DropdownMenu.Item
                        leftSection={<Icon icon="playlistAdd" />}
                        onClick={() => actions.createPlaylist()}
                    >
                        {t('action.createPlaylistFromQueue')}
                    </DropdownMenu.Item>
                )}
                {has('tableSettings') && (
                    <DropdownMenu.Item
                        leftSection={<Icon icon="settings" />}
                        onClick={() =>
                            openContextModal({
                                innerProps: queueTableConfig(listKey),
                                modal: 'listConfigSettings',
                                size: 'xl',
                                withCloseButton: false,
                            })
                        }
                    >
                        {t('naviConnect.queue.tableSettings')}
                    </DropdownMenu.Item>
                )}
            </DropdownMenu.Dropdown>
        </DropdownMenu>
    );
};
