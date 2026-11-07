import { useCallback } from 'react';

import { queuePanelToggle } from '/@/renderer/features/now-playing/utils/queue-panel-toggle';
import {
    useQueueOverlayOpen,
    useSetQueueOverlay,
    useShellFit,
} from '/@/renderer/layouts/default-layout/use-shell-fit';
import {
    useAppStore,
    useAppStoreActions,
    useSideQueueLayout,
    useSideQueueType,
} from '/@/renderer/store';

/**
 * Whether the window is too narrow for the queue panel in the grid (B-207): it shows as its rail,
 * and opens over the page instead. Only the horizontal side queue folds; the vertical one sits
 * under the page and takes no width.
 *
 * Here and not in use-right-sidebar-visible.ts, which imports it from here: that file reads the
 * panel list from sidebar-play-queue.tsx, and the panel's header needs this file without that loop.
 */
export const useQueueFolded = (): boolean => {
    const folded = useShellFit().queue === 'rail';
    const sideQueueType = useSideQueueType();
    const sideQueueLayout = useSideQueueLayout();
    return folded && sideQueueType === 'sideQueue' && sideQueueLayout !== 'vertical';
};

/**
 * Shows or hides the side queue (R14, B-250): the one action behind the rail, the open panel's
 * hide button and the player bar's queue icon, so all three move the same state.
 */
export const useToggleQueuePanel = (): (() => void) => {
    const folded = useQueueFolded();
    const overlayOpen = useQueueOverlayOpen();
    const rightExpanded = useAppStore((state) => state.sidebar.rightExpanded);
    const setQueueOverlay = useSetQueueOverlay();
    const { setSideBar } = useAppStoreActions();
    return useCallback(() => {
        const move = queuePanelToggle({ folded, overlayOpen, rightExpanded });
        if (move.target === 'overlay') setQueueOverlay(move.open);
        else setSideBar({ rightExpanded: move.open });
    }, [folded, overlayOpen, rightExpanded, setQueueOverlay, setSideBar]);
};
