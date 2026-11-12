import type { FingerprintAnswer } from '/@/shared/utils/fingerprint-refusal';

import { ipcRenderer } from 'electron';

/**
 * Renderer-facing bridge for the Tier-2 AudioMuse-AI core API. The main process
 * does the actual (CORS-free) HTTP; these return resolved Navidrome song ids.
 */

const fingerprint = (
    baseUrl: string,
    token: string,
    ndUser: string,
    ndPassword: string,
    count: number,
): Promise<FingerprintAnswer> =>
    ipcRenderer.invoke('audiomuse-fingerprint', { baseUrl, count, ndPassword, ndUser, token });

export interface AlchemyResult {
    centroid2d: null | number[];
    ids: string[];
}

const alchemy = (
    baseUrl: string,
    token: string,
    addIds: string[],
    subtractIds: string[],
    count: number,
    temperature?: number,
    subtractDistance?: number,
): Promise<AlchemyResult> =>
    ipcRenderer.invoke('audiomuse-alchemy', {
        addIds,
        baseUrl,
        count,
        subtractDistance,
        subtractIds,
        temperature,
        token,
    });

const trackMood = (baseUrl: string, token: string, itemId: string) =>
    ipcRenderer.invoke('audiomuse-track-mood', { baseUrl, itemId, token });

export interface ClapResult {
    author: string;
    id: string;
    similarity: number;
    title: string;
}

const clapSearch = (
    baseUrl: string,
    token: string,
    query: string,
    limit: number,
): Promise<ClapResult[]> =>
    ipcRenderer.invoke('audiomuse-clap-search', { baseUrl, limit, query, token });

const clapStats = (baseUrl: string, token: string): Promise<{ available: boolean }> =>
    ipcRenderer.invoke('audiomuse-clap-stats', { baseUrl, token });

export const audioMuse = {
    alchemy,
    clapSearch,
    clapStats,
    fingerprint,
    trackMood,
};
