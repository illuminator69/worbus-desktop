import type { MoodCatalogue, MoodListData, MoodResult } from '/@/shared/types/mood-types';

import { ipcRenderer } from 'electron';

/**
 * Renderer-facing bridge for the hub's mood routes. The main process makes the HTTP calls with
 * the hub's base and bearer; these only carry bodies and results.
 */

const catalogue = (): Promise<MoodResult<MoodCatalogue>> => ipcRenderer.invoke('mood-catalogue');

const list = (body: { mood: string; variant: string }): Promise<MoodResult<MoodListData>> =>
    ipcRenderer.invoke('mood-list', body);

export const mood = {
    catalogue,
    list,
};
