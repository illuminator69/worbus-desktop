import { ipcMain } from 'electron';

import { getHubConfig, hubAuth, hubEvents } from '../hub';
import { fingerprintRequest } from './fingerprint-request';

/**
 * navi-connect Tier-2 AudioMuse-AI core API client (main process).
 *
 * The AudioMuse core API sets no CORS headers, so the renderer can't call it
 * directly under web security — these handlers make the calls from the main
 * process (no CORS) and return only resolved Navidrome song ids. The renderer
 * passes all config per-call, so nothing is persisted here. Fail-soft: every
 * handler returns empty on any error.
 *
 * TWO ROUTES, hub preferred (see DESIGN-hub-audiomuse-proxy.md):
 *  1. **Through the hub** — `<hub>/sonic/*` with `Authorization: Bearer <HUB_TOKEN>`
 *     (plain HTTP on the hub's WebSocket port, PROTOCOL §14). The hub holds the
 *     AudioMuse address, the AudioMuse token and the Navidrome password
 *     server-side, so this machine carries none of them.
 *  2. **Direct** — the legacy `<baseUrl>/api/*` with the per-device AudioMuse
 *     token the renderer passes in. Kept as a fallback for a setup with no hub.
 */

interface Endpoint {
    base: string;
    token: string;
    viaHub: boolean;
}

// How long a "hub proxy not configured" answer keeps us on the direct route —
// the hub may gain an AUDIOMUSE_URL without this app restarting.
const HUB_DEMOTE_TTL_MS = 10 * 60 * 1000;
let hubDemotedAt = 0;

// A hub URL/token change invalidates what we learned about the old hub.
hubEvents.on('settings', () => {
    hubDemotedAt = 0;
});

/** `ws://host:4790` → `http://host:4790`; null when the hub isn't configured. */
const hubProxyBase = (): null | string => {
    const { enabled, url } = getHubConfig();
    // Worbus P2: the device secret, else the typed token (hubAuth); neither means no hub.
    if (!enabled || !url || !hubAuth.bearer()) return null;
    if (hubDemotedAt && Date.now() - hubDemotedAt <= HUB_DEMOTE_TTL_MS) return null;
    return trimBase(url.replace(/^ws/, 'http')).replace(/\/connect$/, '');
};

/** The route the next call should take, or null when Tier 2 isn't configured at all. */
const endpoint = (args: { baseUrl?: string; token?: string }): Endpoint | null => {
    const hub = hubProxyBase();
    if (hub) return { base: hub, token: hubAuth.bearer() ?? '', viaHub: true };
    if (args.baseUrl && args.token) {
        return { base: trimBase(args.baseUrl), token: args.token, viaHub: false };
    }
    return null;
};

/** Hub path when routed through the proxy, upstream path when going direct. */
const routeUrl = (ep: Endpoint, hubPath: string, directPath: string): string =>
    `${ep.base}${ep.viaHub ? hubPath : directPath}`;

const authHeaders = (ep: Endpoint): Record<string, string> => ({
    Authorization: `Bearer ${ep.token}`,
});

interface AlchemyArgs {
    addIds: string[];
    baseUrl: string;
    count: number;
    subtractDistance?: number;
    subtractIds: string[];
    temperature?: number;
    token: string;
}

interface FingerprintArgs {
    baseUrl: string;
    count: number;
    ndPassword: string;
    ndUser: string;
    token: string;
}

const trimBase = (url: string): string => url.replace(/\/+$/, '');

const collectItemIds = (value: unknown): string[] => {
    if (!value) return [];

    if (typeof value === 'string') {
        return [value];
    }

    if (Array.isArray(value)) {
        return value.flatMap(collectItemIds);
    }

    if (typeof value !== 'object') {
        return [];
    }

    const row = value as Record<string, unknown>;
    const directId = row.item_id ?? row.itemId ?? row.song_id ?? row.songId ?? row.id;
    if (typeof directId === 'string') {
        return [directId];
    }

    return ['results', 'songs', 'tracks', 'items', 'playlist', 'data'].flatMap((key) =>
        collectItemIds(row[key]),
    );
};

const itemIds = (data: unknown): string[] => {
    return Array.from(new Set(collectItemIds(data).filter(Boolean)));
};

ipcMain.handle(
    'audiomuse-fingerprint',
    async (_event, args: FingerprintArgs): Promise<string[]> => {
        const ep = endpoint(args);
        if (!ep) return [];
        // Worbus P2: signed in to a Worbus Server, the fingerprint is the hub's to answer (it is the
        // primary user's listening, 403 to anyone else). The direct route would read whatever
        // Navidrome account this app holds - never taken while signed in, nor while a sign-in is
        // owed (a memory-only secret after a restart, a 4005 being answered).
        const auth = hubAuth.state();
        if (!ep.viaHub && (auth.signedIn || auth.needsSignIn)) return [];
        try {
            const { init, url } = fingerprintRequest(ep, args);
            const res = await fetch(url, init);
            if (!res.ok) return [];
            return itemIds(await res.json());
        } catch {
            return [];
        }
    },
);

export interface AlchemyResult {
    centroid2d: null | number[];
    ids: string[];
}

const parseCentroid = (data: unknown): null | number[] => {
    const c = (data as { centroid_2d?: unknown })?.centroid_2d;
    if (!Array.isArray(c)) return null;
    const nums = c.map((n) => (typeof n === 'string' ? Number(n) : (n as number)));
    return nums.every((n) => Number.isFinite(n)) ? nums : null;
};

ipcMain.handle('audiomuse-alchemy', async (_event, args: AlchemyArgs): Promise<AlchemyResult> => {
    const ep = endpoint(args);
    if (!ep || args.addIds.length === 0) {
        return { centroid2d: null, ids: [] };
    }
    try {
        const items = [
            ...args.addIds.map((id) => ({ id, op: 'ADD', type: 'song' })),
            ...args.subtractIds.map((id) => ({ id, op: 'SUBTRACT', type: 'song' })),
        ];
        const body: Record<string, unknown> = { items, n: args.count };
        if (args.temperature != null) body.temperature = args.temperature;
        if (args.subtractDistance != null) body.subtract_distance = args.subtractDistance;

        const res = await fetch(routeUrl(ep, '/sonic/alchemy', '/api/alchemy'), {
            body: JSON.stringify(body),
            headers: { ...authHeaders(ep), 'Content-Type': 'application/json' },
            method: 'POST',
        });
        if (!res.ok) return { centroid2d: null, ids: [] };
        const data = await res.json();
        return { centroid2d: parseCentroid(data), ids: itemIds(data) };
    } catch {
        return { centroid2d: null, ids: [] };
    }
});

interface TrackMoodArgs {
    baseUrl: string;
    itemId: string;
    token: string;
}

const parseMoodVector = (value: unknown): number[] | Record<string, number> | undefined => {
    if (value == null) return undefined;
    if (Array.isArray(value)) return value as number[];
    if (typeof value === 'object') return value as Record<string, number>;
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            if (Array.isArray(parsed) || (parsed && typeof parsed === 'object')) {
                return parsed;
            }
        } catch {
            /* not JSON — ignore */
        }
    }
    return undefined;
};

const toFiniteNumber = (value: unknown): number | undefined => {
    const n = typeof value === 'string' ? Number(value) : (value as number);
    return Number.isFinite(n) ? n : undefined;
};

export interface ClapResult {
    author: string;
    id: string;
    similarity: number;
    title: string;
}

interface ClapSearchArgs {
    baseUrl: string;
    limit: number;
    query: string;
    token: string;
}

const toClapResults = (data: unknown): ClapResult[] => {
    const results = (data as { results?: unknown })?.results;
    if (!Array.isArray(results)) return [];
    return results.flatMap((row): ClapResult[] => {
        if (!row || typeof row !== 'object') return [];
        const r = row as Record<string, unknown>;
        const id = r.item_id ?? r.itemId ?? r.id;
        if (typeof id !== 'string' || !id) return [];
        return [
            {
                author: typeof r.author === 'string' ? r.author : '',
                id,
                similarity: toFiniteNumber(r.similarity) ?? 0,
                title: typeof r.title === 'string' ? r.title : '',
            },
        ];
    });
};

// CLAP text→audio search: free-text query → tracks whose audio embedding best
// matches. POST /api/clap/search {query, limit}. Fail-soft: [] on disabled
// (400), cache-not-loaded (503), or any error — the UI greys out / shows empty.
ipcMain.handle(
    'audiomuse-clap-search',
    async (_event, args: ClapSearchArgs): Promise<ClapResult[]> => {
        const ep = endpoint(args);
        if (!ep || !args.query) return [];
        try {
            const res = await fetch(routeUrl(ep, '/sonic/clap/search', '/api/clap/search'), {
                body: JSON.stringify({ limit: args.limit, query: args.query }),
                headers: { ...authHeaders(ep), 'Content-Type': 'application/json' },
                method: 'POST',
            });
            if (!res.ok) return [];
            return toClapResults(await res.json());
        } catch {
            return [];
        }
    },
);

// /api/clap/stats merges get_cache_stats() ({loaded, song_count, ...}) with
// clap_enabled. Available = feature on AND the embedding index is loaded
// (song_count>0, or the explicit loaded flag).
const statsAvailable = (stats: Record<string, unknown>): boolean =>
    stats.clap_enabled === true &&
    (stats.loaded === true || (toFiniteNumber(stats.song_count) ?? 0) > 0);

const fetchClapStats = async (ep: Endpoint): Promise<null | Record<string, unknown>> => {
    try {
        const res = await fetch(routeUrl(ep, '/sonic/clap/stats', '/api/clap/stats'), {
            headers: authHeaders(ep),
        });
        if (!res.ok) return null;
        return (await res.json()) as Record<string, unknown>;
    } catch {
        return null;
    }
};

// Capability probe for greying out the CLAP entry point — and, over the hub, the
// Tier-2 route probe: the hub answers with its own {configured, upstreamReachable}
// alongside the upstream stats (PROTOCOL §14), so a hub with no AUDIOMUSE_URL
// demotes us to the direct route instead of leaving Tier 2 silently dead.
// Fail-soft: false on any error.
ipcMain.handle(
    'audiomuse-clap-stats',
    async (_event, args: { baseUrl: string; token: string }): Promise<{ available: boolean }> => {
        const ep = endpoint(args);
        if (!ep) return { available: false };
        const stats = await fetchClapStats(ep);
        // Two ways the hub route can be useless: it reports no AudioMuse configured, or
        // it doesn't answer with anything parseable at all — unreachable, or too old to
        // route /sonic/* (in which case the WebSocket handshake answers a 426
        // text/plain, which is not JSON). Both mean "try the direct route". Only
        // handling the first left an install with a perfectly good direct config with
        // Tier 2 silently dead, because endpoint() always prefers the hub.
        if (ep.viaHub && (!stats || stats.configured === false)) {
            hubDemotedAt = Date.now();
            if (!args.baseUrl || !args.token) return { available: false };
            const direct = await fetchClapStats({
                base: trimBase(args.baseUrl),
                token: args.token,
                viaHub: false,
            });
            return { available: direct ? statsAvailable(direct) : false };
        }
        if (!stats) return { available: false };
        if (ep.viaHub && stats.upstreamReachable === false) return { available: false };
        if (ep.viaHub && stats.configured === true) hubDemotedAt = 0;
        return { available: statsAvailable(stats) };
    },
);

// /get_score returns a track's full analysis row (mood_vector, other_features,
// top_genre). Normalized to a small mood object for the visualizer; null when not
// configured, the track isn't analyzed (404), or on any error.
ipcMain.handle('audiomuse-track-mood', async (_event, args: TrackMoodArgs) => {
    const ep = endpoint(args);
    if (!ep || !args.itemId) return null;
    try {
        const url = new URL(routeUrl(ep, '/sonic/score', '/get_score'));
        url.searchParams.set('id', args.itemId);

        const res = await fetch(url.toString(), { headers: authHeaders(ep) });
        if (!res.ok) return null;

        const row = (await res.json()) as Record<string, unknown>;
        const features = (row.other_features ?? {}) as Record<string, unknown>;

        return {
            energy: toFiniteNumber(features.energy ?? row.energy),
            moodVector: parseMoodVector(row.mood_vector),
            tempo: toFiniteNumber(features.tempo ?? row.tempo),
            topGenre: typeof row.top_genre === 'string' ? row.top_genre : undefined,
        };
    } catch {
        return null;
    }
});
