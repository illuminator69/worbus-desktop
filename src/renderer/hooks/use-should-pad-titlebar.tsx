import isElectron from 'is-electron';
import { useLocation } from 'react-router';

import { useRightSidebarVisible } from '/@/renderer/features/now-playing/hooks/use-right-sidebar-visible';
import { AppRoute } from '/@/renderer/router/routes';
import { useWindowSettings } from '/@/renderer/store';
import { Platform } from '/@/shared/types/types';

export const useShouldPadTitlebar = () => {
    const location = useLocation();
    // The queue panel as it stands in the grid: a queue folded to its rail for width (R6, B-207)
    // leaves the title bar's corner to the page, as a closed one does.
    const queuePanelVisible = useRightSidebarVisible();
    const isQueuePage = location.pathname === AppRoute.NOW_PLAYING;
    const { windowBarStyle } = useWindowSettings();

    const conditions = [
        isElectron(),
        windowBarStyle === Platform.WEB,
        !(queuePanelVisible && !isQueuePage),
    ];

    const shouldPadTitlebar = conditions.every((condition) => condition);

    return shouldPadTitlebar;
};
