import type {
    LbBotAlbumCandidate,
    LbBotAlbumCoverSet,
    LbBotAlbumJob,
    LbBotAlbumState,
    LbBotAlbumStateQuery,
    LbBotArtistCandidate,
    LbBotBrowse,
    LbBotCover,
    LbBotDeezerGenres,
    LbBotDiscography,
    LbBotDownloadResult,
    LbBotFills,
    LbBotFillStatus,
    LbBotFreshFeed,
    LbBotGap,
    LbBotGapAction,
    LbBotGapSource,
    LbBotIndexKeys,
    LbBotIndexPage,
    LbBotIndexStart,
    LbBotListeningStatus,
    LbBotListeningSummary,
    LbBotMergeJob,
    LbBotMergePreview,
    LbBotMergeRow,
    LbBotMeta,
    LbBotOverrideList,
    LbBotOverrideRemoved,
    LbBotOverrideSet,
    LbBotPreview,
    LbBotRecent,
    LbBotReleaseDetail,
    LbBotResolvedEdition,
    LbBotResolvedLink,
    LbBotResult,
    LbBotSimilarAlbums,
    LbBotSimilarArtists,
    LbBotSourceFiles,
    LbBotStatus,
    LbBotTracklist,
    LbBotUnowned,
    LbBotWishlist,
} from '/@/shared/types/lbbot-types';

import { ipcRenderer } from 'electron';

/**
 * Renderer-facing bridge for lb-bot's library-gap intelligence. The main process
 * does the HTTP (always through the navi-connect hub) and normalizes lb-bot's
 * snake_case API into the shared shapes.
 *
 * Two contracts, and the split is deliberate. The passive reads — the probe, the
 * discography — fail soft to null so their surface hides itself. Anything the
 * user pressed answers with an `LbBotResult`, because a button that does nothing
 * and says nothing is worse than an error.
 */

const status = (): Promise<LbBotStatus> => ipcRenderer.invoke('lbbot-status');

/**
 * Worbus P1: lb-bot refused a request, whichever route it was - `downloads_off` (409) or
 * `signin_required` (401, an older hub that sends no bearer). Sent by the main client's one
 * request function; returns a disposer for THIS listener only.
 */
const onRefusal = (cb: (refusal: { code: string }) => void): (() => void) => {
    const handler = (_event: unknown, refusal: { code: string }) => cb(refusal);
    ipcRenderer.on('lbbot-refusal', handler);
    return () => ipcRenderer.removeListener('lbbot-refusal', handler);
};

const discography = (ndId: string, mbid?: string): Promise<LbBotDiscography | null> =>
    ipcRenderer.invoke('lbbot-discography', { mbid, ndId });

/** One page of lb-bot's index change feed: everything with a seq above
 *  `since`, or `resync` when `epoch` is not the server's. Result-shaped so the
 *  mirror's sync can tell the hub's 503 "busy" from a failure. */
const indexChanges = (since: number, epoch: string): Promise<LbBotResult<LbBotIndexPage>> =>
    ipcRenderer.invoke('lbbot-index-changes', { epoch, since });

/** Every indexed artist's `{key, seq}` — the drift check's reference list. */
const indexKeys = (): Promise<LbBotResult<LbBotIndexKeys>> =>
    ipcRenderer.invoke('lbbot-index-keys');

/** Null when the request failed. A blank `taskId` with `covered` means lb-bot
 *  started nothing because another library artist holds this discography. Worbus P1:
 *  no `mbid` scans by the Navidrome id alone ("Scan now"); `olderLbBot` is an lb-bot
 *  that refused that. */
const indexArtist = (
    ndId: string,
    mbid: string | undefined,
    name: string,
): Promise<LbBotIndexStart | null> =>
    ipcRenderer.invoke('lbbot-index-artist', { mbid, name, ndId });

/** Add or refresh one release-group in an artist's index — the cheap alternative
 *  to a full rescan for a release the stored discography predates. */
const indexRelease = (args: {
    artist?: string;
    external?: boolean;
    mbid?: string;
    name?: string;
    ndId?: string;
    rgid: string;
    title?: string;
    type?: string;
    year?: string;
}): Promise<LbBotResult<boolean>> => ipcRenderer.invoke('lbbot-index-release', args);

/** Every artist MBID override (I-019). Result-shaped: a failed read must not
 *  look like an empty map. */
const overrides = (): Promise<LbBotResult<LbBotOverrideList>> =>
    ipcRenderer.invoke('lbbot-overrides');

/** Choose the MusicBrainz artist for a library artist. `status` + `code` tell
 *  a 404 `unknown_mbid`, a 409 `busy` and a retryable 502 apart. */
const overrideSet = (
    ndId: string,
    mbid: string,
    name: string,
): Promise<LbBotResult<LbBotOverrideSet>> =>
    ipcRenderer.invoke('lbbot-override-set', { mbid, name, ndId });

const overrideRemove = (ndId: string): Promise<LbBotResult<LbBotOverrideRemoved>> =>
    ipcRenderer.invoke('lbbot-override-remove', { ndId });

/** Album override (I-022), "Fix album match". All result-shaped: `status` + `code`
 *  (+ `matched` / `total` on a 409 `poor_match`, a `total` alone on `files_unreachable`,
 *  `retryable` on a 502) tell the answers apart, and a code-less 404 / a 405 means
 *  lb-bot is older. Other coded refusals are lb-bot's own sentence. */
const albumOverride = (query: LbBotAlbumStateQuery): Promise<LbBotResult<LbBotAlbumState>> =>
    ipcRenderer.invoke('lbbot-album-override-get', query);

const albumCovers = (args: {
    releaseMbid?: string;
    rgid?: string;
}): Promise<LbBotResult<LbBotCover[]>> => ipcRenderer.invoke('lbbot-album-covers', args);

const albumPreview = (albumId: string, releaseMbid: string): Promise<LbBotResult<LbBotPreview>> =>
    ipcRenderer.invoke('lbbot-album-preview', { albumId, releaseMbid });

const albumOverrideApply = (args: {
    albumId: string;
    coverUrl?: string;
    force?: boolean;
    releaseMbid: string;
}): Promise<LbBotResult<LbBotAlbumJob>> => ipcRenderer.invoke('lbbot-album-override-apply', args);

const albumCoverSet = (
    albumId: string,
    coverUrl: string,
): Promise<LbBotResult<LbBotAlbumCoverSet>> =>
    ipcRenderer.invoke('lbbot-album-cover-set', { albumId, coverUrl });

const albumOverrideRemove = (id: string): Promise<LbBotResult<LbBotAlbumJob>> =>
    ipcRenderer.invoke('lbbot-album-override-remove', { id });

/** Artist name merge (I-023). Result-shaped like the album routes: `code`
 *  (`different_artists`, `collaboration`, `files_unreachable`, `unknown_artist`,
 *  `busy`, `in_progress`, `no_merge`) and `retryable` tell the answers apart; a
 *  code-less 404 / a 405 means older. A plan is ONE object, `ndId` the kept artist
 *  and `fromNdId` the rewritten spelling, so the two cannot be swapped unseen. */
const mergePreview = (plan: {
    fromNdId: string;
    ndId: string;
}): Promise<LbBotResult<LbBotMergePreview>> => ipcRenderer.invoke('lbbot-merge-preview', plan);

const mergeStart = (plan: {
    fromNdId: string;
    ndId: string;
}): Promise<LbBotResult<LbBotMergeJob>> => ipcRenderer.invoke('lbbot-merge-start', plan);

const mergeGet = (id: string): Promise<LbBotResult<LbBotMergeRow>> =>
    ipcRenderer.invoke('lbbot-merge-get', { id });

const mergeUndo = (id: string): Promise<LbBotResult<LbBotMergeJob>> =>
    ipcRenderer.invoke('lbbot-merge-undo', { id });

/** Listening history (I-006). All result-shaped: a failed read must keep the
 *  cached body, and a 404 means lb-bot is older than the hub. */
const listeningStatus = (): Promise<LbBotResult<LbBotListeningStatus>> =>
    ipcRenderer.invoke('lbbot-listening-status');

const listeningSummary = (
    period: string,
    tz: string,
): Promise<LbBotResult<LbBotListeningSummary>> =>
    ipcRenderer.invoke('lbbot-listening-summary', { period, tz });

const listeningUnowned = (
    period: string,
    kind: string,
    limit: number,
): Promise<LbBotResult<LbBotUnowned>> =>
    ipcRenderer.invoke('lbbot-listening-unowned', { kind, limit, period });

const listeningRecent = (limit: number, before?: number): Promise<LbBotResult<LbBotRecent>> =>
    ipcRenderer.invoke('lbbot-listening-recent', { before, limit });

const listeningSync = (): Promise<LbBotResult<boolean>> =>
    ipcRenderer.invoke('lbbot-listening-sync');

/** Site-wide fresh releases. Fail-soft: null when ListenBrainz or lb-bot is down. */
const freshReleases = (days: number): Promise<LbBotFreshFeed | null> =>
    ipcRenderer.invoke('lbbot-fresh-releases', { days });

const albumReleases = (rgid: string): Promise<LbBotReleaseDetail | null> =>
    ipcRenderer.invoke('lbbot-album-releases', { rgid });

const albumTracklist = (releaseMbid: string, albumIds?: string[]): Promise<LbBotTracklist | null> =>
    ipcRenderer.invoke('lbbot-album-tracklist', { albumIds, releaseMbid });

/** Ranked Soulseek folders for one release-group. Slow (a live slskd fan-out). */
/** `edition` is the release the caller already resolved, so lb-bot can skip
 *  re-asking MusicBrainz — see the main-process handler. */
/** `refresh`: Search again after a refusal, so lb-bot searches afresh (R12, review F4). */
const albumSources = (
    rgid: string,
    edition?: LbBotResolvedEdition,
    options: { refresh?: boolean } = {},
): Promise<LbBotResult<LbBotGapSource[]>> =>
    ipcRenderer.invoke('lbbot-album-sources', {
        album: edition?.title,
        artist: edition?.artist,
        refresh: options.refresh === true,
        releaseMbid: edition?.releaseMbid,
        rgid,
        total: edition?.totalTracks,
    });

const downloadAlbum = (
    rgid: string,
    quality?: string,
    source?: { folder: string; peer: string },
    edition?: LbBotResolvedEdition,
    excludeUsers?: string[],
    allowMp3?: boolean,
    /** B-084: ask the picked folder for every audio file (needs `source`). */
    allFiles?: boolean,
): Promise<LbBotDownloadResult> =>
    ipcRenderer.invoke('lbbot-download-album', {
        allFiles,
        allowMp3,
        artist: edition?.artist,
        excludeUsers,
        quality,
        releaseMbid: edition?.releaseMbid,
        rgid,
        sourceFolder: source?.folder,
        sourceUsername: source?.peer,
        title: edition?.title,
        totalTracks: edition?.totalTracks,
    });

const albumStatus = (releaseMbid?: string, rgid?: string): Promise<LbBotResult<LbBotFillStatus>> =>
    ipcRenderer.invoke('lbbot-album-status', { releaseMbid, rgid });

/** Every watched fill in one read — the ledger's poll. */
const fills = (releaseMbids: string[], groupIds: string[]): Promise<LbBotResult<LbBotFills>> =>
    ipcRenderer.invoke('lbbot-fills', { groupIds, releaseMbids });

const cancelAlbum = (
    releaseMbid: string,
): Promise<{ cancelled: boolean; code?: string; ok: boolean; status: LbBotFillStatus }> =>
    ipcRenderer.invoke('lbbot-cancel-album', { releaseMbid });

const allowMp3 = (groupId: string, allow = true): Promise<boolean> =>
    ipcRenderer.invoke('lbbot-allow-mp3', { allow, groupId });

const gap = (groupId: string): Promise<LbBotResult<LbBotGap>> =>
    ipcRenderer.invoke('lbbot-gap', { groupId });

const gapSourceFiles = (
    groupId: string,
    sourceIndex: number,
): Promise<LbBotResult<LbBotSourceFiles>> =>
    ipcRenderer.invoke('lbbot-gap-source-files', { groupId, sourceIndex });

const gapSearch = (groupId: string, force = false): Promise<LbBotGapAction> =>
    ipcRenderer.invoke('lbbot-gap-search', { force, groupId });

const gapAuto = (groupId: string): Promise<LbBotGapAction> =>
    ipcRenderer.invoke('lbbot-gap-auto', { groupId });

const gapFetch = (groupId: string, sourceId: number): Promise<LbBotGapAction> =>
    ipcRenderer.invoke('lbbot-gap-fetch', { groupId, sourceId });

const gapCancel = (groupId: string): Promise<LbBotGapAction> =>
    ipcRenderer.invoke('lbbot-gap-cancel', { groupId });

const gapRescan = (groupId: string): Promise<LbBotResult<boolean>> =>
    ipcRenderer.invoke('lbbot-gap-rescan', { groupId });

/** MusicBrainz artist search — the "Not in your library" half of search.
 *  Empty array when we could not ask; the section then does not render. */
const artistLookup = (q: string): Promise<LbBotArtistCandidate[]> =>
    ipcRenderer.invoke('lbbot-artist-lookup', { q });

/** The picker's artist search, result-shaped: an error is not "no artists found". */
const artistSearch = (q: string): Promise<LbBotResult<LbBotArtistCandidate[]>> =>
    ipcRenderer.invoke('lbbot-artist-search', { q });

/** MusicBrainz album search, with each hit marked owned or not. Same empty-array
 *  contract as `artistLookup`. */
/** The same lookup, result-shaped: a failure is not an empty answer. */
const albumLookupChecked = (q: string): Promise<LbBotResult<LbBotAlbumCandidate[]>> =>
    ipcRenderer.invoke('lbbot-album-lookup-checked', { q });

const albumLookup = (q: string): Promise<LbBotAlbumCandidate[]> =>
    ipcRenderer.invoke('lbbot-album-lookup', { q });

/** "Similar albums" — one album per similar artist, all from your own library,
 *  each row naming the artist that justifies it. Null when we could not ask. */
const albumSimilar = (args: {
    artistMbid?: string;
    artistName?: string;
    limit?: number;
    rgid?: string;
}): Promise<LbBotSimilarAlbums | null> => ipcRenderer.invoke('lbbot-album-similar', args);

/** "Fans also like" — similar artists, owned and unowned alike. Unlike
 *  `albumSimilar` this one is a shopping list: every row carries `owned` and
 *  `indexed` rather than being filtered out. Prefer `mbid`.
 *  Null when we could not ask. */
const artistSimilar = (args: {
    limit?: number;
    mbid?: string;
    name?: string;
}): Promise<LbBotSimilarArtists | null> => ipcRenderer.invoke('lbbot-artist-similar', args);

/** Editorial "About" for an artist — full Wikipedia text with its CC BY-SA
 *  attribution, the Wikidata one-liner, members/side-projects and links.
 *  Prefer `mbid`; `name` costs lb-bot an extra MusicBrainz search.
 *  Null means we could not ask, which hides the section. */
const metaArtist = (args: { mbid?: string; name?: string }): Promise<LbBotMeta | null> =>
    ipcRenderer.invoke('lbbot-meta-artist', args);

/** The same for a release-group, plus release credits. */
const metaAlbum = (args: { releaseMbid?: string; rgid: string }): Promise<LbBotMeta | null> =>
    ipcRenderer.invoke('lbbot-meta-album', args);

/** "Refresh About" (I-020): the meta read with the caches bypassed, result-shaped
 *  so a failure can be worded truthfully. */
const metaRefresh = (args: {
    kind: 'album' | 'artist';
    mbid?: string;
    name?: string;
    releaseMbid?: string;
    rgid?: string;
}): Promise<LbBotResult<LbBotMeta>> => ipcRenderer.invoke('lbbot-meta-refresh', args);

/** Post a system notification for a fill that landed while Worbus for desktop was in the
 *  background. The main process suppresses it when the window is focused — the
 *  renderer's toast has that case covered. */
const notify = (title: string, body: string): Promise<void> =>
    ipcRenderer.invoke('lbbot-notify', { body, title });

/** Deezer's own charts, ownership-marked. A browse feed, not a recommendation:
 *  it names no reason beyond "this is what is popular", which is why the row
 *  that renders it says exactly that. Null when we could not ask. */
const deezerChart = (limit?: number, genre?: string): Promise<LbBotBrowse | null> =>
    ipcRenderer.invoke('lbbot-deezer-chart', { genre, limit });

/** Deezer's editorial selections — the same shape, a different question. */
const deezerEditorial = (limit?: number, genre?: string): Promise<LbBotBrowse | null> =>
    ipcRenderer.invoke('lbbot-deezer-editorial', { genre, limit });

/** The genres the two feeds above can be narrowed to. Genre is the ONLY axis
 *  that exists — Deezer's API has no country parameter, so the chart is
 *  geolocated by lb-bot's own address and no client can ask for another. */
const deezerGenres = (): Promise<LbBotDeezerGenres | null> =>
    ipcRenderer.invoke('lbbot-deezer-genres');

/** Deezer as a third similarity source. Same answer shape as `artistSimilar`
 *  on purpose — it marks ownership identically, so the two rows share one
 *  renderer and cannot drift apart. */
const artistRelated = (args: {
    limit?: number;
    mbid?: string;
    name?: string;
}): Promise<LbBotSimilarArtists | null> => ipcRenderer.invoke('lbbot-artist-related', args);

/** A pasted streaming URL → MusicBrainz ids. Result-shaped rather than
 *  fail-soft: the user pasted something and is waiting for a verdict. */
const resolveLink = (url: string): Promise<LbBotResult<LbBotResolvedLink>> =>
    ipcRenderer.invoke('lbbot-resolve-link', { url });

/** Albums nobody was sharing, kept for a slow periodic re-search — with the
 *  sweep's own timings, which are the only honest answer to "when?". */
const wishlist = (): Promise<LbBotWishlist> => ipcRenderer.invoke('lbbot-wishlist');

const wishlistAdd = (args: {
    artist: string;
    rgid: string;
    title: string;
}): Promise<LbBotResult<boolean>> => ipcRenderer.invoke('lbbot-wishlist-add', args);

const wishlistRemove = (rgid: string): Promise<LbBotResult<boolean>> =>
    ipcRenderer.invoke('lbbot-wishlist-remove', { rgid });

/** Worbus P4: `/lb/attention`'s `counts` (numbers only), or null when lb-bot did not answer. */
const attentionCounts = (): Promise<null | Record<string, number>> =>
    ipcRenderer.invoke('lbbot-attention-counts');

export const lbBot = {
    albumCovers,
    albumCoverSet,
    albumLookup,
    albumLookupChecked,
    albumOverride,
    albumOverrideApply,
    albumOverrideRemove,
    albumPreview,
    albumReleases,
    albumSimilar,
    albumSources,
    albumStatus,
    albumTracklist,
    allowMp3,
    artistLookup,
    artistRelated,
    artistSearch,
    artistSimilar,
    attentionCounts,
    cancelAlbum,
    deezerChart,
    deezerEditorial,
    deezerGenres,
    discography,
    downloadAlbum,
    fills,
    freshReleases,
    gap,
    gapAuto,
    gapCancel,
    gapFetch,
    gapRescan,
    gapSearch,
    gapSourceFiles,
    indexArtist,
    indexChanges,
    indexKeys,
    indexRelease,
    listeningRecent,
    listeningStatus,
    listeningSummary,
    listeningSync,
    listeningUnowned,
    mergeGet,
    mergePreview,
    mergeStart,
    mergeUndo,
    metaAlbum,
    metaArtist,
    metaRefresh,
    notify,
    onRefusal,
    overrideRemove,
    overrides,
    overrideSet,
    resolveLink,
    status,
    wishlist,
    wishlistAdd,
    wishlistRemove,
};
