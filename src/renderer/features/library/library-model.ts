import type { FuzzyIndex, FuzzyTier } from '../../../shared/utils/fuzzy-match.ts';

import { fuzzyTier, normalizeForSearch } from '../../../shared/utils/fuzzy-match.ts';

/**
 * F6: the Library's Artists page, pure (for the harness). Your artists are sorted and ranked here
 * from the whole album-artist list; the MusicBrainz half is split by MBID, never by name; the page's
 * phase follows the query and the lookup's state, where a failure is never "nothing"; the URL keeps
 * the text and the sort; the Tracks table marks the column its sort orders by.
 */

export type ArtistSort = 'az' | 'plays' | 'releases';

export type ExternalCandidate = {
    country: string;
    disambiguation: string;
    mbid: string;
    name: string;
    type: string;
};

export type LibraryArtist = {
    albumCount: null | number;
    id: string;
    mbz: null | string;
    name: string;
    playCount: null | number;
};

/**
 * The MusicBrainz half's state. `failed` (lb-bot down, 502, 503, a timeout) and `older` (lb-bot or the
 * hub lacks the route) are not an empty answer, and neither is `idle` (not asked yet).
 */
export type Lookup<T> =
    | { items: T[]; kind: 'done' }
    | { kind: 'failed'; message?: string }
    | { kind: 'idle' }
    | { kind: 'looking' }
    | { kind: 'older' };

const ARTIST_SORTS: readonly ArtistSort[] = ['az', 'plays', 'releases'];

const byName = (a: { key: string }, b: { key: string }) =>
    a.key < b.key ? -1 : a.key > b.key ? 1 : 0;

/**
 * A to Z by the name as displayed (normalised: case and accents fold, "The" stays, as in lb-bot's web
 * Library), Plays and Releases highest first with ties by name and a missing count as 0. Stable.
 */
export const sortArtists = <T extends LibraryArtist>(list: readonly T[], sort: ArtistSort): T[] => {
    const keyed = list.map((artist, at) => ({ artist, at, key: normalizeForSearch(artist.name) }));
    const count = (a: T) => (sort === 'plays' ? a.playCount : a.albumCount) ?? 0;
    keyed.sort((a, b) => {
        if (sort !== 'az') {
            const diff = count(b.artist) - count(a.artist);
            if (diff !== 0) return diff;
        }
        return byName(a, b) || a.at - b.at;
    });
    return keyed.map((k) => k.artist);
};

// An index's values sorted, and each value's place in that order, per sort: built once per list
// (the browse view builds it), read on every keystroke to break ties.
const sortedCache = new WeakMap<
    object,
    Map<ArtistSort, { order: Map<unknown, number>; sorted: readonly unknown[] }>
>();

const sortedOf = <T extends LibraryArtist>(index: FuzzyIndex<T>, sort: ArtistSort) => {
    let bySort = sortedCache.get(index);
    if (!bySort) {
        bySort = new Map();
        sortedCache.set(index, bySort);
    }
    let entry = bySort.get(sort);
    if (!entry) {
        const sorted = sortArtists(index.values, sort);
        entry = { order: new Map(sorted.map((artist, n) => [artist, n])), sorted };
        bySort.set(sort, entry);
    }
    return entry as { order: Map<T, number>; sorted: readonly T[] };
};

/**
 * Your artists for a query: match quality first, the chosen sort breaking ties; `limit` cuts after
 * ordering. A blank query is the sorted list, each row tier `exact`.
 */
export const rankArtists = <T extends LibraryArtist>(
    index: FuzzyIndex<T>,
    query: string,
    sort: ArtistSort,
    limit = Infinity,
): { artist: T; tier: FuzzyTier }[] => {
    const { order, sorted } = sortedOf(index, sort);
    if (query.trim() === '') {
        return (Number.isFinite(limit) ? sorted.slice(0, limit) : sorted).map((artist) => ({
            artist,
            tier: 'exact' as const,
        }));
    }
    const hits = index.search(query, Infinity);
    hits.sort((a, b) => b.score - a.score || order.get(a.value)! - order.get(b.value)!);
    const cut = Number.isFinite(limit) ? hits.slice(0, limit) : hits;
    return cut.map((hit) => ({ artist: hit.value, tier: fuzzyTier(hit.score) ?? 'typo' }));
};

const mbidKey = (mbid: null | string | undefined) => (mbid ?? '').trim().toLowerCase();

/**
 * Which MBIDs the library holds, to its Navidrome artist id: Navidrome's own `mbz` tag, or an
 * index-mirror row whose Navidrome id the loaded list still has. Navidrome's tag wins.
 */
export const buildOwnedByMbid = (
    artists: readonly { id: string; mbz: null | string }[],
    mirror: readonly { mbid: string; ndArtistId: string }[],
): Record<string, string> => {
    const owned: Record<string, string> = {};
    const loaded = new Set(artists.map((a) => a.id));
    for (const row of mirror) {
        const key = mbidKey(row.mbid);
        if (key && row.ndArtistId && loaded.has(row.ndArtistId)) owned[key] = row.ndArtistId;
    }
    for (const artist of artists) {
        const key = mbidKey(artist.mbz);
        if (key) owned[key] = artist.id;
    }
    return owned;
};

/** MusicBrainz's candidates in its order, each with the library artist that holds its MBID, if any. */
export const splitExternalArtists = <C extends ExternalCandidate>(
    candidates: readonly C[],
    ownedByMbid: Record<string, string>,
): { candidate: C; ownedId: null | string }[] =>
    candidates.map((candidate) => ({
        candidate,
        ownedId: ownedByMbid[mbidKey(candidate.mbid)] ?? ownedByMbid[candidate.mbid] ?? null,
    }));

/** "N with gaps": the indexed discography rows whose status is `incomplete`. */
export const gapCount = (rows: readonly { status: string }[]): number =>
    rows.reduce((n, row) => (row.status === 'incomplete' ? n + 1 : n), 0);

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/gu;

/** A pasted URL: http(s), no spaces. */
export const isPastedLink = (text: string): boolean => /^https?:\/\/\S+$/i.test(text.trim());

/** A URL, or a host with a path ("spotify.com/album"): never a name worth a MusicBrainz lookup. */
export const isLinkShaped = (text: string): boolean => {
    const t = text.trim();
    return isPastedLink(t) || /^(www\.)?[\w-]+(\.[\w-]+)+\/\S*$/i.test(t);
};

/** One lookup per settled query of 3 letters or more (2 with CJK); never for link-shaped text. */
export const externalLookupWanted = (query: string): boolean => {
    if (isLinkShaped(query)) return false;
    const letters = query.match(LETTER_OR_DIGIT)?.length ?? 0;
    return letters >= (CJK.test(query) ? 2 : 3);
};

/**
 * What the page shows: the browsable list for a blank query, results while anything is or may be
 * coming, and "none" only when nothing is yours and the lookup answered empty, is older than the hub,
 * or will not be asked. A failed lookup is `results` (its own line and Retry), never "none".
 */
export const libraryPhase = (args: {
    lookup: Lookup<unknown>;
    lookupAvailable: boolean;
    ownedCount: number;
    query: string;
}): 'browse' | 'none' | 'results' => {
    const { lookup, lookupAvailable, ownedCount, query } = args;
    if (query.trim() === '') return 'browse';
    if (ownedCount > 0) return 'results';
    switch (lookup.kind) {
        case 'done':
            return lookup.items.length > 0 ? 'results' : 'none';
        case 'failed':
        case 'looking':
            return 'results';
        case 'idle':
            return lookupAvailable && externalLookupWanted(query) ? 'results' : 'none';
        case 'older':
            return 'none';
    }
};

// Song sort keys to the table columns (TableColumn values) that show what they order by.
const SORTED_COLUMNS: Record<string, string[]> = {
    album: ['album'],
    albumArtist: ['albumArtists'],
    artist: ['artists'],
    bitRate: ['bitRate'],
    bpm: ['bpm'],
    channels: ['channels'],
    comment: ['comment'],
    duration: ['duration'],
    favorited: ['userFavorite'],
    genre: ['genres', 'genreBadge'],
    name: ['name', 'titleCombined', 'titleArtist'],
    playCount: ['playCount'],
    rating: ['userRating'],
    recentlyAdded: ['createdAt'],
    recentlyPlayed: ['lastPlayedAt'],
    releaseDate: ['releaseDate'],
    releaseYear: ['releaseYear'],
    year: ['year'],
};

/** Every table column that can carry a song sort; none for a random or unknown sort. */
export const sortedColumnsFor = (sortBy: string): string[] =>
    Object.hasOwn(SORTED_COLUMNS, sortBy) ? [...SORTED_COLUMNS[sortBy]] : [];

const MAX_QUERY = 200;

/** The Artists page's URL: `q` (cut at 200 characters) and `sort` (A to Z unless known). */
export const parseLibraryParams = (search: string): { q: string; sort: ArtistSort } => {
    const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
    const sort = params.get('sort') as ArtistSort | null;
    return {
        q: (params.get('q') ?? '').slice(0, MAX_QUERY),
        sort: sort && ARTIST_SORTS.includes(sort) ? sort : 'az',
    };
};

/** A query string without the `?`; the defaults are left out. */
export const serializeLibraryParams = (params: { q: string; sort: ArtistSort }): string => {
    const out = new URLSearchParams();
    if (params.q) out.set('q', params.q.slice(0, MAX_QUERY));
    if (params.sort !== 'az') out.set('sort', params.sort);
    return out.toString();
};
