/**
 * "Find it" on a missing album (Worbus P1, F4): where else the record can be found, from lb-bot's
 * `findIt` on `/lb/meta/album` - MusicBrainz url-relations it confirmed, then search links it
 * built. Pure and import-free (`find-it.harness.ts`); the main client parses with it.
 *
 * These are external URLs from MusicBrainz that a user clicks, so only plain web links survive
 * (Worbus for Android ruling 8): `http:` / `https:`, a host, no user info, no backslash, at most 2,048
 * characters. An unknown service is dropped; `other` (confirmed only) is labelled with its host.
 */

export interface LbFindItLink {
    kind: 'confirmed' | 'search';
    /** What the chip says: the service, "Search <service>", or the host for `other`. */
    label: string;
    service: string;
    url: string;
}

/** The services lb-bot builds search links for, in the order they are shown. */
export const FIND_IT_SEARCH_ORDER = [
    'bandcamp',
    'qobuz',
    'apple-music',
    'spotify',
    'deezer',
    'youtube-music',
] as const;

const LABELS: Record<string, string> = {
    amazon: 'Amazon Music',
    'apple-music': 'Apple Music',
    bandcamp: 'Bandcamp',
    beatport: 'Beatport',
    deezer: 'Deezer',
    qobuz: 'Qobuz',
    soundcloud: 'SoundCloud',
    spotify: 'Spotify',
    tidal: 'TIDAL',
    'youtube-music': 'YouTube Music',
};

export const FIND_IT_MAX_URL = 2048;

/** The link as a browser should open it, or null when it is not a plain web link. */
const safeUrl = (raw: unknown): null | URL => {
    if (typeof raw !== 'string' || !raw || raw.length > FIND_IT_MAX_URL || raw.includes('\\')) {
        return null;
    }
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        return null;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!url.hostname || url.username || url.password) return null;
    return url;
};

const hostLabel = (url: URL): string => url.hostname.replace(/^www\./, '');

export const toFindIt = (raw: unknown): LbFindItLink[] => {
    if (!Array.isArray(raw)) return [];
    const confirmed: LbFindItLink[] = [];
    const search: LbFindItLink[] = [];
    const seen = new Set<string>();
    for (const item of raw) {
        if (!item || typeof item !== 'object') continue;
        const { kind, service } = item as Record<string, unknown>;
        if (typeof service !== 'string' || (kind !== 'confirmed' && kind !== 'search')) continue;
        const url = safeUrl((item as Record<string, unknown>).url);
        if (!url || seen.has(url.href)) continue;
        if (kind === 'search') {
            if (!(FIND_IT_SEARCH_ORDER as readonly string[]).includes(service)) continue;
            search.push({ kind, label: `Search ${LABELS[service]}`, service, url: url.href });
        } else if (service === 'other') {
            confirmed.push({ kind, label: hostLabel(url), service, url: url.href });
        } else if (LABELS[service]) {
            confirmed.push({ kind, label: LABELS[service], service, url: url.href });
        } else {
            continue;
        }
        seen.add(url.href);
    }
    const rank = (link: LbFindItLink) =>
        (FIND_IT_SEARCH_ORDER as readonly string[]).indexOf(link.service);
    return [...confirmed, ...search.sort((a, b) => rank(a) - rank(b))];
};
