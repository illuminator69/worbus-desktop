import isElectron from 'is-electron';

import { openRestartRequiredToast } from '/@/renderer/features/settings/restart-toast';
import { mirroredWrites } from '/@/shared/utils/main-settings';

/**
 * B-328: a write that replaces many settings at once (a settings import) reaches main's copy of
 * the settings main owns as well, through the same table (`shared/utils/main-settings.ts`). Main
 * acts on several of them only at start, so a change asks for the restart here, once, instead of
 * at the next launch.
 */
export const writeMirroredToMain = (
    before: Record<string, unknown>,
    after: Record<string, unknown>,
): void => {
    const localSettings = isElectron() ? window.api.localSettings : null;
    if (!localSettings) return;
    const writes = mirroredWrites(before, after);
    for (const { key, value } of writes) {
        localSettings.set(key, value as never);
    }
    if (writes.length > 0) openRestartRequiredToast();
};
