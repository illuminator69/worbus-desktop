import { useSidebarPanels } from '/@/renderer/features/now-playing/components/sidebar-play-queue';
import { useQueueFolded } from '/@/renderer/features/now-playing/hooks/use-queue-panel-toggle';
import { useQueueOverlayOpen } from '/@/renderer/layouts/default-layout/use-shell-fit';
import { useAppStore, useSideQueueLayout, useSideQueueType } from '/@/renderer/store';

/**
 * Whether the queue panel stands in the grid: open, in side-queue mode, with at least one panel
 * to show, and the window wide enough for it.
 */
export const useRightSidebarVisible = (): boolean => {
    const rightExpanded = useAppStore((state) => state.sidebar.rightExpanded);
    const sideQueueType = useSideQueueType();
    const panels = useSidebarPanels();
    const folded = useQueueFolded();
    return rightExpanded && sideQueueType === 'sideQueue' && panels.length > 0 && !folded;
};

/** Whether the queue panel is open over the page, the way a folded queue opens. */
export const useQueueOverlayVisible = (): boolean => {
    const overlayOpen = useQueueOverlayOpen();
    const panels = useSidebarPanels();
    const folded = useQueueFolded();
    return folded && overlayOpen && panels.length > 0;
};

/** Whether the collapsed queue rail stands where the panel was: the panel is hidden but could be shown. */
export const useQueueRailVisible = (): boolean => {
    const rightSidebarVisible = useRightSidebarVisible();
    const sideQueueType = useSideQueueType();
    const sideQueueLayout = useSideQueueLayout();
    const panels = useSidebarPanels();
    return (
        !rightSidebarVisible &&
        sideQueueType === 'sideQueue' &&
        sideQueueLayout !== 'vertical' &&
        panels.length > 0
    );
};
