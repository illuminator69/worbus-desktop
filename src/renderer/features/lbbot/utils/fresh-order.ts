import type { FreshSort, FreshType } from '../stores/fresh-filters.store.ts';

import {
    applyFreshScope,
    type FreshScopeValue,
    hasArtistPlays,
    scopeInEffect,
} from './fresh-scope.ts';

/**
 * B-286: the Fresh page's order, as one pure function the page and the Fresh shelf (Home,
 * Discover) both read. The shelf is the first {@link FRESH_SHELF_SIZE} rows of the page's answer
 * for the same persisted filters, so the two can never disagree about which releases are fresh.
 */

export interface FreshBucket<T> {
    /** A week ("This week"), or '' for the one unlabelled bucket of an A-Z or plays order. */
    label: string;
    releases: T[];
}

export interface FreshFilters {
    /** The stored scope: a `plays` with no plays data reads as `mine` here. */
    scope: FreshScopeValue;
    sort: FreshSort;
    type: FreshType;
}

interface FreshOrderRow {
    artist: string;
    artistOwned: boolean;
    artistPlays?: number;
    releaseDate: string;
    releaseName: string;
    type?: string;
}

/** The shelf's length: a carousel's worth, with "See all" for the rest. */
export const FRESH_SHELF_SIZE = 20;

/**
 * The scopes' words, one source for the page's chips and the shelf's reason line. The site-wide
 * scope never claims "already in your library": that half is a chart, and the two are never
 * conflated (lb-bot's rule).
 */
export const FRESH_SCOPE_WORDS: Record<FreshScopeValue, { label: string; reason: string }> = {
    all: { label: 'All', reason: 'New releases across ListenBrainz, from any artist' },
    mine: { label: 'Your artists', reason: 'New releases from artists already in your library' },
    plays: { label: 'Artists you play', reason: 'New releases from the artists you play most' },
};

/** The type filter's words, one source for the page's chips and the shelf's reason line. */
export const FRESH_TYPE_WORDS: Record<FreshType, string> = {
    album: 'Albums',
    all: 'All',
    ep: 'EPs',
    other: 'Other',
    single: 'Singles',
};

/**
 * The shelf's reason line: the scope's words, the window when it is not the default 30 days, and
 * the type when it is not all, so a shelf of EPs says why it shows no albums. The sort is not
 * named: an order needs no excuse.
 */
export const freshShelfReason = (
    scope: FreshScopeValue,
    days: number,
    type: FreshType = 'all',
): string => {
    const reason = FRESH_SCOPE_WORDS[scope].reason;
    const scoped = days === 30 ? reason : `${reason} in the last ${days} days`;
    return type === 'all' ? scoped : `${scoped} · ${FRESH_TYPE_WORDS[type]}`;
};

/**
 * Where a Fresh tile goes, the page's and the shelf's one rule: an album the library holds opens
 * the library album; otherwise a release group opens the virtual album page (and can be fetched);
 * a row with neither opens nothing and offers nothing to fetch, rather than a broken page.
 */
export type FreshTileTarget =
    | { albumId: string; kind: 'library' }
    | { kind: 'external'; rgid: string };

export const freshTileTarget = (release: {
    releaseAlbumId: string;
    releaseGroupMbid: string;
}): FreshTileTarget | null => {
    if (release.releaseAlbumId) return { albumId: release.releaseAlbumId, kind: 'library' };
    if (release.releaseGroupMbid) return { kind: 'external', rgid: release.releaseGroupMbid };
    return null;
};

/**
 * Which type bucket a row belongs in.
 *
 * **Everything unrecognised, including the very common empty `type`, lands in `other`.**
 * MusicBrainz leaves the primary type blank often enough that a bucket-per-known-type rule would
 * drop those rows out of every filter at once, which reads as the feed being empty rather than as
 * a filter doing its job.
 */
export const freshTypeBucket = (type: string | undefined): FreshType => {
    const lower = (type || '').toLowerCase();
    if (lower === 'album') return 'album';
    if (lower === 'ep') return 'ep';
    if (lower === 'single') return 'single';
    return 'other';
};

const DAY_MS = 86_400_000;

/** Week buckets, newest first. An undated row sinks to `Earlier` rather than claiming a week it
 *  has no evidence for. */
export const WEEK_BUCKETS = [
    'Upcoming',
    'This week',
    'Last week',
    '2 weeks ago',
    '3 weeks ago',
    'Earlier',
] as const;

export const weekBucketFor = (releaseDate: string, now: number): string => {
    const parsed = releaseDate ? Date.parse(releaseDate) : NaN;
    if (!Number.isFinite(parsed)) return 'Earlier';
    if (parsed > now) return 'Upcoming';
    const weeks = Math.floor((now - parsed) / (7 * DAY_MS));
    if (weeks <= 0) return 'This week';
    if (weeks === 1) return 'Last week';
    if (weeks === 2) return '2 weeks ago';
    if (weeks === 3) return '3 weeks ago';
    return 'Earlier';
};

/** The scope in effect for these rows: a stored `plays` reads as `mine` when no row has plays. */
export const freshScopeInEffect = (
    rows: readonly Pick<FreshOrderRow, 'artistPlays'>[] | undefined,
    stored: FreshScopeValue,
): FreshScopeValue => scopeInEffect(stored, hasArtistPlays(rows));

/**
 * The page's sections for these rows and filters. `now` is the wall clock "This week" is relative
 * to. A filter leaving nothing is no bucket at all.
 */
export const freshBuckets = <T extends FreshOrderRow>(
    rows: readonly T[] | undefined,
    filters: FreshFilters,
    now: number,
): FreshBucket<T>[] => {
    const scope = freshScopeInEffect(rows, filters.scope);
    const kept = applyFreshScope(rows ?? [], scope).filter(
        (release) => filters.type === 'all' || freshTypeBucket(release.type) === filters.type,
    );
    if (kept.length === 0) return [];
    if (scope === 'plays') {
        // Most played first, newest breaking ties: already ordered by the scope.
        return [{ label: '', releases: kept }];
    }
    if (filters.sort === 'artist') {
        // One unlabelled bucket: an A-Z list divided by week would be two orderings fighting.
        const sorted = [...kept].sort(
            (a, b) =>
                a.artist.localeCompare(b.artist) || a.releaseName.localeCompare(b.releaseName),
        );
        return [{ label: '', releases: sorted }];
    }
    const byBucket = new Map<string, T[]>();
    for (const release of kept) {
        const key = weekBucketFor(release.releaseDate, now);
        const list = byBucket.get(key);
        if (list) list.push(release);
        else byBucket.set(key, [release]);
    }
    for (const list of byBucket.values()) {
        list.sort(
            (a, b) =>
                (b.releaseDate || '').localeCompare(a.releaseDate || '') ||
                a.artist.localeCompare(b.artist),
        );
    }
    return WEEK_BUCKETS.flatMap((label) => {
        const releases = byBucket.get(label);
        return releases?.length ? [{ label, releases }] : [];
    });
};

/** The Fresh shelf: the page's rows in the page's order, the first `size` of them. */
export const freshShelf = <T extends FreshOrderRow>(
    rows: readonly T[] | undefined,
    filters: FreshFilters,
    now: number,
    size: number = FRESH_SHELF_SIZE,
): T[] =>
    freshBuckets(rows, filters, now)
        .flatMap((bucket) => bucket.releases)
        .slice(0, size);
