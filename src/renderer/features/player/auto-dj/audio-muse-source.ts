import isElectron from 'is-electron';

import i18n from '/@/i18n/i18n';
import { hubSetUpNow } from '/@/renderer/store/hub-set-up';
import { ServerListItem } from '/@/shared/types/domain-types';
import { refusalLine } from '/@/shared/utils/fingerprint-refusal';

// navi-connect Tier 2: AudioMuse-AI core API, for what the hub's stations do not cover: CLAP
// mood search, and the "Mixed for You" recipes played without the station engine (I-040: radio
// and autoplay are the hub's stations now, PROTOCOL §18, and Mood Flow is gone).
// Routed through the main process (the core API has no CORS), so it only works
// in the desktop build. Returns Navidrome song ids; fail-soft to [], except a named refusal of
// the fingerprint (an AudioMuse too old for it), which throws its sentence.
//
// The main process prefers the hub's /sonic/* proxy and falls back to these
// direct settings (see DESIGN-hub-audiomuse-proxy.md), so Tier 2 counts as
// configured when EITHER is set; a hub-routed setup leaves these fields blank.

export interface AudioMuseSettings {
    token: string;
    url: string;
}

const bridge = () => (isElectron() ? window.api.audioMuse : undefined);

// Reads the stores directly so the async fetchers below stay non-reactive. Worbus P2: a device
// signed in to the hub has no typed token, so the test is the credential's (hub-credential.ts).
const hubRouteConfigured = (): boolean => hubSetUpNow();

const audioMuseConfigured = (settings: AudioMuseSettings): boolean =>
    isElectron() && (hubRouteConfigured() || (Boolean(settings.url) && Boolean(settings.token)));

export const fetchFingerprintIds = async (
    settings: AudioMuseSettings,
    server: null | ServerListItem,
    count: number,
): Promise<string[]> => {
    const api = bridge();
    if (!api || !audioMuseConfigured(settings)) return [];
    // Pass the username; the AudioMuse core supplies the password from its own
    // NAVIDROME_PASSWORD config (Worbus for desktop stores a salted token, not the password).
    const answer = await api.fingerprint(
        settings.url,
        settings.token,
        server?.username ?? '',
        '',
        count,
    );
    if (answer.refused) {
        // Fix round 3: a named refusal is an error the mix runner shows ("Could not build …"),
        // not an empty mix that reads as no listening.
        const line = refusalLine(answer.refused);
        throw new Error('text' in line ? line.text : (i18n.t(line.key, line.values) as string));
    }
    return answer.ids;
};

/** Song Alchemy knobs; undefined means the server's default (temperature 1.0, subtract 0.2). */
export interface AlchemyParams {
    subtractDistance?: number;
    temperature?: number;
}

export const fetchAlchemyIds = async (
    settings: AudioMuseSettings,
    addIds: string[],
    subtractIds: string[],
    count: number,
    params?: AlchemyParams,
): Promise<string[]> => {
    const api = bridge();
    if (!api || !audioMuseConfigured(settings) || addIds.length === 0) return [];
    const { ids } = await api.alchemy(
        settings.url,
        settings.token,
        addIds,
        subtractIds,
        count,
        params?.temperature,
        params?.subtractDistance,
    );
    return ids;
};

// A single CLAP text-search result (id + display fields).
export interface ClapResult {
    author: string;
    id: string;
    similarity: number;
    title: string;
}

// CLAP text→audio mood search. Fail-soft to [] (disabled/unanalyzed/non-Electron).
export const fetchClapSearch = async (
    settings: AudioMuseSettings,
    query: string,
    limit: number,
): Promise<ClapResult[]> => {
    const api = bridge();
    if (!api || !audioMuseConfigured(settings) || !query.trim()) return [];
    return api.clapSearch(settings.url, settings.token, query.trim(), limit);
};

// Probe whether CLAP search is usable on the server (enabled + embeddings loaded).
export const fetchClapAvailable = async (settings: AudioMuseSettings): Promise<boolean> => {
    const api = bridge();
    if (!api || !audioMuseConfigured(settings)) return false;
    const { available } = await api.clapStats(settings.url, settings.token);
    return available;
};
