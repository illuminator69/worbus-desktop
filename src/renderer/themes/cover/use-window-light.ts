import { useSyncExternalStore } from 'react';

import { useCoverColoursMode, useThemeSettings } from '/@/renderer/store/settings.store';
import { windowLight } from '/@/renderer/themes/cover/colour-change';

const DARK_QUERY = '(prefers-color-scheme: dark)';

const subscribe = (onChange: () => void) => {
    const query = window.matchMedia(DARK_QUERY);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
};

const systemDark = () => window.matchMedia(DARK_QUERY).matches;

/** Whether the cover-coloured window is light: the user's mode or the system's, never the cover's. */
export const useWindowLight = (): boolean => {
    const { followSystemTheme } = useThemeSettings();
    const mode = useCoverColoursMode();
    const dark = useSyncExternalStore(subscribe, systemDark);
    return windowLight({ followSystemTheme, mode }, dark);
};
