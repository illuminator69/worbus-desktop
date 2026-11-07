import { openModal } from '@mantine/modals';
import isElectron from 'is-electron';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { useRemoteAwareStatus } from '/@/renderer/features/hub/hooks/use-remote-aware';
import { openCreatePlaylistModal } from '/@/renderer/features/playlists/components/create-playlist-form';
import { ServerList } from '/@/renderer/features/servers/components/server-list';
import { openSettingsModal } from '/@/renderer/features/settings/utils/open-settings-modal';
import { useSidebarFolded } from '/@/renderer/layouts/default-layout/use-shell-fit';
import {
    useAppStore,
    useAppStoreActions,
    useCommandPalette,
    useCurrentServer,
    usePlayerHydrated,
    usePlayerRepeat,
    usePlayerShuffle,
} from '/@/renderer/store';
import { PlayerShuffle } from '/@/shared/types/types';

const ipc = isElectron() ? window.api.ipc : null;

export const useNativeMenuSync = () => {
    const { t } = useTranslation();
    const privateMode = useAppStore((state) => state.privateMode);
    const sidebar = useAppStore((state) => state.sidebar);
    // A sidebar folded to its rail for width (R6, B-198) shows as collapsed, and the toggle waits
    // for the window to widen: it would write the user's flag with nothing to see.
    const sidebarFolded = useSidebarFolded();
    const { setPrivateMode, setSideBar } = useAppStoreActions();
    const { open: openCommandPalette } = useCommandPalette();
    const server = useCurrentServer();
    const playerHydrated = usePlayerHydrated();
    const playerRepeat = usePlayerRepeat();
    const playerShuffle = usePlayerShuffle();
    // navi-connect: the native menu's play/pause item follows the session, not the local
    // (paused-by-design) engine, so it doesn't offer "Play" while a remote device plays.
    const playerStatus = useRemoteAwareStatus();

    useEffect(() => {
        if (!isElectron()) {
            return undefined;
        }

        window.api.utils.rendererOpenSettings(() => {
            openSettingsModal();
        });

        return () => {
            ipc?.removeAllListeners('renderer-open-settings');
        };
    }, []);

    useEffect(() => {
        if (!isElectron()) {
            return undefined;
        }

        window.api.utils.rendererOpenCommandPalette(() => {
            openCommandPalette();
        });

        return () => {
            ipc?.removeAllListeners('renderer-open-command-palette');
        };
    }, [openCommandPalette]);

    useEffect(() => {
        if (!isElectron()) {
            return undefined;
        }

        window.api.utils.rendererOpenCreatePlaylist(() => {
            openCreatePlaylistModal(server);
        });

        return () => {
            ipc?.removeAllListeners('renderer-open-create-playlist');
        };
    }, [server]);

    useEffect(() => {
        if (!isElectron()) {
            return undefined;
        }

        window.api.utils.rendererOpenManageServers(() => {
            openModal({
                children: <ServerList />,
                title: t('page.manageServers.title'),
            });
        });

        return () => {
            ipc?.removeAllListeners('renderer-open-manage-servers');
        };
    }, [t]);

    useEffect(() => {
        if (!isElectron()) {
            return undefined;
        }

        window.api.utils.rendererTogglePrivateMode(() => {
            setPrivateMode(!privateMode);
        });

        return () => {
            ipc?.removeAllListeners('renderer-toggle-private-mode');
        };
    }, [privateMode, setPrivateMode]);

    useEffect(() => {
        if (!isElectron()) {
            return undefined;
        }

        window.api.utils.rendererToggleSidebar(() => {
            if (sidebarFolded) return;
            setSideBar({ collapsed: !sidebar.collapsed });
        });

        return () => {
            ipc?.removeAllListeners('renderer-toggle-sidebar');
        };
    }, [setSideBar, sidebar.collapsed, sidebarFolded]);

    useEffect(() => {
        if (!isElectron()) {
            return;
        }

        if (!playerHydrated) {
            return;
        }

        ipc?.send('update-playback', playerStatus);
        ipc?.send('update-repeat', playerRepeat);
        ipc?.send('update-shuffle', playerShuffle !== PlayerShuffle.NONE);
    }, [playerHydrated, playerRepeat, playerShuffle, playerStatus]);

    useEffect(() => {
        if (!isElectron()) {
            return;
        }

        ipc?.send('update-private-mode', privateMode);
    }, [privateMode]);

    useEffect(() => {
        if (!isElectron()) {
            return;
        }

        ipc?.send('update-sidebar-collapsed', sidebar.collapsed || sidebarFolded, sidebarFolded);
    }, [sidebar.collapsed, sidebarFolded]);
};
