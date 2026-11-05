import isElectron from 'is-electron';

import { hubSecretHeld } from '/@/renderer/features/hub/utils/hub-credential';
import { createAutoLook } from '/@/renderer/features/hub/utils/hub-finder-auto';
import { isHubConfigured } from '/@/renderer/features/settings/components/server/server-status';
import { useAuthStore, useHubStore, useSettingsStore } from '/@/renderer/store';
import { logger } from '/@/renderer/utils/logger';

/**
 * Worbus P3 (design §6.4): asking main to look for the Worbus Server. Main probes; the renderer
 * hands it the current Navidrome server's addresses, the only copy of the server list it gets.
 */

const hub = isElectron() ? window.api.hub : null;

/** The current server's `url` and `remoteUrl`, the hosts the Worbus Server may sit beside. */
export const currentNavidromeUrls = (): string[] => {
    const server = useAuthStore.getState().currentServer;
    return [server?.url, server?.remoteUrl].filter(
        (url): url is string => typeof url === 'string' && url.trim() !== '',
    );
};

/** "Look on this network" (no server set) or "Find home address" (set, no home address). */
export const lookOnNetwork = async (scope: 'home' | 'network'): Promise<void> => {
    if (!hub) return;
    try {
        await hub.finderLook(scope, currentNavidromeUrls());
    } catch (error) {
        logger.warn('[hub] looking on this network failed', { error: String(error) });
    }
};

/** Beside Navidrome only. */
export const lookBesideNavidrome = async (urls: string[]): Promise<void> => {
    if (!hub) return;
    try {
        await hub.finderLook('beside', urls);
    } catch (error) {
        logger.warn('[hub] looking beside Navidrome failed', { error: String(error) });
    }
};

/** A sign-in tap stops a sweep that is still running (design §7 RACES). */
export const stopLooking = (): void => hub?.finderCancel();

/** After a server is added, and when the Server tab opens: look, if no server is set. */
export const startAutoLook = createAutoLook({
    configured: () =>
        isHubConfigured({
            ...useSettingsStore.getState().hub,
            signedIn: hubSecretHeld(useHubStore.getState()),
        }),
    look: lookBesideNavidrome,
    navidromeUrls: currentNavidromeUrls,
});
