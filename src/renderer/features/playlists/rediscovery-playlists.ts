/**
 * The rediscovery set: four server-side smart playlists that surface music
 * already in the library and rarely or never played.
 *
 * Nothing in this stack does that today — there is no never-played shelf, no
 * deep cuts, no stale favourites, and every "discovery" surface points outward
 * at records you do not own.
 *
 * **Server-side on purpose.** These are Navidrome native smart playlists
 * (`POST /api/playlist` with `rules` criteria), so Navidrome keeps them current
 * by itself and *every* Subsonic client sees them — this one, Worbus for Android, and
 * anything else pointed at the same server. No polling, no client-side
 * computation, no second source of truth.
 *
 * Opt-in and created once. Minting playlists in someone's library on first
 * launch would be a surprising thing for a music player to do, and creation is
 * keyed on the name, so running it twice is a no-op rather than a duplicate.
 *
 * The rule JSON is Navidrome's own criteria grammar, written literally rather
 * than through the query builder: these are fixed definitions, and going via
 * `convertQueryGroupToNDQuery` would mean expressing them as query-builder
 * state first — a translation in the wrong direction.
 */

export interface RediscoveryPlaylistDefinition {
    comment: string;
    name: string;
    rules: Record<string, unknown>;
}

/** Prefix on every playlist this creates, so a shelf can filter on it and the
 *  user can see at a glance which playlists came from here. */
export const REDISCOVERY_PREFIX = 'Rediscover: ';

export const REDISCOVERY_PLAYLISTS: RediscoveryPlaylistDefinition[] = [
    {
        comment: 'In the library for months and never once played',
        name: `${REDISCOVERY_PREFIX}Never played`,
        rules: {
            // The 90-day floor is the deliberate part: without it this fills
            // with everything imported this morning, which is not rediscovery —
            // it is Recently Added with extra steps.
            all: [{ is: { playCount: 0 } }, { notInTheLast: { dateAdded: 90 } }],
            limit: 500,
            order: 'asc',
            sort: 'random',
        },
    },
    {
        comment: "Favourites you haven't played in a year",
        name: `${REDISCOVERY_PREFIX}Loved but stale`,
        rules: {
            all: [{ is: { loved: true } }, { notInTheLast: { lastPlayed: 365 } }],
            limit: 500,
            order: 'asc',
            sort: 'lastPlayed',
        },
    },
    {
        comment: 'Rated 4 or 5, untouched for a year',
        name: `${REDISCOVERY_PREFIX}Highly rated, long unplayed`,
        rules: {
            all: [{ gt: { rating: 3 } }, { notInTheLast: { lastPlayed: 365 } }],
            limit: 500,
            order: 'desc',
            sort: 'rating',
        },
    },
    {
        // A true deep cut is a zero-play track on an album you *otherwise*
        // play, which needs a per-album join Navidrome's rule grammar cannot
        // state. This is the honest approximation: unplayed tracks from records
        // you thought enough of to rate.
        comment: 'Unplayed tracks from records you thought enough of to rate',
        name: `${REDISCOVERY_PREFIX}Deep cuts`,
        rules: {
            all: [
                { is: { playCount: 0 } },
                { gt: { rating: 0 } },
                { notInTheLast: { dateAdded: 30 } },
            ],
            limit: 300,
            order: 'asc',
            sort: 'random',
        },
    },
];

/** The definitions the server does not already have, matched by name. Keeping
 *  creation idempotent means running this twice leaves one copy of each. */
export const missingRediscoveryPlaylists = (
    existingNames: Iterable<string>,
): RediscoveryPlaylistDefinition[] => {
    const existing = new Set(existingNames);
    return REDISCOVERY_PLAYLISTS.filter((definition) => !existing.has(definition.name));
};
