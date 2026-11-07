import isElectron from 'is-electron';

import { openFoundPrompt } from '/@/renderer/features/hub/components/hub-found-prompt';
import { hubSecretHeld } from '/@/renderer/features/hub/utils/hub-credential';
import { createAutoLook } from '/@/renderer/features/hub/utils/hub-finder-auto';
import { currentServerUsername } from '/@/renderer/features/hub/utils/hub-signin-actions';
import {
    dismissKey,
    isHubConfigured,
    promptFor,
    typedUrlAfterRemove,
} from '/@/renderer/features/settings/components/server/server-status';
import { useAuthStore, useHubStore, useSettingsStore } from '/@/renderer/store';
import { logger } from '/@/renderer/utils/logger';
import { HubFinderState, ServerEdit } from '/@/shared/utils/hub-addresses';

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

const hubConfiguredNow = (): boolean =>
    isHubConfigured({
        ...useSettingsStore.getState().hub,
        signedIn: hubSecretHeld(useHubStore.getState()),
    });

/**
 * After a Navidrome sign-in (a server added): look beside it if no server is set, and offer what
 * it found once (design §6.4) - exactly one server, not answered Not now before.
 */
export const startAutoLook = createAutoLook({
    configured: () =>
        isHubConfigured({
            ...useSettingsStore.getState().hub,
            signedIn: hubSecretHeld(useHubStore.getState()),
        }),
    look: async (urls) => {
        if (!hub) return;
        let state: HubFinderState;
        try {
            state = await hub.finderLook('beside', urls);
        } catch (error) {
            logger.warn('[hub] looking beside Navidrome failed', { error: String(error) });
            return;
        }
        const found = promptFor(state, useHubStore.getState().server?.record, hubConfiguredNow());
        const username = currentServerUsername();
        if (!found || !username) return;
        openFoundPrompt({
            found,
            onNotNow: () => void hub.serverEdit({ key: dismissKey(found), op: 'dismiss' }),
            username,
        });
    },
    navidromeUrls: currentNavidromeUrls,
});

/** Each time the Server tab opens: look beside Navidrome while no server is set. No prompt. */
export const lookIfNotSet = createAutoLook({
    configured: hubConfiguredNow,
    look: lookBesideNavidrome,
    navidromeUrls: currentNavidromeUrls,
});

/** One edit to main's server record; the answer is the new state (`hub-server` says it too). */
export const editServer = async (edit: ServerEdit): Promise<void> => {
    if (!hub) return;
    try {
        const server = await hub.serverEdit(edit);
        useHubStore.getState().actions.setStore({ server });
    } catch (error) {
        logger.warn('[hub] the server record edit failed', { error: String(error) });
    }
};

/**
 * Remove a typed or found address. `hub.url` keeps a typed or tapped address: when it was the
 * removed one it becomes the first typed or found address left (never a learned one).
 */
export const removeServerAddress = async (url: string): Promise<void> => {
    const before = useHubStore.getState().server?.record;
    await editServer({ op: 'remove', url });
    const typed = before
        ? typedUrlAfterRemove(before, url, useSettingsStore.getState().hub.url)
        : null;
    if (typed) useSettingsStore.getState().actions.setSettings({ hub: { url: typed } });
};
