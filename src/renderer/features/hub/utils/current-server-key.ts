import { serverKeyOf } from '/@/renderer/features/hub/utils/server-key';
import { useHubStore } from '/@/renderer/store/hub.store';
import { useSettingsStore } from '/@/renderer/store/settings.store';

/**
 * Worbus P3 (design §6.5): the per-server key now - `id:<serverId>` once main's record holds the
 * id, else the typed address (`hub.url`, as project 2 keyed everything). Read by the lb-bot
 * mirror, the downloads mode, the mood catalogue and the `lbStatus` reset.
 */
export const currentServerKey = (): string =>
    serverKeyOf(useHubStore.getState().server?.record, useSettingsStore.getState().hub?.url ?? '');

/** Main has said what its record holds (until then an id-keyed value is not judged). */
export const serverRecordKnown = (): boolean => useHubStore.getState().server !== null;

/** The per-server key, re-rendering when it changes. */
export const useServerKey = (): string => {
    const url = useSettingsStore((state) => state.hub?.url ?? '');
    const record = useHubStore((state) => state.server?.record);
    return serverKeyOf(record, url);
};
