import isElectron from 'is-electron';
import { useEffect } from 'react';

import { useSettingsStore } from '/@/renderer/store/settings.store';
import { logger } from '/@/renderer/utils/logger';
import { MIRRORED_SETTINGS, mirroredPatchFrom } from '/@/shared/utils/main-settings';

/**
 * B-328: at launch the renderer's copy of the settings main owns (`shared/utils/main-settings.ts`)
 * is made to say what main holds. Main started with its own values and acts on them, so the
 * renderer adopts them; it no longer pushes its copy over main's and asks for a restart. A
 * setting the person changes is written to both by its control; a settings import writes main's
 * copy too.
 */
let adopted = false;

export const useSyncSettingsToMain = () => {
    useEffect(() => {
        // Once per launch (a remount, or StrictMode's second run, asks nothing again).
        if (adopted) return;
        adopted = true;
        if (!isElectron() || !window.api.localSettings) return;
        const localSettings = window.api.localSettings;

        // The settings store hydrates from localStorage synchronously at creation, so it is read
        // as it is now; main's values are asked for once.
        void (async () => {
            const mainValues: Record<string, unknown> = {};
            for (const { key } of MIRRORED_SETTINGS) {
                mainValues[key] = await localSettings.get(key);
            }
            const patch = mirroredPatchFrom(
                useSettingsStore.getState() as unknown as Record<string, unknown>,
                mainValues,
            );
            const groups = Object.keys(patch);
            if (groups.length === 0) return;
            logger.info('Renderer settings adopted from the main process', {
                keys: groups.flatMap((group) =>
                    Object.keys(patch[group]).map((f) => `${group}.${f}`),
                ),
            });
            useSettingsStore.getState().actions.setSettings(patch as never);
        })();
    }, []);
};
