import { hubSecretHeld, hubSetUp } from '/@/renderer/features/hub/utils/hub-credential';
import { useHubStore } from '/@/renderer/store/hub.store';
import { useSettingsStore } from '/@/renderer/store/settings.store';

/**
 * Worbus P2 (C1): "is the hub set up" for the renderer - switched on, an address, and a credential
 * (a device secret held or owed, or a typed token). See hub-credential.ts.
 */
export const hubSetUpNow = (): boolean =>
    hubSetUp(useSettingsStore.getState().hub, hubSecretHeld(useHubStore.getState()));

/** Main holds (or is getting) a device secret, as a hook. */
export const useHubSecretHeld = (): boolean => useHubStore(hubSecretHeld);

/** {@link hubSetUpNow} as a hook: re-renders on a setting change and on a sign-in or sign-out. */
export const useHubSetUp = (): boolean => {
    const held = useHubSecretHeld();
    return useSettingsStore((state) => hubSetUp(state.hub, held));
};
