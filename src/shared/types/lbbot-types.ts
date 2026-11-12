import type { LbFindItLink } from '/@/shared/utils/find-it';
import type { LbDownloads } from '/@/shared/utils/lbbot-mode';

/**
 * lb-bot wire shapes, shared by the main-process client, the preload bridge and
 * the renderer. lb-bot speaks snake_case; the main process normalizes to these
 * once so nothing downstream has to know that.
 *
 * See ../../../../DESIGN-lbbot-client-integration.md.
 */

/**
 * The newest discography scan lb-bot ran for an artist. Without it a scan that
 * MusicBrainz failed looked exactly like one that found nothing.
 */
export interface LbBotArtistScan {
    /** Worbus P1: release groups read so far, out of `total`. 0 with `total` 0 when lb-bot
     *  sends no counts (an older lb-bot, or a scan that has not listed the discography yet). */
    done: number;
    /** lb-bot's own sentence, shown verbatim. Empty unless `failed`. */
    error: string;
    /** Epoch seconds; 0 while running. */
    finishedAt: number;
    startedAt: number;
    state: 'done' | 'failed' | 'running';
    /** The scan task this record belongs to — what the rescan that started it matches on.
     *  `auto-index` is lb-bot's background worker (Worbus P1), which has no task row. */
    taskId: string;
    /** See `done`. */
    total: number;
}

export interface LbBotDiscography {
    artistName: string;
    indexed: boolean;
    releases: LbBotRelease[];
    /** The last scan lb-bot ran for this artist since it started; null if none. */
    scan: LbBotArtistScan | null;
    /** Epoch seconds of the scan that built this index. Upstream: `scanned_at`. */
    scannedAt: number;
    /** Index older than lb-bot's TTL, or built by an older scan version. */
    stale: boolean;
    /** Worbus P1: indexed, but lb-bot found no MusicBrainz artist for it. Absent when not
     *  indexed and from an older lb-bot; absent means false. */
    unresolved?: boolean;
}

export interface LbBotDownloadResult {
    /** B-084: what lb-bot understood of `allFiles` - the echo on every 200 (for an
     *  `existing` fill, what THAT fill was started with). Undefined when the answer
     *  carries none (an older hub or lb-bot): a client that asked for all files and
     *  reads this as not-true must not claim "all files". */
    allFiles?: boolean;
    /** lb-bot's machine-readable reason for a refusal, when its body carried one. */
    code?: string;
    /** Empty when ok. lb-bot's own sentence where it wrote one — it writes them
     *  for humans, so it is shown verbatim rather than paraphrased. */
    error: string;
    /** A fill for this release was already in flight; the second tap is a no-op. */
    existing: boolean;
    ok: boolean;
    releaseMbid: string;
    /** HTTP status, or 0 when the request never left this process. */
    status: number;
}

/**
 * A gap action's answer (`/lb/gap/search|auto|fetch|cancel`). B-233: what the ledger's gap watch
 * starts from. `gap`: the group as lb-bot holds it right after the action (fetch and cancel read it
 * under its lock after the enqueue or cancel; an `auto` for a fill already running answers it too).
 * `taskId`: the source task a search or an auto started, which `/lb/gap`'s `sourceTask.id` names
 * from the moment the POST returns.
 */
export type LbBotGapAction = LbBotResult<boolean> & {
    gap?: LbBotGap;
    /** Fix round 7: the card id of the source a fetch was queued from (lb-bot's `sourceIndex`). */
    queuedSourceId?: number;
    taskId?: string;
};

/**
 * One artist of lb-bot's library index as the change feed ships it — the whole
 * artist, every row, because a client only ever replaces an artist wholesale
 * (PLAN-lbbot-index-mirror-2026-09-23 §1: "artist-level replace"). `rows` are
 * the discography route's own wire rows, normalized once by the main process
 * into the same `LbBotRelease` the network discography read produces, and kept
 * in lb-bot's `year, title` order.
 *
 * `scannedAt`/`scanVersion` are shipped raw on purpose: `stale` is computed by
 * the client against the envelope's `scanVersion`/`ttlDays`, so it cannot
 * drift while nothing writes.
 */
export interface LbBotIndexArtist {
    /** lb-bot's `artist_key`: the artist MBID, or `nd:<navidrome id>` for an
     *  artist it has no MBID for. The mirror's primary key. */
    key: string;
    /** Empty for an artist lb-bot knows only by its Navidrome id. */
    mbid: string;
    name: string;
    /** Empty for an external (`mb:`-only) artist the library does not hold. */
    ndArtistId: string;
    rows: LbBotRelease[];
    /** Epoch seconds. 0 on a stub that was never scanned. */
    scannedAt: number;
    scanVersion: number;
    /** The index sequence value that last touched this artist. */
    seq: number;
}

/** The part of a change-feed answer that describes the index as a whole. */
export interface LbBotIndexEnvelope {
    epoch: string;
    headSeq: number;
    /** lb-bot's `INDEX_SCAN_VERSION`: an artist scanned by any other version is stale. */
    scanVersion: number;
    /** lb-bot's `LB_BOT_INDEX_TTL_DAYS`. */
    ttlDays: number;
}

export type LbBotIndexItem =
    | (LbBotIndexArtist & { type: 'artist' })
    | (LbBotIndexTombstone & { type: 'tombstone' });

/** `GET /lb/index/keys` — every artist's `{key, seq}`, for the drift check. */
export interface LbBotIndexKeys {
    epoch: string;
    headSeq: number;
    keys: { key: string; seq: number }[];
}

/**
 * `GET /lb/index/changes?since&epoch` (contract §1a).
 *
 * `resync: true` carries the envelope and nothing else: the client's epoch is
 * not the server's, or its cursor is past the server's head. It means "drop
 * everything and pull again from 0" — the only answer that ever wipes a mirror.
 */
export type LbBotIndexPage =
    | (LbBotIndexEnvelope & {
          artistCount: number;
          items: LbBotIndexItem[];
          more: boolean;
          nextSince: number;
          resync: false;
          seqSum: number;
      })
    | (LbBotIndexEnvelope & { resync: true });

/** An artist key lb-bot deleted — only ever an `nd:` key superseded by its MBID. */
export interface LbBotIndexTombstone {
    key: string;
    seq: number;
}

/**
 * Which copy of an album to prefer when several are on offer.
 *
 * Mirrors lb-bot's `QUALITY_PREFERENCES`. Held here rather than fetched because
 * lb-bot's only reader of the list is its prefs endpoint, which is a *write*
 * surface the hub deliberately does not whitelist — and the set has to change on
 * lb-bot's side before it could mean anything here anyway. An unknown value is
 * rejected upstream with a 400, so drift fails loudly rather than silently
 * fetching the wrong thing.
 */
export type LbBotQuality = 'flac-16-44' | 'flac-any' | 'highest-bitrate' | 'prefer-opus';

/**
 * Every write, and every read a user is waiting on, answers with this.
 *
 * The old contract was `null` on any failure, which is right for the availability
 * probe and the discography read — those hide their surface — and wrong for a
 * button: pressing it and getting nothing back, no message and no log, is
 * indistinguishable from the app being broken. It cost a full round of feedback
 * on the Worbus for Android side, where the real cause was a hub that hadn't been restarted
 * and was 404ing every new route.
 */
export interface LbBotResult<T> {
    /** lb-bot's own machine-readable reason (`unknown_mbid`, `no_override`,
     *  `busy`), when a failure body carried one. Absent on a hub-minted failure. */
    code?: string;
    data: null | T;
    /** Empty when `ok`. lb-bot's own `error` sentence when it wrote one, else a
     *  translated transport failure — see `describeFailure` in the main client. */
    error: string;
    /** `poor_match` (album override, 409): how many of the album's files have a slot
     *  on the chosen release, out of how many. Absent on every other failure
     *  (`files_unreachable` carries a `total` but no `matched`; it is not a poor match). */
    matched?: number;
    ok: boolean;
    /** lb-bot said the same request may succeed later (`retryable: true` on its
     *  502 for a MusicBrainz outage). Absent otherwise. */
    retryable?: boolean;
    /** HTTP status, or 0 when the request never left this process. */
    status: number;
    /** A 502 the hub minted itself, not lb-bot's: one item in the answer was
     *  over `PROXY_MAX_RESPONSE`. `describeFailure` folds it into the same
     *  "busy or unreachable" sentence as an ordinary 502, which is right for a
     *  one-shot button — retrying makes sense there — and wrong for a caller
     *  that retries on a timer, where this is deterministic and retrying it
     *  forever never helps (B-013). False/absent on every other failure. */
    tooLarge?: boolean;
    /** The other half of `matched` on a `poor_match`; `files_unreachable` carries it too. */
    total?: number;
    /** Worbus P1: the failure body's own `error`, verbatim, for a decision that reads lb-bot's
     *  exact words (`isOlderScanRefusal`) rather than `error`, which is the sentence to show.
     *  Absent when the body carried none. */
    upstreamError?: string;
}

/** What the hub says it can proxy. An empty list means an older hub that doesn't
 *  advertise — assume supported rather than hiding working features. */
export interface LbBotStatus {
    available: boolean;
    /** Worbus P1: whether lb-bot can download (`SLSKD_API_KEY` set). Absent from an older hub
     *  or lb-bot, which means on (`lbbot-mode.ts`). */
    downloads?: LbDownloads;
    routes: string[];
    /** lb-bot's own web UI, for sending the user to its workspace — "" when the
     *  hub doesn't say (an older hub, or the proxy is off). Only ever http(s). */
    webUrl: string;
}

export const LB_BOT_QUALITY_OPTIONS: { label: string; value: LbBotQuality }[] = [
    { label: 'Best FLAC available', value: 'flac-any' },
    { label: 'CD quality (16-bit/44.1kHz)', value: 'flac-16-44' },
    { label: 'Highest bitrate', value: 'highest-bitrate' },
    { label: 'Prefer Opus', value: 'prefer-opus' },
];

/**
 * One MusicBrainz album search hit — the other half of reaching outside the
 * library.
 *
 * Unlike {@link LbBotArtistCandidate} this one answers whether the library
 * already holds the record, and that is the whole reason it is safe to render
 * in a search box. `releaseOwned` is marked by release-group id, which is
 * exact, so an owned row is shown as a library row and opens
 * `releaseAlbumId` — never the download page. Rendering these unmarked is the
 * "the tile said the library holds it and the tap opened the download page"
 * bug that the Fresh tab and the similar-albums shelf have each paid for.
 *
 * `releaseAlbumId` can be empty on an owned row: lb-bot flips its index row to
 * `present` at placement and cannot know the Navidrome ids until the backfill
 * resolves them. Owned with nowhere to send the tap is a real state.
 *
 * `primaryType` is lb-bot's snake_case `primary_type`, renamed at this boundary
 * like every other field — the wire shape is not the renderer's problem.
 */
export interface LbBotAlbumCandidate {
    artist: string;
    coverUrl: string;
    primaryType: string;
    releaseAlbumId: string;
    releaseOwned: boolean;
    rgid: string;
    score: number;
    title: string;
    year: string;
}

// Album override (I-022) types - LbBotAlbum* (from here), LbBotCover and
// LbBotPreview* (further down): camelCase as lb-bot answers; nothing here is a
// path. The lint keeps interfaces alphabetical, so they sit with their neighbours.

/** The answer to a cover-only change (synchronous). */
export interface LbBotAlbumCoverSet {
    id: string;
}

/** A file lb-bot could not write, by title, with why. */
export interface LbBotAlbumFailure {
    reason: string;
    title: string;
}

/** The answer to an apply or a remove: lb-bot works on in the background. */
export interface LbBotAlbumJob {
    id: string;
    state: string;
}

/** The override row for an album: "lb-bot rewrote this album's tags to release R at T". */
export interface LbBotAlbumOverrideRow {
    album: string;
    /** The album's CURRENT Navidrome id; "" while Navidrome has not indexed it. */
    albumId: string;
    artist: string;
    coverUrl: string;
    done: number;
    failures: LbBotAlbumFailure[];
    id: string;
    prevReleaseMbid: string;
    releaseMbid: string;
    rgid: string;
    /** Epoch seconds. */
    setAt: number;
    /** A state the client does not know is kept as lb-bot sent it. */
    state: LbBotAlbumOverrideStateName | string;
    total: number;
}

export type LbBotAlbumOverrideStateName = 'applied' | 'applying' | 'failed' | 'removing';

/** `GET /lb/album/override`. */
export interface LbBotAlbumState {
    album: string;
    albumId: string;
    artist: string;
    override: LbBotAlbumOverrideRow | null;
    releaseMbid: string;
    /** "" when lb-bot cannot tell. */
    rgid: string;
    tracks: LbBotAlbumTrackTag[];
}

/** Which of the two ids `GET /lb/album/override` is asked by. */
export type LbBotAlbumStateQuery =
    | { albumId: string; id?: undefined }
    | { albumId?: undefined; id: string };

/** One file of the album as tagged now. */
export interface LbBotAlbumTrackTag {
    disc: number;
    duration: number;
    title: string;
    track: number;
}

/**
 * One row of the "Similar albums" shelf: a record from *your own library*, by an
 * artist ListenBrainz (cross-checked with Last.fm) puts near the one on screen.
 *
 * `because` is the attribution and it is not decorative — the shelf is "more of
 * what you already have, and here is why", never a free-floating popularity
 * claim. Render it.
 *
 * Only `rgid` identifies the album: lb-bot picks it out of its discography
 * index, which is keyed by release-group, so routing goes through the external
 * album page and lets it redirect to the library album.
 */
/**
 * One MusicBrainz artist search hit — an artist that may or may not be in the
 * library, which is the point: without this a client could only reach an
 * external artist page if it already held an MBID from a Fresh row.
 *
 * `disambiguation` is MusicBrainz's own "(UK band)" note and is the only thing
 * that tells two identically-named artists apart. Show it.
 */
export interface LbBotArtistCandidate {
    country: string;
    disambiguation: string;
    mbid: string;
    name: string;
    score: number;
    type: string;
}

export interface LbBotBrowse {
    albums: LbBotBrowseAlbum[];
    artists: LbBotBrowseArtist[];
}

/**
 * One row of a Deezer browse feed — a chart or an editorial selection.
 *
 * Deezer has no MusicBrainz ids, so lb-bot resolves each row **by name**, and
 * that is exactly the case where ownership marking has to be conservative: an
 * unresolved row is `owned: false` with no id, never a guess. A wrong "in your
 * library" badge sends the user to an album page that does not exist; a wrong
 * "not in your library" one costs a duplicate download.
 *
 * The two halves reuse the vocabulary the rest of the lb-bot surface already
 * speaks (`_similar_artists_marked` for artists, `_album_lookup_marked` for
 * releases) rather than inventing a third set of field names.
 */
export interface LbBotBrowseAlbum {
    artist: string;
    /** Cover Art Archive URL, or Deezer's own — the row carries whichever lb-bot
     *  could name, because a release with no MBID has no Archive entry. */
    coverUrl: string;
    /** Navidrome album id, when the library holds this release-group. */
    releaseAlbumId: string;
    releaseOwned: boolean;
    /** MusicBrainz release-group id, empty when the name did not resolve. An
     *  empty rgid means the row cannot be acquired and cannot be opened — it is
     *  rendered as plain information. */
    rgid: string;
    title: string;
}

// There is deliberately no `year`: Deezer's chart and editorial rows carry
// `record_type` and a position, and no release date at all. A field that is
// structurally always empty would later read as a bug in the marking rather
// than as an absence in the source.

export interface LbBotBrowseArtist {
    /** Navidrome artist id, when owned. */
    artistId: string;
    /** Deezer's own artist picture. The only artwork an unowned chart artist
     *  has — there is no Navidrome id to draw one from and no Cover Art Archive
     *  entry for a person — so without it every unowned row is the empty-artist
     *  icon. */
    imageUrl: string;
    /** lb-bot has walked their discography. Separate from `owned`, as everywhere
     *  else on this surface. */
    indexed: boolean;
    mbid: string;
    name: string;
    owned: boolean;
}

/** One Cover Art Archive image on offer. `full` is what an apply sends back. */
export interface LbBotCover {
    full: string;
    /** "" for a release-group image. */
    releaseMbid: string;
    source: 'release' | 'release-group';
    thumb: string;
}

export interface LbBotDayCount {
    count: number;
    /** YYYY-MM-DD in the requested tz. */
    date: string;
}

/**
 * One of Deezer's own genres, as `GET /lb/deezer/genres` serves them.
 *
 * Served by lb-bot rather than hardcoded in each client, and that is the point
 * of the route existing at all: the ids are Deezer's to change, there are two
 * clients to keep in step, and `MoodCharacter` is this project's standing proof
 * that a list written twice by hand drifts.
 *
 * `"0"` is "All" — the global chart, i.e. byte-for-byte what a bare `chart`
 * already answered, so it is a safe default and an older hub that drops the
 * parameter degrades to exactly the previous behaviour.
 */
export interface LbBotDeezerGenre {
    id: string;
    imageUrl: string;
    name: string;
}

export interface LbBotDeezerGenres {
    genres: LbBotDeezerGenre[];
}

export interface LbBotEdition {
    /** "" when lb-bot sent none (older lb-bot, or a release without one). */
    country: string;
    coverUrl: string;
    format: string;
    /** Digital | CD | Vinyl | Cassette | Other */
    label: string;
    releaseMbid: string;
    year: string;
}

/**
 * What kind of failure ended a fill. Alongside — never instead of — lb-bot's own
 * `reason` sentence, which stays the thing shown to the user.
 *
 * `no_source` nobody was sharing it · `format_rejected` peers had it, the format
 * policy turned them all away · `transfer_failed` the transfer itself ·
 * `placement_failed` downloaded but not filed · `mb_unavailable` MusicBrainz
 * would not answer, so the files could not be tagged.
 */
export type LbBotFailureKind =
    | ''
    | 'format_rejected'
    | 'mb_unavailable'
    | 'no_source'
    | 'placement_failed'
    | 'transfer_failed';

/**
 * The hub's `fill` frame: lb-bot pushed a fill's state or progress. Same
 * fields as `LbBotFillStatus` for `kind: 'album'`, keyed by release-group id;
 * a gap summary for `kind: 'gap'`, keyed by review-group id; a landing for
 * `kind: 'wishlist'`. Push accelerates the poll and never replaces it: nothing
 * is replayed to a client that connects late.
 */
export interface LbBotFillFrame {
    [field: string]: unknown;
    key: string;
    kind: 'album' | 'gap' | 'wishlist';
}

/** `GET /lb/fills` — every fill this client watches, in one read. */
export interface LbBotFills {
    albums: Record<string, LbBotFillStatus>;
    gaps: Record<string, LbBotGap>;
    serverTime: number;
}

/**
 * unknown → searching → queued → downloading → placing → placed → verified,
 * with needs_match and failed as side exits.
 *
 * `unknown` is the resting state of every album nobody has asked for, so it must
 * never render as an error. `placed` means the files are in the library folder;
 * `verified` means Navidrome has indexed them, which is the only state that
 * really answers "is it in my library".
 */
export type LbBotFillState =
    | 'cancelled'
    | 'downloading'
    | 'failed'
    | 'needs_match'
    | 'placed'
    | 'placing'
    | 'queued'
    | 'searching'
    | 'unknown'
    | 'verified';

export interface LbBotFillStatus {
    /** Transfers slskd reports as in progress right now. */
    activeFiles: number;
    album: string;
    /** B-084: the fill's CURRENT source was asked for every audio file at the user's
     *  request; false after a switch to another source. UNDEFINED when the status does
     *  not carry the key (an older hub's `fill` frame, an older lb-bot): absent is not
     *  false, and the ledger keeps what it had. */
    allFiles?: boolean;
    /** This fill was started with the MP3 opt-in (whole-album counterpart of a
     *  gap group's `allowMp3`). */
    allowMp3: boolean;
    artist: string;
    /** How many fills this release has STARTED (the user's and lb-bot's own
     *  automatic retries). Survives an lb-bot restart with the row. */
    attempts: number;
    /** Bytes landed so far across the album's transfers; 0 when unknown. */
    bytesDone: number;
    bytesTotal: number;
    /** The one Cancel rule, stated by the server: searching, queued or
     *  downloading — or a failed fill whose automatic retry is still pending. */
    cancellable: boolean;
    /** Files COMPLETED — never completed+failed. `failed` is beside it. */
    done: number;
    failed: number;
    /** Empty on anything that has not failed — read it unconditionally. */
    failureKind: LbBotFailureKind;
    /** lb-bot review group, when the album has one — required for Allow MP3. */
    groupId: string;
    /** B-084: audio files of the current source's folder (the peer's full listing,
     *  read at the download) that were NOT asked for; 0 when the folder was asked
     *  whole, and on old rows. */
    leftOut?: number;
    /** The search rejected mp3s and would have found something with them. */
    mp3WouldHelp: boolean;
    percent: number;
    /** The per-fill quality override this download was started with, if any. */
    quality: string;
    /** lb-bot's own sentence for a failure. Shown verbatim. */
    reason: string;
    releaseMbid: string;
    /**
     * Whether a *plain* Retry is worth offering. Deliberately false for a format
     * rejection MP3 would fix: re-running the identical search against the same
     * peers under the same format policy is not a retry, it is the same failure
     * again — `mp3WouldHelp` names the action that would actually change it.
     */
    retryable: boolean;
    /** Epoch seconds when lb-bot's own automatic retry will fire, or 0. */
    retryAt: number;
    /** The release-group the fill was started from — the handle the artist page
     *  needs to match a status back to the tile that started it. */
    rgid: string;
    /** lb-bot's clock when it answered — "last checked Ns ago" without trusting ours. */
    serverTime: number;
    /** The Soulseek peer the transfer was queued from, auto-picked or chosen.
     *  "Try another source" excludes it. Empty before the fill is queued. */
    source: string;
    /** Bytes per second across the transfers in progress. */
    speedBps: number;
    state: LbBotFillState;
    total: number;
    /** Epoch seconds of the last state change OR transfer progress. */
    updatedAt: number;
    /** `placed` past the verifier's deadline: on disk, not (yet) in Navidrome. */
    verifyGaveUp: boolean;
}

/**
 * One album the library holds only part of, as lb-bot's Fill-gaps workspace sees
 * it. Ported field-for-field from Worbus for Android's `LbBotManager.kt`, which mirrors
 * lb-bot's Python verbatim so any field can be checked against its source by
 * name. lb-bot speaks camelCase for its screen-shaped views (this one) and
 * snake_case for index rows (the discography).
 */
/**
 * One row of the site-wide ListenBrainz fresh-releases feed, as lb-bot normalizes
 * it. Recent *and* upcoming — a `releaseDate` in the future is normal.
 *
 * **Two independent ownership flags, and they must never be conflated.**
 * `artistOwned` says the artist is in the library; `releaseOwned` says this exact
 * release-group is on disk. An owned artist with a brand-new album is still a
 * download. (Upstream also sends `owned` as a backward-compatible alias for
 * `artistOwned`; it is deliberately not carried here.)
 */
/**
 * One page of the fresh-releases feed.
 *
 * `total` is how many rows lb-bot had before its own cut, so a client can say
 * "showing N of M". The cut exists because the unbounded feed is the entire
 * site-wide ListenBrainz window, which is larger than the hub will carry — and
 * lb-bot keeps every row whose artist is in the library whatever the limit, so
 * `truncated` never means "we dropped something you own".
 */
export interface LbBotFreshFeed {
    releases: LbBotFreshRelease[];
    total: number;
    truncated: boolean;
}

export interface LbBotFreshRelease {
    artist: string;
    /** Navidrome artist id, when `artistOwned`. The handle for a real artist page. */
    artistId: string;
    artistMbids: string[];
    artistOwned: boolean;
    /** I-006: all-time plays of this row's artists in lb-bot's listens mirror.
     *  UNDEFINED when the row came from an lb-bot older than the field (0 means
     *  "none, or the mirror is off / importing"). */
    artistPlays?: number;
    /** Public Cover Art Archive URL. Fetched straight from the Archive — never
     *  through anything carrying Navidrome or reverse-proxy credentials. */
    coverUrl: string;
    /** Navidrome album id, when `releaseOwned`. The handle for the real album
     *  page — a tile that says "In library" must not open a download page, and
     *  the virtual page's own redirect cannot cover an album lb-bot filled
     *  itself (placement writes no album ids). */
    releaseAlbumId: string;
    releaseDate: string;
    releaseGroupMbid: string;
    releaseMbid: string;
    releaseName: string;
    releaseOwned: boolean;
    secondaryType: string;
    /** MusicBrainz primary type. Frequently empty — those land in "Other" rather
     *  than dropping out of every filter. */
    type: string;
}

export interface LbBotGap {
    album: string;
    albumId: string;
    /** The per-album MP3 opt-in is already set. Global policy stays flac/opus. */
    allowMp3: boolean;
    artist: string;
    /** The album artist's Navidrome id ("" when lb-bot sent none): the page "Wrong edition?" falls back to. */
    artistId: string;
    /**
     * The release the gap is MEASURED AGAINST, taken from your own Navidrome tag.
     * A library tagged as a 17-track deluxe reports 17 slots even when every
     * pressing on offer has 12 — which reads as a miscount, and makes the short
     * download read as a bug, unless the UI names the edition. There is no
     * edition picker for gaps: `refresh_group_missing` overwrites this from the
     * Navidrome tag on every refresh, so pinning another one needs a new override
     * field in lb-bot.
     */
    canonicalMbid: string;
    /** Files the canonical tracklist can't account for. */
    extra: number;
    failDetail: string;
    failReason: string;
    id: string;
    missingCount: number;
    /** The search rejected mp3s and would have found something with them. */
    mp3WouldHelp: boolean;
    noSourceReason: string;
    present: number;
    sources: LbBotGapSource[];
    sourcesFoundAt: number;
    sourcesPage: number;
    sourcesPages: number;
    sourcesTotal: number;
    /**
     * The running search. **Gate every terminal judgement on this**, not on
     * `status`: the search POST approves the pending tracks and *then* starts the
     * background task, so the very next poll reads `picking` with no sources.
     * While `sourceTask.status` is `running` or `queued`, nothing the group says
     * about itself is final.
     */
    sourceTask: LbBotGapTask | null;
    /**
     * B-011 / ruling R10: `status === 'failed'` because tracks already
     * DOWNLOADED were never filed into the album (see
     * `DOWNLOADED_STALE_SECS`) — a search cannot fix this, only lb-bot's own
     * match workspace can. `failDetail` carries the human sentence; render
     * this as PROTOCOL §15.2's `needs_match` row (headline, `failDetail`,
     * Dismiss — no Retry), the same as Worbus for Android.
     */
    stalledPlacement: boolean;
    status: LbBotGapStatus;
    total: number;
    tracks: LbBotGapTrack[];
}

/**
 * A ranked Soulseek folder. Identical shape for `/lb/album/sources` and for the
 * sources on a gap — which is why one component renders both.
 */
export interface LbBotGapSource {
    /** How much the folder's own name reads as this album. */
    albumMatch: number;
    /** The "is this even the right record" verdict — the one that catches a
     *  self-titled album, where every candidate folder's name looks plausible. */
    albumMatchOk: boolean;
    /**
     * B-019 (ruling R4): whether the folder's uploader is a MusicBrainz-
     * credited artist for this release, or lb-bot's guarded fallback found no
     * evidence either way. A missing field is the server's own `True`
     * default — treat it as verified. `recommended` is already false on an
     * unverified row; this is what lets the row SAY so, and what the picker
     * below refuses to preselect.
     */
    artistVerified?: boolean;
    bitrate: string;
    /** "9/12 tracks" | "full" | "partial" | "unknown". */
    coverage: string;
    /** Matched against the canonical MusicBrainz tracklist, never a file count —
     *  the count-based version reported a folder holding a completely different
     *  album as a complete match. */
    coverageDetail: LbBotSourceCoverage;
    coverageFull: boolean;
    /** B-084 (album sources only - a gap-fill row carries none): seen audio files a plain
     *  download of this source will not ask for. Absent = unknown, never shown as 0. */
    extraFiles?: number;
    fileCount: number;
    /**
     * Populated on `/lb/album/sources` and **always empty on a gap poll**: the
     * hub strips it there, because lb-bot embeds every ranked source's entire
     * peer listing on a route a client polls every 5s. Fetch it on demand with
     * `gapSourceFiles` instead.
     */
    files: LbBotSourceFile[];
    filesTruncated: boolean;
    /** live / compilation / risk. */
    flags: string[];
    /** → `sourceFolder` on an album download. */
    folder: string;
    format: string;
    freeSlot: boolean;
    /** → `sourceId` on a gap fetch. Its index in this list. */
    id: number;
    /** → `sourceUsername` on an album download. */
    peer: string;
    queueLength: number;
    rank: number;
    recommendation: string;
    /** `rank === 1`. Pre-selected, so the confident case is one extra tap. */
    recommended: boolean;
    score: number;
    size: string;
    speedMbps: number;
}

/**
 * `picking` means two different things and the difference matters: *with*
 * sources it is "your move" now that the client has a picker; with none it is
 * the real "finish this in lb-bot's own web UI" hand-off.
 */
export type LbBotGapStatus = 'complete' | 'downloading' | 'failed' | 'picking' | 'ready';

export interface LbBotGapTask {
    current: string;
    error: string;
    id: string;
    label: string;
    /** lb-bot ends tasks `complete` or `error` — **never** `finished`. Testing
     *  for that made an empty search look identical to one still running. */
    status: string;
    summary: string;
}

export interface LbBotGapTrack {
    /** B-071: the disc this slot is on (lb-bot sends it since S-022). 0 = not
     *  known, which is also what an older lb-bot's missing field decodes to.
     *  `position` restarts on every disc, so a row is numbered through
     *  `gapPositionLabel` (utils/gap-position.ts), never by `position` alone. */
    disc: number;
    downloadError: string;
    position: number;
    state: LbBotGapTrackState;
    title: string;
}

/** `present` is a track the library already has; everything else is being (or
 *  failed to be) filled. A backwards transition is normal — lb-bot reports
 *  `downloading` for as long as a transfer group is pending. */
export type LbBotGapTrackState =
    /** B-004 (Worbus for desktop): the track's own fetch was cancelled — terminal, but
     *  neither a success nor a failure. See `SETTLED_TRACK_STATES` in
     *  gap-stage.ts and `useTrackLabel` in gap-box.tsx (`common.cancelled`). */
    | 'cancelled'
    | 'done'
    | 'downloaded'
    | 'downloading'
    | 'failed'
    | 'missing'
    | 'picked'
    | 'present'
    | 'queued'
    | 'skipped';

/** The answer to a scan request. `taskId` blank + `covered`: lb-bot started
 *  nothing because another library artist holds this discography. */
export interface LbBotIndexStart {
    covered: boolean;
    /** Worbus P1: an lb-bot from before P1 refused a scan without an MBID (400 "mbid is
     *  required"). Nothing was started; the artist needs an MBID to scan. */
    olderLbBot?: boolean;
    /** Worbus P1: a scan of this artist was already running (`taskId` is that scan's, possibly
     *  the worker's `auto-index`); it is followed, not started twice. */
    running?: boolean;
    taskId: string;
}

/**
 * What a pasted streaming link resolved to.
 *
 * `confidence` is on the wire because half the providers cannot be resolved
 * exactly: a Spotify or Deezer id maps through that service's own API, but an
 * Apple Music / YouTube Music / Tidal / Qobuz URL is resolved by *searching
 * MusicBrainz for the artist and title scraped out of the URL or its page
 * title*, which is a guess with a score. The client says so rather than
 * presenting a match as a fact.
 *
 * `kind: 'unknown'` is the honest answer for a URL from a service lb-bot does
 * not parse, and is not an error.
 */
export type LbBotLinkKind = 'album' | 'artist' | 'track' | 'unknown';

export type LbBotListeningPeriod = '7d' | '30d' | '90d' | '365d' | 'all';

/** `off`: no ListenBrainz user configured. `importing`: first backfill running.
 *  `error`: the last sync failed (rows already stored are still served). */
export type LbBotListeningState = 'error' | 'importing' | 'off' | 'ready';

export interface LbBotListeningStatus {
    /** Listens stored. */
    count: number;
    /** The last failure text, "" when none. */
    error: string;
    /** Epoch seconds, or null. */
    lastSyncAt: null | number;
    /** Epoch seconds of the newest stored listen, or null. */
    newest: null | number;
    oldest: null | number;
    state: LbBotListeningState;
    /** ListenBrainz's own listen count, null when unknown. */
    total: null | number;
}

export interface LbBotListeningSummary {
    daily: LbBotDayCount[];
    generatedAt: number;
    /** Plays of albums the library holds — the denominator for `genres`. */
    genrePlays: number;
    genres: { genre: string; plays: number }[];
    /** The last 112 days ending today in `tz`, oldest first. */
    heatmap: LbBotDayCount[];
    /** 24 ints: plays per local hour within the period. */
    hours: number[];
    period: string;
    streak: { current: number; longest: number };
    topAlbums: LbBotTopAlbum[];
    topArtists: LbBotTopArtist[];
    topTracks: LbBotTopTrack[];
    totals: {
        albums: number;
        artists: number;
        plays: number;
        /** Only listens carrying a duration are summed into this. */
        seconds: number;
        /** How many plays `seconds` covers. */
        secondsKnownFor: number;
    };
    tz: string;
}

/** One library artist as the merge surfaces name it. */
export interface LbBotMergeArtist {
    name: string;
    ndArtistId: string;
}

export interface LbBotMergeFailure {
    album: string;
    reason: string;
    title: string;
}

/** The answer to a merge or an undo: lb-bot works on in the background. */
export interface LbBotMergeJob {
    id: string;
    state: string;
}

/** `GET /lb/artist/merge/preview`. */
export interface LbBotMergePreview {
    albums: number;
    files: number;
    from: LbBotMergeArtist;
    into: LbBotMergeArtist;
    mbid: string;
    sample: { album: string; tracks: number }[];
}

/** `GET /lb/artist/merge`: "lb-bot retagged the files of <from> to <into>". */
export interface LbBotMergeRow {
    done: number;
    failures: LbBotMergeFailure[];
    /** The rewritten spelling. Its Navidrome id is "" when lb-bot sent none, and dead
     *  once the merge landed. */
    from: LbBotMergeArtist;
    id: string;
    into: LbBotMergeArtist;
    mbid: string;
    setAt: number;
    /** merging | merged | failed | undoing; an unknown state is kept as sent. */
    state: string;
    total: number;
}

/**
 * Editorial metadata for an artist or an album: real, attributed, full-length
 * text instead of the Last.fm summary that dead-ends in a "Read more on
 * Last.fm" anchor.
 *
 * Resolved by lb-bot from MusicBrainz url-relations -> Wikidata -> Wikipedia,
 * which is why it serves the virtual `mb:<mbid>` pages as well as owned ones —
 * a Navidrome metadata agent could only ever answer for the library.
 *
 * `found` is false for a legitimate "nobody has written about this", which is a
 * normal answer and not an error: the section renders nothing.
 */
export interface LbBotMeta {
    /** Present only on an album. Producer/engineer/writer, roles collapsed per person. */
    credits: LbBotMetaCredit[];
    /**
     * Worbus P1, an album only: where else the record can be found (`find-it.ts`), filtered and
     * ordered. Absent when lb-bot sent no key (an older lb-bot, a failed browse, nothing to
     * search) - which is also how a body persisted before P1 reads (`useLbBotAlbumMeta`).
     */
    findIt?: LbFindItLink[];
    found: boolean;
    /** Wikipedia's page image, when it has one. Never a cover. */
    imageUrl: string;
    links: LbBotMetaLink[];
    /** Body text, already capped by lb-bot to fit the hub's 4 MB ceiling. */
    paragraphs: string[];
    /** Present only on an artist. */
    relations: LbBotMetaRelations;
    /**
     * **Render this whenever any text is shown.** Wikipedia is CC BY-SA and the
     * attribution is a licence condition, not a nicety — and its URL is also
     * simply a better "Read more" than Last.fm's.
     */
    source: LbBotMetaSource | null;
    /** The lead paragraph. Equal to `paragraphs[0]` when there is any text. */
    summary: string;
    /** Wikidata's one-liner ("English rock band formed in Abingdon in 1985").
     *  Often present when there is no article at all, which makes it the right
     *  thing to put in a header slot. */
    wikidataDescription: string;
}

export interface LbBotMetaCredit {
    mbid: string;
    name: string;
    /** "producer", "engineer", … — MusicBrainz's own relation type names. */
    roles: string[];
}

export interface LbBotMetaLink {
    label: string;
    /** MusicBrainz url-relation type, e.g. `official homepage`. */
    type: string;
    url: string;
}

export interface LbBotMetaRelation {
    /**
     * The instruments and roles MusicBrainz states for this relation — "guitar",
     * "lead vocals". lb-bot merges them across the one-row-per-instrument-per-stint
     * shape MusicBrainz actually returns, so this is the collapsed set for the
     * person, and it is the difference between "Jonny Greenwood" and "Jonny
     * Greenwood — guitar, keyboard (1985–)".
     */
    attributes: string[];
    /** Years, when MusicBrainz dates the relation. */
    begin: string;
    /** MusicBrainz states a relation from one side only; this says which. */
    direction: string;
    end: string;
    ended: boolean;
    mbid: string;
    name: string;
    type: string;
}

export interface LbBotMetaRelations {
    /** Band members, or the bands a person is a member of. */
    members: LbBotMetaRelation[];
    /** Collaborations, subgroups, side projects. */
    related: LbBotMetaRelation[];
}

export interface LbBotMetaSource {
    license: string;
    name: string;
    title: string;
    url: string;
}

/**
 * One server-stored MusicBrainz override (I-019): the user's choice of artist
 * for a library artist whose Navidrome tag is missing or wrong. Keyed by the
 * Navidrome artist id. `tagMbid` is what Navidrome said when it was set ("" for
 * none); `setAt` is epoch seconds.
 */
export interface LbBotOverride {
    mbid: string;
    name: string;
    ndArtistId: string;
    setAt: number;
    tagMbid: string;
}

/** `GET /lb/overrides`. `toCheck` is null when the lb-bot sent no such field. */
export interface LbBotOverrideList {
    /** I-022: every album override, newest first. null = lb-bot sent no such field
     *  (older, or it could not work it out); [] = there are none. */
    albums: LbBotAlbumOverrideRow[] | null;
    artists: LbBotOverride[];
    /** I-023: merges that can still be undone, newest first. null/[] as `albums`. */
    merges: LbBotMergeRow[] | null;
    /** I-023: groups of library artists whose effective MBID is equal. null/[] as `albums`. */
    siblings: LbBotSiblingGroup[] | null;
    toCheck: LbBotToCheck[] | null;
}

/** A successful remove. */
export interface LbBotOverrideRemoved {
    taskId: string;
}

/** A successful set. `taskId` is the discography scan lb-bot started, "" when none. */
export interface LbBotOverrideSet {
    mbid: string;
    name: string;
    taskId: string;
}

export interface LbBotPreview {
    albumId: string;
    files: LbBotPreviewFile[];
    /** Files with a slot. */
    matched: number;
    /** Slots of the release no file fills. */
    missing: LbBotPreviewSlot[];
    release: {
        country: string;
        disambiguation: string;
        discCount: number;
        format: string;
        title: string;
        trackCount: number;
        year: string;
    };
    releaseMbid: string;
    /** Files without a slot: an apply leaves them untouched. */
    unmatched: number;
}

export interface LbBotPreviewFile {
    /** How the file was matched to its slot: mbid, exact, prefix, contained,
     *  fuzzy, duration, or "" for a file with no slot. */
    basis: string;
    changed: boolean;
    from: LbBotPreviewSlot;
    to: LbBotPreviewSlot | null;
}

export interface LbBotPreviewSlot {
    disc: number;
    title: string;
    track: number;
}

export interface LbBotRecent {
    /** The last row's `listenedAt` when more rows exist, else null. A page may be
     *  shorter than `limit` and still carry it: page on this, never on the row count. */
    nextBefore: null | number;
    rows: LbBotRecentRow[];
}

export interface LbBotRecentRow {
    artist: string;
    artistMbid: string;
    client: string;
    listenedAt: number;
    ndAlbumId: string;
    ndArtistId: string;
    recordingMbid: string;
    release: string;
    rgid: string;
    track: string;
}

export interface LbBotRelease {
    /** album | ep | single | compilation | live | … (lb-bot's `effective_type`). */
    effectiveType: string;
    /** `incomplete` rows only: the Fill-gaps review group lb-bot *already built*
     *  while classifying this release (`_make_review_group`, unioned at
     *  `_union_review_groups`). It is a live handle — no separate scan, no extra
     *  call — which is the whole reason gap filling needs nothing upstream.
     *  Upstream name: `group_id`. */
    groupId?: string;
    navidromeAlbumIds: string[];
    /** Tracks of this release the library holds. `incomplete` rows only.
     *  Upstream: `present` — *not* `present_tracks`, which is a different
     *  spelling used by lb-bot's screen-shaped views. */
    presentTracks?: number;
    /** MusicBrainz primary type, lowercased. Kept raw alongside `effectiveType`
     *  because the artist page groups on the same primary/secondary split
     *  Navidrome's own albums use. */
    primaryType: string;
    rgid: string;
    /** MusicBrainz secondary types, lowercased (compilation, live, remix, …). */
    secondaryTypes: string[];
    status: LbBotReleaseStatus;
    title: string;
    /** Tracks the canonical release has. `incomplete` rows only. Upstream:
     *  `total` — see `presentTracks`. */
    totalTracks?: number;
    year: string;
}

export interface LbBotReleaseDetail {
    artist: string;
    /**
     * The **lead** credited artist's MusicBrainz id, when the release-group
     * names one.
     *
     * Additive and free — lb-bot already fetched `inc=artist-credits` to build
     * the display string above and was throwing this away. It matters because a
     * page reached from a Deezer browse row has no artist handle of any kind
     * (Deezer carries no MBIDs, which is the whole reason those rows arrive
     * unresolved), so the artist credit rendered as dead text and took the only
     * route to the discography scan with it.
     *
     * The lead credit rather than a merge: a tap has to land on somebody, and
     * for a collaboration that is the only defensible answer.
     */
    artistMbid: string;
    coverUrl: string;
    title: string;
    /** A variant changes the tracklist (Original / Remaster / Deluxe). */
    variants: LbBotVariant[];
}

/** How much of a release-group the library holds. */
export type LbBotReleaseStatus = 'complete' | 'incomplete' | 'missing' | 'untagged';

/**
 * A release the client has already resolved, passed to lb-bot instead of letting
 * it re-resolve the release-group.
 *
 * Two things depend on it. lb-bot's resolver picks "official, earliest" on its
 * own, so without this the edition the user chose is silently overruled. And it
 * caches a transient MusicBrainz failure for five minutes and answers {} without
 * retrying inside that window — which turned one 503 into a hard "Could not
 * resolve album" on that album for everyone who asked next.
 */
export interface LbBotResolvedEdition {
    artist: string;
    releaseMbid: string;
    title: string;
    totalTracks: number;
}

export interface LbBotResolvedLink {
    artist: string;
    confidence: number;
    kind: LbBotLinkKind;
    mbid: string;
    provider: string;
    /**
     * Why the link did not resolve, in lb-bot's words — "Not a music link we
     * recognise", "Couldn't read the Tidal page", "No MusicBrainz artist
     * matched". Additive and outside the frozen §1.2 contract, and empty on a
     * clean hit.
     *
     * Worth rendering rather than guessing: those three failures have three
     * different answers, and a client-written sentence would have to pick one
     * of them blind.
     */
    reason: string;
    rgid: string;
    title: string;
}

/** A group of two or more library artists whose effective MBID is equal. */
export interface LbBotSiblingGroup {
    artists: {
        albums: number;
        /** A collaboration credit ("A & B"), not a spelling of the artist: never merged
         *  into anything. Absent on the wire = false. */
        collab: boolean;
        name: string;
        ndArtistId: string;
    }[];
    mbid: string;
}

export interface LbBotSimilarAlbum {
    /** Navidrome album id. Every row on this shelf is a record the library
     *  already holds, so this is normally present and is what a tap should
     *  open — routing on the rgid alone sends an owned album to its own
     *  download page. Empty only when Navidrome has not scanned it yet. */
    albumId: string;
    artist: string;
    /** Navidrome artist id — the similar artist, who is in the library. */
    artistId: string;
    /** The artist that justifies this row, i.e. the one whose page you are on. */
    because: string;
    coverUrl: string;
    rgid: string;
    /** Which of ListenBrainz / Last.fm proposed the artist. */
    sources: string[];
    status: LbBotReleaseStatus;
    title: string;
    year: string;
}

export interface LbBotSimilarAlbums {
    albums: LbBotSimilarAlbum[];
    because: string;
    sources: string[];
}

export interface LbBotSimilarArtist {
    /** Navidrome artist id, empty when the library does not hold them. */
    artistId: string;
    /** lb-bot has walked their discography, so "what am I missing from them"
     *  is answerable without starting a scan first. Independent of `owned`: an
     *  artist can be in the library and never have been indexed. */
    indexed: boolean;
    mbid: string;
    name: string;
    owned: boolean;
    score: number;
    /** Which of ListenBrainz / Last.fm proposed them. */
    sources: string[];
}

export interface LbBotSimilarArtists {
    artists: LbBotSimilarArtist[];
    /** The artist that justifies the row — what the "Because you listen to …"
     *  line names. */
    because: string;
    sources: string[];
}

export interface LbBotSourceCoverage {
    haveTracks: number;
    totalTracks: number;
    /** Tracklist slots nothing in the folder covers. */
    unmatched: string[];
}

/**
 * One file in a peer's folder, paired against the tracklist by lb-bot's own
 * ranked matcher.
 *
 * `matchedTo` is the evidence the whole review step exists for: **a file
 * matching no slot is the tell that a folder is the wrong album, however
 * plausible its name.**
 */
export interface LbBotSourceFile {
    /** False when the format is outside lb-bot's accepted list. */
    accepted: boolean;
    bitrate: number;
    durationSec: number;
    ext: string;
    filename: string;
    matchedTo: LbBotSourceMatch | null;
    sizeMb: number;
}

export interface LbBotSourceFiles {
    coverage: string;
    coverageDetail: LbBotSourceCoverage;
    /**
     * **False means the peer was unreachable** and these rows are the original
     * search hits, not the real folder. Say so; do not imply otherwise.
     */
    expanded: boolean;
    fileCount: number;
    files: LbBotSourceFile[];
    filesTruncated: boolean;
}

export interface LbBotSourceMatch {
    /** exact | prefix | contained | fuzzy | duration | position — lb-bot grades
     *  its own confidence, and the weak tiers are worth chipping. */
    basis: string;
    position: string;
    title: string;
}

/** I-021: a library artist worth a look — untagged in Navidrome, no override, and
 *  lb-bot's guess matched none of its owned albums (`unmatched`, `mbid` is the
 *  guess) or it has no MusicBrainz id at all (`unresolved`, `mbid` is ""). */
export interface LbBotToCheck {
    albums: number;
    kind: 'unmatched' | 'unresolved';
    mbid: string;
    name: string;
    ndArtistId: string;
}

export interface LbBotTopAlbum {
    artist: string;
    artistMbid: string;
    /** "" when the library does not hold the album. */
    ndAlbumId: string;
    owned: boolean;
    plays: number;
    rgid: string;
    title: string;
}

export interface LbBotTopArtist {
    mbid: string;
    name: string;
    /** "" when the library does not hold the artist. */
    ndArtistId: string;
    plays: number;
}

export interface LbBotTopTrack {
    artist: string;
    ndAlbumId: string;
    plays: number;
    recordingMbid: string;
    rgid: string;
    title: string;
}

export interface LbBotTrack {
    position: number;
    /** Undefined when presence is unknown (the library holds none of this album). */
    present?: boolean;
    title: string;
}

// ---------------------------------------------------------------------------
// Artist name merge (I-023)
// ---------------------------------------------------------------------------

export interface LbBotTracklist {
    presenceKnown: boolean;
    tracks: LbBotTrack[];
}

export interface LbBotUnowned {
    kind: string;
    period: string;
    rows: LbBotUnownedRow[];
}

export interface LbBotUnownedRow {
    artist: string;
    artistId: string;
    artistMbid: string;
    artistOwned: boolean;
    kind: string;
    lastListenedAt: number;
    plays: number;
    /** Non-empty on an `album` row; "" on an `artist` row. */
    rgid: string;
    /** "" on an `artist` row. */
    title: string;
}

export interface LbBotVariant {
    coverUrl: string;
    disambiguation: string;
    /** Same tracklist, different pressing — each carries its own cover art. */
    editions: LbBotEdition[];
    releaseMbid: string;
    title: string;
    trackCount: number;
    year: string;
}

/**
 * The wishlist, plus the sweep's own timings.
 *
 * The intervals are on the wire because they are the only honest answer to
 * "when will this happen?" — the entire mechanism is waiting, and a page that
 * cannot say how long it waits reads as broken rather than patient.
 *
 * **A landed row is removed, not flagged.** `_wishlist_landed` deletes it and
 * fires `/lb/notify`, so there is no "found it" state to render: the album
 * appears in the library and leaves this list.
 */
export interface LbBotWishlist {
    cooldownSeconds: number;
    entries: LbBotWishlistEntry[];
    intervalSeconds: number;
}

/**
 * One album on the wishlist.
 *
 * The wishlist exists for exactly one failure: `no_source`. lb-bot never
 * auto-retries that one, and correctly so — it already walked its entire ranked
 * source list, so re-running the identical search against the identical peers is
 * the same failure again, not a retry. What *does* change is the Soulseek swarm,
 * over hours. So the retry belongs on a slow periodic re-search against a
 * persisted list, which is what this is.
 */
export interface LbBotWishlistEntry {
    /** Unix **seconds**, not milliseconds — lb-bot writes `time.time()`. */
    addedAt: number;
    artist: string;
    /** How many slow re-searches have run for this row. */
    attempts: number;
    /** Why the last re-search did not land it, in lb-bot's own words. Empty
     *  before the first one has run. */
    lastReason: string;
    /** Unix seconds of the last re-search; 0 before the first. */
    lastTriedAt: number;
    rgid: string;
    title: string;
}
