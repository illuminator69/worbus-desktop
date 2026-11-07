/**
 * navi-connect F7 (Task 7): which stage an album request is at, from the fill ledger's row and the
 * index. Never inferred from the page: "Placed" is not "In your library" until Navidrome has the album.
 */

export type RequestStage =
    | 'active'
    | 'cancelled'
    | 'failed'
    | 'gaveUp'
    | 'inLibrary'
    | 'needsMatch'
    | 'needsPick'
    | 'none'
    | 'syncing';

export const requestStage = (input: {
    /** The index row for this release-group names a Navidrome album. */
    indexRowOwned: boolean;
    ownedAlbumId: null | string;
    row: null | { outcome: string; settled: boolean; state: string; verifyGaveUp?: boolean };
}): RequestStage => {
    if (input.indexRowOwned && input.ownedAlbumId) return 'inLibrary';
    const { row } = input;
    if (!row) return 'none';
    if (!row.settled) return row.state === 'placed' ? 'syncing' : 'active';
    switch (row.outcome) {
        case 'cancelled':
            return 'cancelled';
        case 'done':
            return row.verifyGaveUp ? 'syncing' : 'inLibrary';
        case 'failed':
            return row.state === 'needs_match' ? 'needsMatch' : 'failed';
        case 'gaveUp':
            return 'gaveUp';
        case 'needsPick':
            return 'needsPick';
        default:
            return 'active';
    }
};

/** What the missing album's one box shows (R11, B-222): the fill, the sources, or nothing yet. */
export type AlbumBoxView = 'fill' | 'none' | 'sources';

/**
 * One box under the hero: Find sources turns it into the search, then the cards, and a request
 * turns the same box into the steps. A fill in flight is the truth whatever else is set (it may
 * have been started on another client); a request on its way keeps the cards it was made from; a
 * finished fill stays on show until the user asks for sources again after it ended.
 */
export const albumBoxView = (input: {
    /** When the ledger row settled (0 when it has not, or no row). */
    fillFinishedAt: number;
    /** When the shown source search was asked for (0 when none). */
    searchStartedAt: number;
    searchState: 'empty' | 'failed' | 'idle' | 'ready' | 'waiting';
    stage: RequestStage;
    /** A Download press whose answer has not come back. */
    starting: boolean;
}): AlbumBoxView => {
    const { stage } = input;
    if (stage === 'active' || stage === 'syncing' || stage === 'inLibrary') return 'fill';
    if (input.starting) return 'sources';
    const asked = input.searchState !== 'idle';
    if (stage === 'none') return asked ? 'sources' : 'none';
    return asked && input.searchStartedAt > input.fillFinishedAt ? 'sources' : 'fill';
};
