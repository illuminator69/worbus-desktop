import type {
    LbBotAlbumCandidate,
    LbBotAlbumCoverSet,
    LbBotAlbumJob,
    LbBotAlbumState,
    LbBotAlbumStateQuery,
    LbBotArtistCandidate,
    LbBotArtistScan,
    LbBotBrowse,
    LbBotBrowseAlbum,
    LbBotBrowseArtist,
    LbBotCover,
    LbBotDayCount,
    LbBotDeezerGenre,
    LbBotDeezerGenres,
    LbBotDiscography,
    LbBotDownloadResult,
    LbBotEdition,
    LbBotFailureKind,
    LbBotFills,
    LbBotFillState,
    LbBotFillStatus,
    LbBotFreshFeed,
    LbBotFreshRelease,
    LbBotGap,
    LbBotGapAction,
    LbBotGapSource,
    LbBotGapStatus,
    LbBotGapTask,
    LbBotGapTrack,
    LbBotGapTrackState,
    LbBotIndexItem,
    LbBotIndexKeys,
    LbBotIndexPage,
    LbBotIndexStart,
    LbBotLinkKind,
    LbBotListeningState,
    LbBotListeningStatus,
    LbBotListeningSummary,
    LbBotMergeJob,
    LbBotMergePreview,
    LbBotMergeRow,
    LbBotMeta,
    LbBotMetaCredit,
    LbBotMetaLink,
    LbBotMetaRelation,
    LbBotOverride,
    LbBotOverrideList,
    LbBotOverrideRemoved,
    LbBotOverrideSet,
    LbBotPreview,
    LbBotRecent,
    LbBotRecentRow,
    LbBotRelease,
    LbBotReleaseDetail,
    LbBotReleaseStatus,
    LbBotResolvedLink,
    LbBotResult,
    LbBotSimilarAlbum,
    LbBotSimilarAlbums,
    LbBotSimilarArtist,
    LbBotSimilarArtists,
    LbBotSourceCoverage,
    LbBotSourceFile,
    LbBotSourceFiles,
    LbBotStatus,
    LbBotToCheck,
    LbBotTopAlbum,
    LbBotTopArtist,
    LbBotTopTrack,
    LbBotTrack,
    LbBotTracklist,
    LbBotUnowned,
    LbBotUnownedRow,
    LbBotVariant,
    LbBotWishlist,
    LbBotWishlistEntry,
} from '/@/shared/types/lbbot-types';

import { BrowserWindow, ipcMain, Notification } from 'electron';

import { getHubConfig, hubAuth } from '../hub';
import { albumSourcesParams } from './album-sources-params';

import { getMainWindow } from '/@/main/index';
import { toFindIt } from '/@/shared/utils/find-it';
import {
    albumDownloadBody,
    mergePreviewParams,
    mergeStartBody,
    toAlbumRows,
    toAlbumState,
    toCovers,
    toMergePreview,
    toMergeRow,
    toMergeRows,
    toPreview,
    toSiblingGroups,
} from '/@/shared/utils/lbbot-album-wire';
import { describeFailure, isOlderScanRefusal, refusalCode } from '/@/shared/utils/lbbot-failure';
import { LB_ANSWERED } from '/@/shared/utils/lbbot-mode';
import { hasMetaFields, normalizeLbBotWebUrl } from '/@/shared/utils/lbbot-wire';

/**
 * navi-connect lb-bot client (main process).
 *
 * lb-bot knows what is *missing* from the library: a per-artist MusicBrainz
 * discography index, and a Soulseek acquisition pipeline that can fill a gap.
 * This exposes the read side plus the two writes the UI offers (index an artist,
 * download a missing album) — see ../../../../../DESIGN-lbbot-client-integration.md.
 *
 * HUB ONLY, unlike the AudioMuse client next door. That one keeps a direct-LAN
 * fallback because AudioMuse has its own bearer token; lb-bot's Flask API has no
 * authentication at all, so a direct route would mean shipping its LAN address to
 * every device and bypassing the only gate that exists. No hub configured means
 * the feature is simply off.
 *
 * Everything here is fail-soft: an unreachable hub, an unconfigured LBBOT_URL, or
 * any upstream error returns the empty/unknown shape, and the renderer hides the
 * surface rather than showing an error. The artist page must render exactly as it
 * does today when lb-bot is not there.
 */

/** `ws://host:4790` → `http://host:4790`; null when the hub isn't configured. */
const hubBase = (): null | string => {
    const { enabled, url } = getHubConfig();
    // Worbus P2: the device secret, else the typed token (hubAuth); neither means no hub.
    if (!enabled || !url || !hubAuth.bearer()) return null;
    return url
        .replace(/^ws/, 'http')
        .replace(/\/+$/, '')
        .replace(/\/connect$/, '');
};

const authHeaders = (): Record<string, string> => ({
    Authorization: `Bearer ${hubAuth.bearer() ?? ''}`,
});

type Json = Record<string, unknown>;

// `describeFailure` lives in `/@/shared/utils/lbbot-failure` (pure, with a harness).

const failed = <T>(
    status: number,
    error: string,
    tooLarge = false,
    extra: {
        code?: string;
        matched?: number;
        retryable?: boolean;
        total?: number;
        upstreamError?: string;
    } = {},
): LbBotResult<T> => ({
    data: null,
    error,
    ok: false,
    status,
    ...(tooLarge ? { tooLarge: true } : {}),
    ...(extra.code ? { code: extra.code } : {}),
    ...(typeof extra.matched === 'number' ? { matched: extra.matched } : {}),
    ...(extra.retryable ? { retryable: true } : {}),
    ...(typeof extra.total === 'number' ? { total: extra.total } : {}),
    ...(extra.upstreamError ? { upstreamError: extra.upstreamError } : {}),
});

/**
 * How long the two *polled* routes get before this side gives up on the tick.
 *
 * Everything else here inherits Node's default, which is effectively the hub's own
 * timeout (20 s for `album/status`, 45 s for the gap) plus the socket. That is right
 * for a one-shot the user pressed, and wrong for something running every five
 * seconds: a tick that has not answered in twelve has already missed its slot, and
 * the next one will do. The hub's timeouts sitting above this is deliberate — the
 * client is the side that has to give up first.
 */
const POLL_TIMEOUT_MS = 12_000;

/**
 * The one place an lb-bot request is made.
 *
 * Returns a result rather than `null` so a caller can tell "lb-bot said no" from
 * "the hub isn't there" from "this hub is too old". The fail-soft readers below
 * throw that away again on purpose; the writes and the user-initiated reads do
 * not — see LbBotResult.
 */
/**
 * Worbus P2 (review I3): an `lbbot_too_old` was passed on and no answer has got through since. The
 * hub serves this user only answers that prove lb-bot's identity (R17), so the next one that does
 * ends the renderer's too-old state (`LB_ANSWERED`).
 */
let tooOldSeen = false;

const request = async <T = Json>(
    method: 'GET' | 'POST',
    path: string,
    options: { body?: Json; params?: Record<string, string>; timeoutMs?: number } = {},
): Promise<LbBotResult<T>> => {
    const base = hubBase();
    if (!base) return failed(0, 'No navi-connect hub is configured.');
    let res: Response;
    try {
        const url = new URL(`${base}${path}`);
        for (const [key, value] of Object.entries(options.params ?? {})) {
            if (value) url.searchParams.set(key, value);
        }
        res = await fetch(url.toString(), {
            ...(options.body ? { body: JSON.stringify(options.body) } : {}),
            headers: {
                ...authHeaders(),
                ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            },
            method,
            ...(options.timeoutMs ? { signal: AbortSignal.timeout(options.timeoutMs) } : {}),
        });
    } catch (error) {
        // With the cause: `TypeError: fetch failed` on its own says only that
        // something went wrong at the socket, and the cause is the difference
        // between a hub that is down, a name that doesn't resolve and a request
        // that timed out.
        const cause = (error as { cause?: unknown }).cause;
        console.error(
            `[lbbot] ${method} ${path} — ${String(error)}${cause ? ` (${String(cause)})` : ''}`,
        );
        return failed(0, 'Could not reach the hub — it may be down or still starting.');
    }

    let body: Json | null = null;
    try {
        body = (await res.json()) as Json;
    } catch {
        body = null;
    }

    if (!res.ok) {
        // Logged unconditionally: a button that does nothing, with nothing in the
        // console either, is the bug this whole result type exists to prevent.
        console.error(`[lbbot] ${method} ${path} → ${res.status}`);
        // Worbus P1: THE one place lb-bot's two refusals are noticed, whichever route got them
        // and whether or not its handler passes `code` on. A 409 `downloads_off` turns every
        // download surface off; a 401 `signin_required` (an older hub sends no bearer, B-263)
        // marks lb-bot refused for this connection. The renderer applies both (`useLbBotRefusals`).
        const refusal = refusalCode(res.status, body);
        if (refusal === 'lbbot_too_old') tooOldSeen = true;
        if (refusal) getMainWindow()?.webContents.send('lbbot-refusal', { code: refusal });
        // The hub's own oversize-body 502 (B-013), not lb-bot's — see LbBotResult.tooLarge.
        return failed(res.status, describeFailure(res.status, body), body?.tooLarge === true, {
            code: typeof body?.code === 'string' ? body.code : undefined,
            // `poor_match` (I-022) says how many files fit, so the client can ask.
            matched: typeof body?.matched === 'number' ? body.matched : undefined,
            retryable: body?.retryable === true,
            total: typeof body?.total === 'number' ? body.total : undefined,
            upstreamError: typeof body?.error === 'string' ? body.error : undefined,
        });
    }
    if (tooOldSeen) {
        tooOldSeen = false;
        getMainWindow()?.webContents.send('lbbot-refusal', { code: LB_ANSWERED });
    }
    return { data: (body ?? {}) as T, error: '', ok: true, status: res.status };
};

/** Fail-soft read: an unreachable hub, an unconfigured LBBOT_URL and an upstream
 *  error all collapse to null, and the surface hides itself. Right for the probe
 *  and the discography; wrong for anything the user pressed. */
const get = async (path: string, params?: Record<string, string>): Promise<Json | null> =>
    (await request('GET', path, { params })).data;

const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const num = (value: unknown): number => {
    const n = typeof value === 'string' ? Number(value) : (value as number);
    return Number.isFinite(n) ? n : 0;
};

// ---------------------------------------------------------------------------
// Availability probe
// ---------------------------------------------------------------------------

// The hub always answers /lb/status, even with LBBOT_URL unset — that is the
// whole point of routing the prefix unconditionally, so "not configured" arrives
// as JSON rather than as the WebSocket upgrade's 426 text/plain.
//
// `routes` is what this hub can actually proxy. A client ships independently of
// the hub, and the hub is a long-running process, so "my app is newer than the
// hub it talks to" is a permanent condition rather than an edge case. Passing
// the list on lets the UI say "this hub can't do gap filling yet — restart it"
// instead of offering a button that 404s. An *empty* list is an older hub that
// doesn't advertise: assume supported rather than hiding working features.
ipcMain.handle('lbbot-status', async (): Promise<LbBotStatus> => {
    const data = await get('/lb/status');
    // Worbus P1: lb-bot's downloads mode, relayed by a P1 hub; absent from an older one.
    const downloads = data?.downloads === 'on' || data?.downloads === 'off' ? data.downloads : null;
    return {
        available: data?.configured === true && data?.upstreamReachable === true,
        ...(downloads ? { downloads } : {}),
        routes: Array.isArray(data?.routes)
            ? data.routes.filter((route): route is string => typeof route === 'string')
            : [],
        webUrl: normalizeLbBotWebUrl(data?.webUrl),
    };
});

// ---------------------------------------------------------------------------
// Discography
// ---------------------------------------------------------------------------

const toRelease = (row: unknown): LbBotRelease[] => {
    if (!row || typeof row !== 'object') return [];
    const r = row as Json;
    const rgid = str(r.rgid);
    if (!rgid) return [];
    const ndIds = Array.isArray(r.navidrome_album_ids)
        ? r.navidrome_album_ids.filter((id): id is string => typeof id === 'string')
        : [];
    const secondary = Array.isArray(r.secondary_types)
        ? r.secondary_types.flatMap((t) => (typeof t === 'string' && t ? [t.toLowerCase()] : []))
        : [];
    // The `incomplete` extras. lb-bot doesn't merely *label* a release
    // incomplete — it builds the Fill-gaps review group while classifying it
    // (`_make_review_group`, source="artist_discography"), so `group_id` here is
    // a live handle needing no separate scan and no extra call. Dropping these
    // was what made gap filling look like it needed new plumbing upstream.
    //
    // **The counts are `present`/`total`, and only on `incomplete` rows.** They
    // are not the `present_tracks`/`total_tracks` spelling used elsewhere in
    // lb-bot's API, and reading that spelling here is what left every incomplete
    // album with a 0/0 count — so the `9/12` badge measured nothing, rendered
    // nothing, and the artist page had no way at all to say which albums were
    // short of tracks.
    const groupId = str(r.group_id);
    return [
        {
            effectiveType: str(r.effective_type) || str(r.primary_type),
            ...(groupId ? { groupId } : {}),
            navidromeAlbumIds: ndIds,
            ...(r.present == null ? {} : { presentTracks: num(r.present) }),
            primaryType: str(r.primary_type).toLowerCase(),
            rgid,
            secondaryTypes: secondary,
            status: (str(r.status) || 'missing') as LbBotReleaseStatus,
            title: str(r.title),
            ...(r.total == null ? {} : { totalTracks: num(r.total) }),
            year: str(r.year) || (r.year ? String(r.year) : ''),
        },
    ];
};

const SCAN_STATES = new Set(['done', 'failed', 'running']);

const toScan = (raw: unknown): LbBotArtistScan | null => {
    if (!raw || typeof raw !== 'object') return null;
    const scan = raw as Record<string, unknown>;
    const state = str(scan.state);
    if (!SCAN_STATES.has(state)) return null;
    // Worbus P1: the counts, when lb-bot sends them (an older lb-bot sends none: 0 of 0).
    const total = Math.max(0, Math.floor(num(scan.total)));
    return {
        done: total ? Math.min(total, Math.max(0, Math.floor(num(scan.done)))) : 0,
        error: str(scan.error),
        finishedAt: num(scan.finishedAt),
        startedAt: num(scan.startedAt),
        state: state as LbBotArtistScan['state'],
        taskId: str(scan.taskId),
        total,
    };
};

// An instant SQLite read on lb-bot's side keyed by the Navidrome artist id the
// page already holds — never a MusicBrainz round trip, so it is safe to fire on
// every artist page open. `indexed: false` means "never scanned", which the UI
// offers to fix; it is not an error.
ipcMain.handle(
    'lbbot-discography',
    async (_event, args: { mbid?: string; ndId: string }): Promise<LbBotDiscography | null> => {
        if (!args.ndId && !args.mbid) return null;
        const data = await get('/lb/artist/discography', {
            mbid: args.mbid ?? '',
            nd_id: args.ndId,
        });
        if (!data) return null;
        const scan = toScan(data.scan);
        // Worbus P1: absent when not indexed and from an older lb-bot (both read as false).
        const unresolved = typeof data.unresolved === 'boolean' ? data.unresolved : undefined;
        if (data.indexed !== true) {
            return {
                artistName: '',
                indexed: false,
                releases: [],
                scan,
                scannedAt: 0,
                stale: false,
            };
        }
        const releases = Array.isArray(data.releases) ? data.releases : [];
        return {
            artistName: str(data.artist_name),
            indexed: true,
            releases: releases.flatMap(toRelease),
            scan,
            // Epoch seconds of the scan that built this index. It is the only
            // thing that changes when a *rescan* of an already-indexed artist
            // finishes — `indexed` was already true — so it is what the rescan
            // button watches to know it is done.
            scannedAt: num(data.scanned_at),
            stale: data.stale === true,
            ...(unresolved === undefined ? {} : { unresolved }),
        };
    },
);

// Scanning an artist walks MusicBrainz at one request a second — 10-60s for a
// large discography — so it is always an explicit user action, never automatic
// on page open. Returns the background task id, or null if the trigger failed.
//
// Worbus P1: with no MBID, lb-bot P1 scans by the Navidrome id alone (`{nd_id}`,
// "Scan now"), resolving the artist on MusicBrainz itself; a scan already running
// for the artist answers `running: true` with its task id. An lb-bot from before P1
// answers that body 400 "mbid is required", told apart as `olderLbBot`.
ipcMain.handle(
    'lbbot-index-artist',
    async (
        _event,
        args: { mbid?: string; name: string; ndId: string },
    ): Promise<LbBotIndexStart | null> => {
        // With an MBID lb-bot needs both: the MBID is what it scans, the name is
        // what it matches the library against. Without one, the Navidrome id.
        if (args.mbid ? !args.name : !args.ndId) return null;
        const result = await request('POST', '/lb/artist/discography', {
            body: args.mbid
                ? { mbid: args.mbid, name: args.name, nd_id: args.ndId }
                : { nd_id: args.ndId },
        });
        // lb-bot's own words, not `describeFailure`'s sentence for them.
        if (!args.mbid && isOlderScanRefusal(result.status, result.upstreamError)) {
            return { covered: false, olderLbBot: true, taskId: '' };
        }
        const { data } = result;
        if (data?.ok !== true) return null;
        // A blank `task_id` with `covered: true` is lb-bot's decision to start
        // nothing: another library artist holds this discography.
        return {
            covered: data.covered === true,
            ...(data.running === true ? { running: true } : {}),
            taskId: str(data.task_id),
        };
    },
);

// Add or refresh ONE release-group in an artist's stored index.
//
// The alternative is a full rescan — one MusicBrainz request per second per
// release-group — for a single album. And it is needed constantly, not rarely:
// lb-bot serves a stored discography immediately even when stale *by design*, so
// anything released since the last scan is simply absent, which is every row the
// Fresh tab leads to.
//
// A `LbBotResult` rather than the fail-soft `get()` contract, because it is a
// write the user's navigation is waiting on and a failure has to be sayable. An
// older hub does not have the route: it answers 404, which `request` reports
// rather than swallowing — that is what `/lb/status`'s `routes` list exists to
// pre-empt.
ipcMain.handle(
    'lbbot-index-release',
    async (
        _event,
        args: {
            artist?: string;
            external?: boolean;
            mbid?: string;
            name?: string;
            ndId?: string;
            rgid: string;
            title?: string;
            type?: string;
            year?: string;
        },
    ): Promise<LbBotResult<boolean>> => {
        if (!args.rgid) return failed<boolean>(0, 'No release-group id');
        if (!args.mbid && !args.ndId) {
            return failed<boolean>(0, 'No artist to index this release against');
        }
        // title/artist/type/year are lb-bot's MusicBrainz-outage override, used
        // only when the release-group lookup answers nothing. It caches a
        // transient failure for five minutes per exact query and returns {}
        // inside that window without asking again, so one 503 made this a hard
        // 502 on that album for anyone who asked next — and the caller reached
        // it from a row that already names the release.
        const result = await request('POST', '/lb/artist/release', {
            body: {
                artist: args.artist ?? '',
                external: args.external === true,
                mbid: args.mbid ?? '',
                name: args.name ?? '',
                nd_id: args.ndId ?? '',
                rgid: args.rgid,
                title: args.title ?? '',
                type: args.type ?? '',
                year: args.year ?? '',
            },
        });
        if (!result.ok) {
            return failed<boolean>(result.status, result.error, false, { code: result.code });
        }
        const ok = result.data?.ok === true;
        return {
            data: ok,
            error: ok ? '' : str(result.data?.error) || 'lb-bot refused the request.',
            ok,
            status: result.status,
        };
    },
);

// ---------------------------------------------------------------------------
// Artist MBID overrides (I-019)
// ---------------------------------------------------------------------------

// The user's server-stored choice of MusicBrainz artist for a library artist
// whose Navidrome tag is missing or wrong. All three are `LbBotResult`s: the map
// read has to tell "failed" from "empty" (a failed fetch must keep the cached
// map, not replace it with nothing), and a set or remove is a button press whose
// failure has to be sayable — `status` / `code` / `retryable` tell the 404
// (`unknown_mbid`, `no_override`), the 409 (`busy`) and the 502 (MusicBrainz
// down, nothing stored) apart. An older hub or lb-bot 404s these routes without
// a `code`; the renderer reads that as "older" and hides the controls (a 405
// for the POSTs, a 404 for the list).

const toOverride = (row: unknown): LbBotOverride[] => {
    if (!row || typeof row !== 'object') return [];
    const r = row as Json;
    const ndArtistId = str(r.ndArtistId);
    const mbid = str(r.mbid);
    if (!ndArtistId || !mbid) return [];
    return [
        {
            mbid,
            name: str(r.name),
            ndArtistId,
            setAt: num(r.setAt),
            tagMbid: str(r.tagMbid),
        },
    ];
};

// I-021: `toCheck` rides on the same route. A body without the field is an older
// lb-bot, reported as null — which is not an empty list ("nothing to check").
const toCheckRow = (row: unknown): LbBotToCheck[] => {
    if (!row || typeof row !== 'object') return [];
    const r = row as Json;
    const ndArtistId = str(r.ndArtistId);
    if (!ndArtistId) return [];
    return [
        {
            albums: num(r.albums),
            kind: r.kind === 'unmatched' ? 'unmatched' : 'unresolved',
            mbid: str(r.mbid),
            name: str(r.name),
            ndArtistId,
        },
    ];
};

ipcMain.handle('lbbot-overrides', async (): Promise<LbBotResult<LbBotOverrideList>> => {
    const result = await request('GET', '/lb/overrides');
    if (!result.ok)
        return failed<LbBotOverrideList>(result.status, result.error, false, { code: result.code });
    // A body without the list is not an empty list: it is not an answer.
    if (!Array.isArray(result.data?.artists)) {
        return failed<LbBotOverrideList>(result.status, 'lb-bot answered with no override list.');
    }
    return {
        data: {
            // I-022 / I-023: each is absent -> null (unknown), [] -> [] (none).
            albums: toAlbumRows(result.data.albums),
            artists: result.data.artists.flatMap(toOverride),
            merges: toMergeRows(result.data.merges),
            siblings: toSiblingGroups(result.data.siblings),
            toCheck: Array.isArray(result.data.toCheck)
                ? result.data.toCheck.flatMap(toCheckRow)
                : null,
        },
        error: '',
        ok: true,
        status: result.status,
    };
});

// Sets are the slow ones: lb-bot checks the MBID against MusicBrainz (one
// request behind its global 1 req/s lock) before it stores anything, then starts
// the discography scan and returns its task id without waiting for it.
ipcMain.handle(
    'lbbot-override-set',
    async (
        _event,
        args: { mbid: string; name: string; ndId: string },
    ): Promise<LbBotResult<LbBotOverrideSet>> => {
        if (!args.ndId || !args.mbid) {
            return failed<LbBotOverrideSet>(0, 'An artist and a MusicBrainz id are both needed.');
        }
        const result = await request('POST', '/lb/artist/override', {
            body: { mbid: args.mbid, name: args.name ?? '', nd_id: args.ndId },
        });
        if (!result.ok) {
            return failed<LbBotOverrideSet>(result.status, result.error, false, {
                code: result.code,
                retryable: result.retryable,
            });
        }
        if (result.data?.ok !== true) {
            return failed<LbBotOverrideSet>(
                result.status,
                str(result.data?.error) || 'lb-bot refused the request.',
            );
        }
        return {
            data: {
                mbid: str(result.data.mbid) || args.mbid,
                name: str(result.data.name) || args.name,
                taskId: str(result.data.task_id),
            },
            error: '',
            ok: true,
            status: result.status,
        };
    },
);

ipcMain.handle(
    'lbbot-override-remove',
    async (_event, args: { ndId: string }): Promise<LbBotResult<LbBotOverrideRemoved>> => {
        if (!args.ndId) return failed<LbBotOverrideRemoved>(0, 'No artist to remove it from.');
        const result = await request('POST', '/lb/artist/override/remove', {
            body: { nd_id: args.ndId },
        });
        if (!result.ok) {
            return failed<LbBotOverrideRemoved>(result.status, result.error, false, {
                code: result.code,
                retryable: result.retryable,
            });
        }
        if (result.data?.ok !== true) {
            return failed<LbBotOverrideRemoved>(
                result.status,
                str(result.data?.error) || 'lb-bot refused the request.',
            );
        }
        return {
            data: { taskId: str(result.data.task_id) },
            error: '',
            ok: true,
            status: result.status,
        };
    },
);

// ---------------------------------------------------------------------------
// Album override (I-022): "Fix album match"
// ---------------------------------------------------------------------------

// The user's choice of MusicBrainz release for an album the library owns; lb-bot
// retags the files, keeps the previous tags, and can undo. Every route here is
// result-shaped: `status` / `code` / `matched` / `total` / `retryable` tell the
// 400, the 404s (`unknown_album`, `no_override`, `unknown_release`), the 409s
// (`busy`, `in_progress`, `poor_match` with matched/total, `files_unreachable`
// with a total only) and the retryable 502 apart; every other coded refusal is
// lb-bot's own sentence, relayed as is. An
// older hub or lb-bot answers a code-less 404 (GET) or a 405 (POST), which the
// renderer reads as "older" and hides the control. Nothing here carries a path.

const albumFailed = <T>(result: LbBotResult<unknown>): LbBotResult<T> =>
    failed<T>(result.status, result.error, false, {
        code: result.code,
        matched: result.matched,
        retryable: result.retryable,
        total: result.total,
    });

const MBID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The album as lb-bot sees it, by the Navidrome album id the page has, or - to
// follow an apply or a remove, when that id is dead - by the override row's id.
// The by-id read is the poll, so it gets the poll's short timeout.
ipcMain.handle(
    'lbbot-album-override-get',
    async (_event, args: LbBotAlbumStateQuery): Promise<LbBotResult<LbBotAlbumState>> => {
        if (!args.albumId && !args.id) {
            return failed<LbBotAlbumState>(0, 'No album to look up.');
        }
        const byId = !args.albumId && !!args.id;
        const result = await request('GET', '/lb/album/override', {
            params: byId ? { id: args.id as string } : { album_id: args.albumId as string },
            ...(byId ? { timeoutMs: POLL_TIMEOUT_MS } : {}),
        });
        if (!result.ok) return albumFailed<LbBotAlbumState>(result);
        return { data: toAlbumState(result.data), error: '', ok: true, status: result.status };
    },
);

ipcMain.handle(
    'lbbot-album-covers',
    async (
        _event,
        args: { releaseMbid?: string; rgid?: string },
    ): Promise<LbBotResult<LbBotCover[]>> => {
        if (!args.rgid && !args.releaseMbid) {
            return failed<LbBotCover[]>(0, 'A release or a release group is needed.');
        }
        const result = await request('GET', '/lb/album/covers', {
            params: { release_mbid: args.releaseMbid ?? '', rgid: args.rgid ?? '' },
        });
        if (!result.ok) return albumFailed<LbBotCover[]>(result);
        return { data: toCovers(result.data), error: '', ok: true, status: result.status };
    },
);

// Writes nothing; sits on MusicBrainz upstream, so it can take seconds.
ipcMain.handle(
    'lbbot-album-preview',
    async (
        _event,
        args: { albumId: string; releaseMbid: string },
    ): Promise<LbBotResult<LbBotPreview>> => {
        if (!args.albumId || !MBID.test(args.releaseMbid)) {
            return failed<LbBotPreview>(
                0,
                'An album and a MusicBrainz release id are both needed.',
            );
        }
        const result = await request('POST', '/lb/album/override/preview', {
            body: { album_id: args.albumId, release_mbid: args.releaseMbid },
        });
        if (!result.ok) return albumFailed<LbBotPreview>(result);
        return { data: toPreview(result.data), error: '', ok: true, status: result.status };
    },
);

// Answers at once (`state: applying`); the renderer polls by the returned id.
ipcMain.handle(
    'lbbot-album-override-apply',
    async (
        _event,
        args: { albumId: string; coverUrl?: string; force?: boolean; releaseMbid: string },
    ): Promise<LbBotResult<LbBotAlbumJob>> => {
        if (!args.albumId || !MBID.test(args.releaseMbid)) {
            return failed<LbBotAlbumJob>(
                0,
                'An album and a MusicBrainz release id are both needed.',
            );
        }
        const result = await request('POST', '/lb/album/override', {
            body: {
                album_id: args.albumId,
                ...(args.coverUrl ? { cover_url: args.coverUrl } : {}),
                ...(args.force === true ? { force: true } : {}),
                release_mbid: args.releaseMbid,
            },
        });
        if (!result.ok) return albumFailed<LbBotAlbumJob>(result);
        if (result.data?.ok !== true || !str(result.data.id)) {
            return failed<LbBotAlbumJob>(
                result.status,
                str(result.data?.error) || 'lb-bot refused the request.',
            );
        }
        return {
            data: { id: str(result.data.id), state: str(result.data.state) },
            error: '',
            ok: true,
            status: result.status,
        };
    },
);

// The cover alone (the release stays). Synchronous.
ipcMain.handle(
    'lbbot-album-cover-set',
    async (
        _event,
        args: { albumId: string; coverUrl: string },
    ): Promise<LbBotResult<LbBotAlbumCoverSet>> => {
        if (!args.albumId || !args.coverUrl) {
            return failed<LbBotAlbumCoverSet>(0, 'An album and a cover are both needed.');
        }
        const result = await request('POST', '/lb/album/cover', {
            body: { album_id: args.albumId, cover_url: args.coverUrl },
        });
        if (!result.ok) return albumFailed<LbBotAlbumCoverSet>(result);
        if (result.data?.ok !== true || !str(result.data.id)) {
            return failed<LbBotAlbumCoverSet>(
                result.status,
                str(result.data?.error) || 'lb-bot refused the request.',
            );
        }
        return { data: { id: str(result.data.id) }, error: '', ok: true, status: result.status };
    },
);

// Undo: restores the tags and the previous cover in the background; the poll
// by id ends on a 404 `no_override`.
ipcMain.handle(
    'lbbot-album-override-remove',
    async (_event, args: { id: string }): Promise<LbBotResult<LbBotAlbumJob>> => {
        if (!args.id) return failed<LbBotAlbumJob>(0, 'No album change to undo.');
        const result = await request('POST', '/lb/album/override/remove', {
            body: { id: args.id },
        });
        if (!result.ok) return albumFailed<LbBotAlbumJob>(result);
        if (result.data?.ok !== true || !str(result.data.id)) {
            return failed<LbBotAlbumJob>(
                result.status,
                str(result.data?.error) || 'lb-bot refused the request.',
            );
        }
        return {
            data: { id: str(result.data.id), state: str(result.data.state) },
            error: '',
            ok: true,
            status: result.status,
        };
    },
);

// ---------------------------------------------------------------------------
// Artist name merge (I-023): "Merge into one name"
// ---------------------------------------------------------------------------

// Two library artists with the same effective MusicBrainz id but different
// spellings: lb-bot retags the variant's files to the kept name, undoably. Same
// result-shaped contract as the album routes above (`different_artists`,
// `unknown_artist`, `busy`, `in_progress`, `collaboration`, `files_unreachable`,
// retryable 502; a code-less 404 / 405 = older). `nd_id` is the entry whose name
// is kept, `from_nd_id` the one rewritten - both built from ONE plan object by
// `mergeStartBody` / `mergePreviewParams`, never as two loose strings.

ipcMain.handle(
    'lbbot-merge-preview',
    async (
        _event,
        args: { fromNdId: string; ndId: string },
    ): Promise<LbBotResult<LbBotMergePreview>> => {
        if (!args.ndId || !args.fromNdId) {
            return failed<LbBotMergePreview>(0, 'Two artists are needed.');
        }
        const result = await request('GET', '/lb/artist/merge/preview', {
            params: mergePreviewParams(args),
        });
        if (!result.ok) return albumFailed<LbBotMergePreview>(result);
        return { data: toMergePreview(result.data), error: '', ok: true, status: result.status };
    },
);

ipcMain.handle(
    'lbbot-merge-start',
    async (
        _event,
        args: { fromNdId: string; ndId: string },
    ): Promise<LbBotResult<LbBotMergeJob>> => {
        if (!args.ndId || !args.fromNdId)
            return failed<LbBotMergeJob>(0, 'Two artists are needed.');
        const result = await request('POST', '/lb/artist/merge', {
            body: mergeStartBody(args),
        });
        if (!result.ok) return albumFailed<LbBotMergeJob>(result);
        if (result.data?.ok !== true || !str(result.data.id)) {
            return failed<LbBotMergeJob>(
                result.status,
                str(result.data?.error) || 'lb-bot refused the request.',
            );
        }
        return {
            data: { id: str(result.data.id), state: str(result.data.state) },
            error: '',
            ok: true,
            status: result.status,
        };
    },
);

// The poll. A 404 `no_merge` is lb-bot's answer after an undo has finished.
ipcMain.handle(
    'lbbot-merge-get',
    async (_event, args: { id: string }): Promise<LbBotResult<LbBotMergeRow>> => {
        if (!args.id) return failed<LbBotMergeRow>(0, 'No merge to look up.');
        const result = await request('GET', '/lb/artist/merge', {
            params: { id: args.id },
            timeoutMs: POLL_TIMEOUT_MS,
        });
        if (!result.ok) return albumFailed<LbBotMergeRow>(result);
        const row = toMergeRow(result.data);
        if (!row) return failed<LbBotMergeRow>(result.status, 'lb-bot answered with no merge.');
        return { data: row, error: '', ok: true, status: result.status };
    },
);

ipcMain.handle(
    'lbbot-merge-undo',
    async (_event, args: { id: string }): Promise<LbBotResult<LbBotMergeJob>> => {
        if (!args.id) return failed<LbBotMergeJob>(0, 'No merge to undo.');
        const result = await request('POST', '/lb/artist/merge/undo', { body: { id: args.id } });
        if (!result.ok) return albumFailed<LbBotMergeJob>(result);
        if (result.data?.ok !== true || !str(result.data.id)) {
            return failed<LbBotMergeJob>(
                result.status,
                str(result.data?.error) || 'lb-bot refused the request.',
            );
        }
        return {
            data: { id: str(result.data.id), state: str(result.data.state) },
            error: '',
            ok: true,
            status: result.status,
        };
    },
);

// ---------------------------------------------------------------------------
// Listening history (I-006)
// ---------------------------------------------------------------------------

// lb-bot mirrors the user's ListenBrainz listens into SQLite and serves
// aggregates from it. Every route is a local read on lb-bot's side, so none of
// them waits on ListenBrainz. All are `LbBotResult`: a failed summary has to keep
// the cached body on screen (the hook throws on !ok), and a 404 means lb-bot is
// older than the hub — the screen then hides itself instead of showing an error.
// The hub drops any query param it does not list, so these send exactly:
// status (none), summary (period, tz), unowned (period, kind, limit),
// recent (before, limit), sync (no body).

const LISTENING_STATES = new Set<LbBotListeningState>(['error', 'importing', 'off', 'ready']);

const nullableNum = (value: unknown): null | number =>
    typeof value === 'number' && Number.isFinite(value) ? value : null;

ipcMain.handle('lbbot-listening-status', async (): Promise<LbBotResult<LbBotListeningStatus>> => {
    const result = await request('GET', '/lb/listening/status');
    if (!result.ok)
        return failed<LbBotListeningStatus>(result.status, result.error, false, {
            code: result.code,
        });
    const d: Json = result.data ?? {};
    if (!LISTENING_STATES.has(d.state as LbBotListeningState)) {
        return failed<LbBotListeningStatus>(result.status, 'lb-bot sent no listening state.');
    }
    return {
        data: {
            count: num(d.count),
            error: str(d.error),
            lastSyncAt: nullableNum(d.lastSyncAt),
            newest: nullableNum(d.newest),
            oldest: nullableNum(d.oldest),
            state: d.state as LbBotListeningState,
            total: nullableNum(d.total),
        },
        error: '',
        ok: true,
        status: result.status,
    };
});

const toDayCounts = (value: unknown): LbBotDayCount[] =>
    (Array.isArray(value) ? value : []).flatMap((row): LbBotDayCount[] => {
        if (!row || typeof row !== 'object') return [];
        const r = row as Json;
        const date = str(r.date);
        return date ? [{ count: num(r.count), date }] : [];
    });

const rowsOf = (value: unknown): Json[] =>
    (Array.isArray(value) ? value : []).filter(
        (row): row is Json => !!row && typeof row === 'object',
    );

const toTopArtist = (r: Json): LbBotTopArtist => ({
    mbid: str(r.mbid),
    name: str(r.name),
    ndArtistId: str(r.ndArtistId),
    plays: num(r.plays),
});

const toTopAlbum = (r: Json): LbBotTopAlbum => ({
    artist: str(r.artist),
    artistMbid: str(r.artistMbid),
    ndAlbumId: str(r.ndAlbumId),
    owned: r.owned === true,
    plays: num(r.plays),
    rgid: str(r.rgid),
    title: str(r.title),
});

const toTopTrack = (r: Json): LbBotTopTrack => ({
    artist: str(r.artist),
    ndAlbumId: str(r.ndAlbumId),
    plays: num(r.plays),
    recordingMbid: str(r.recordingMbid),
    rgid: str(r.rgid),
    title: str(r.title),
});

ipcMain.handle(
    'lbbot-listening-summary',
    async (
        _event,
        args: { period: string; tz: string },
    ): Promise<LbBotResult<LbBotListeningSummary>> => {
        const result = await request('GET', '/lb/listening/summary', {
            params: { period: args.period, tz: args.tz },
        });
        if (!result.ok)
            return failed<LbBotListeningSummary>(result.status, result.error, false, {
                code: result.code,
            });
        const d: Json = result.data ?? {};
        if (!d.totals || typeof d.totals !== 'object') {
            return failed<LbBotListeningSummary>(result.status, 'lb-bot sent no totals.');
        }
        const totals = d.totals as Json;
        const streak = (d.streak && typeof d.streak === 'object' ? d.streak : {}) as Json;
        const hours = Array.isArray(d.hours) ? d.hours.map(num) : [];
        return {
            data: {
                daily: toDayCounts(d.daily),
                generatedAt: num(d.generatedAt),
                genrePlays: num(d.genrePlays),
                genres: rowsOf(d.genres).map((g) => ({ genre: str(g.genre), plays: num(g.plays) })),
                heatmap: toDayCounts(d.heatmap),
                // Always 24 slots so the chart can index by hour.
                hours: Array.from({ length: 24 }, (_, hour) => hours[hour] ?? 0),
                period: str(d.period),
                streak: { current: num(streak.current), longest: num(streak.longest) },
                topAlbums: rowsOf(d.topAlbums).map(toTopAlbum),
                topArtists: rowsOf(d.topArtists).map(toTopArtist),
                topTracks: rowsOf(d.topTracks).map(toTopTrack),
                totals: {
                    albums: num(totals.albums),
                    artists: num(totals.artists),
                    plays: num(totals.plays),
                    seconds: num(totals.seconds),
                    secondsKnownFor: num(totals.secondsKnownFor),
                },
                tz: str(d.tz),
            },
            error: '',
            ok: true,
            status: result.status,
        };
    },
);

const toUnownedRow = (r: Json): LbBotUnownedRow => ({
    artist: str(r.artist),
    artistId: str(r.artistId),
    artistMbid: str(r.artistMbid),
    artistOwned: r.artistOwned === true,
    kind: str(r.kind),
    lastListenedAt: num(r.lastListenedAt),
    plays: num(r.plays),
    rgid: str(r.rgid),
    title: str(r.title),
});

ipcMain.handle(
    'lbbot-listening-unowned',
    async (
        _event,
        args: { kind: string; limit: number; period: string },
    ): Promise<LbBotResult<LbBotUnowned>> => {
        const result = await request('GET', '/lb/listening/unowned', {
            params: { kind: args.kind, limit: String(args.limit), period: args.period },
        });
        if (!result.ok)
            return failed<LbBotUnowned>(result.status, result.error, false, { code: result.code });
        const d: Json = result.data ?? {};
        return {
            data: {
                kind: str(d.kind),
                period: str(d.period),
                rows: rowsOf(d.rows).map(toUnownedRow),
            },
            error: '',
            ok: true,
            status: result.status,
        };
    },
);

const toRecentRow = (r: Json): LbBotRecentRow => ({
    artist: str(r.artist),
    artistMbid: str(r.artistMbid),
    client: str(r.client),
    listenedAt: num(r.listenedAt),
    ndAlbumId: str(r.ndAlbumId),
    ndArtistId: str(r.ndArtistId),
    recordingMbid: str(r.recordingMbid),
    release: str(r.release),
    rgid: str(r.rgid),
    track: str(r.track),
});

ipcMain.handle(
    'lbbot-listening-recent',
    async (_event, args: { before?: number; limit: number }): Promise<LbBotResult<LbBotRecent>> => {
        const result = await request('GET', '/lb/listening/recent', {
            params: {
                ...(args.before ? { before: String(args.before) } : {}),
                limit: String(args.limit),
            },
        });
        if (!result.ok)
            return failed<LbBotRecent>(result.status, result.error, false, { code: result.code });
        return {
            data: {
                nextBefore: nullableNum(result.data?.nextBefore),
                rows: rowsOf(result.data?.rows).map(toRecentRow),
            },
            error: '',
            ok: true,
            status: result.status,
        };
    },
);

// Asks lb-bot's worker to pull now and returns at once; it never waits on
// ListenBrainz. The caller watches `status` for the state to move.
ipcMain.handle('lbbot-listening-sync', async (): Promise<LbBotResult<boolean>> => {
    const result = await request('POST', '/lb/listening/sync');
    if (!result.ok)
        return failed<boolean>(result.status, result.error, false, { code: result.code });
    const ok = result.data?.ok === true;
    return {
        data: ok,
        error: ok ? '' : str(result.data?.error) || 'lb-bot refused the request.',
        ok,
        status: result.status,
    };
});

// ---------------------------------------------------------------------------
// Index change feed — the renderer's local mirror pulls these
// ---------------------------------------------------------------------------

// PLAN-lbbot-index-mirror-2026-09-23, contract §1a. The renderer keeps a full
// copy of lb-bot's library index in IndexedDB and advances it through this
// feed; these two handlers only fetch and normalize. Everything that decides
// what to *do* with a page (apply, resync, drift) lives in the renderer's
// `features/lbbot/index-mirror`, next to the store it changes.
//
// `LbBotResult`, not the fail-soft `get()`: the sync has to tell a 503 — the
// hub's one-slot sync pool is taken, back off and keep the cursor — from a 404
// (a hub too old to proxy the feed, stop asking) from a malformed answer.
//
// A page is capped at ~2 MB upstream and can take lb-bot a while to assemble on
// a first pull, but the sync runs one request at a time and a hung one would
// stall every later trigger behind it — so it gets a ceiling of its own.
const INDEX_SYNC_TIMEOUT_MS = 60_000;

/** A non-negative integer, or null — a sequence value that is anything else is
 *  a malformed answer, not a zero. */
const seqOf = (value: unknown): null | number =>
    typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;

const toIndexEnvelope = (d: Json) => ({
    epoch: str(d.epoch),
    headSeq: seqOf(d.headSeq) ?? 0,
    scanVersion: num(d.scanVersion),
    ttlDays: num(d.ttlDays),
});

const toIndexItem = (raw: unknown): LbBotIndexItem[] => {
    if (!raw || typeof raw !== 'object') return [];
    const r = raw as Json;
    const key = str(r.key);
    const seq = seqOf(r.seq);
    // Without a key and a seq an item cannot be applied or ordered; dropping it
    // is safe, because the drift check at the end of the pull will notice the
    // artist is missing and fetch it again.
    if (!key || seq === null) return [];
    if (r.type === 'tombstone') return [{ key, seq, type: 'tombstone' }];
    if (r.type !== 'artist') return [];
    return [
        {
            key,
            mbid: str(r.mbid),
            name: str(r.name),
            ndArtistId: str(r.ndArtistId),
            rows: Array.isArray(r.rows) ? r.rows.flatMap(toRelease) : [],
            scannedAt: num(r.scannedAt),
            scanVersion: num(r.scanVersion),
            seq,
            type: 'artist',
        },
    ];
};

ipcMain.handle(
    'lbbot-index-changes',
    async (
        _event,
        args: { epoch: string; since: number },
    ): Promise<LbBotResult<LbBotIndexPage>> => {
        const since = seqOf(args.since) ?? 0;
        const result = await request('GET', '/lb/index/changes', {
            // `request` drops empty params, so an empty epoch — a mirror that has
            // never synced — is simply not sent, which lb-bot reads as "no check".
            params: { epoch: args.epoch ?? '', since: String(since) },
            timeoutMs: INDEX_SYNC_TIMEOUT_MS,
        });
        if (!result.ok) return failed(result.status, result.error, result.tooLarge);
        const d = result.data ?? {};
        const envelope = toIndexEnvelope(d);
        if (!envelope.epoch)
            return failed(result.status, 'lb-bot answered without an index epoch.');
        if (d.resync === true) {
            return {
                data: { ...envelope, resync: true },
                error: '',
                ok: true,
                status: result.status,
            };
        }
        const nextSince = seqOf(d.nextSince);
        if (!Array.isArray(d.items) || nextSince === null) {
            return failed(result.status, 'lb-bot answered a malformed index page.');
        }
        return {
            data: {
                ...envelope,
                artistCount: seqOf(d.artistCount) ?? 0,
                items: d.items.flatMap(toIndexItem),
                more: d.more === true,
                nextSince,
                resync: false,
                seqSum: seqOf(d.seqSum) ?? 0,
            },
            error: '',
            ok: true,
            status: result.status,
        };
    },
);

ipcMain.handle('lbbot-index-keys', async (): Promise<LbBotResult<LbBotIndexKeys>> => {
    const result = await request('GET', '/lb/index/keys', { timeoutMs: INDEX_SYNC_TIMEOUT_MS });
    if (!result.ok) return failed(result.status, result.error, false, { code: result.code });
    const d = result.data ?? {};
    const epoch = str(d.epoch);
    if (!epoch || !Array.isArray(d.keys)) {
        return failed(result.status, 'lb-bot answered a malformed index key list.');
    }
    const keys = d.keys.flatMap((raw: unknown) => {
        if (!raw || typeof raw !== 'object') return [];
        const key = str((raw as Json).key);
        const seq = seqOf((raw as Json).seq);
        return key && seq !== null ? [{ key, seq }] : [];
    });
    return {
        data: { epoch, headSeq: seqOf(d.headSeq) ?? 0, keys },
        error: '',
        ok: true,
        status: result.status,
    };
});

// ---------------------------------------------------------------------------
// Fresh releases
// ---------------------------------------------------------------------------

// Site-wide, not per-artist: ListenBrainz's own fresh-releases feed, enriched by
// lb-bot with two *independent* ownership signals. `artistOwned` (+ `artistId`)
// says the artist is in the library; `releaseOwned` says this release-group is
// already on disk. Conflating them would hide every new album by an artist you
// already have, which is exactly the set this page exists for. lb-bot's `owned`
// alias for `artistOwned` is dropped here so nothing downstream can read it.
//
// `releaseAlbumId` is the Navidrome album behind `releaseOwned`. Without it a
// tile badged "In library" could only be sent to the virtual album page and left
// to redirect itself — which cannot work for an album lb-bot filled, since
// nothing on the placement path writes the album ids that redirect reads.
//
// Fail-soft like the discography read: ListenBrainz being down answers null and
// the tab says so, rather than erroring.
//
// How many rows to ask for. The page filters and buckets client-side, so this
// only has to be comfortably more than anyone scrolls; lb-bot keeps every row
// whose artist is in the library regardless of the limit, so nothing you care
// about is cut to make room.
const FRESH_LIMIT = 400;

ipcMain.handle(
    'lbbot-fresh-releases',
    async (_event, args: { days?: number }): Promise<LbBotFreshFeed | null> => {
        // `limit` is not optional in practice. Unbounded, this route answers with
        // the entire site-wide ListenBrainz window, which runs past the hub's 4 MB
        // response ceiling — and that ceiling used to truncate silently at HTTP
        // 200, so `res.json()` threw, the body became `{}`, and this returned null
        // with nothing in the log to say why. The tab simply showed no rows.
        const data = await get('/lb/fresh-releases', {
            days: String(args.days ?? 30),
            limit: String(FRESH_LIMIT),
        });
        if (!data || !Array.isArray(data.releases)) return null;
        const releases = data.releases.flatMap((row): LbBotFreshRelease[] => {
            if (!row || typeof row !== 'object') return [];
            const r = row as Json;
            return [
                {
                    artist: str(r.artist),
                    artistId: str(r.artistId),
                    artistMbids: strList(r.artistMbids),
                    artistOwned: r.artistOwned === true,
                    // I-006 rider: absent from an older lb-bot, and absent is not 0.
                    ...(typeof r.artistPlays === 'number' ? { artistPlays: r.artistPlays } : {}),
                    coverUrl: str(r.coverUrl),
                    releaseAlbumId: str(r.releaseAlbumId),
                    releaseDate: str(r.releaseDate),
                    releaseGroupMbid: str(r.releaseGroupMbid),
                    releaseMbid: str(r.releaseMbid),
                    releaseName: str(r.releaseName),
                    releaseOwned: r.releaseOwned === true,
                    secondaryType: str(r.secondaryType),
                    type: str(r.type),
                },
            ];
        });
        // `total` is what lb-bot had before its own cut, so the page can say
        // "showing N of M" rather than implying the feed is this small.
        return {
            releases,
            total: num(data.total) || releases.length,
            truncated: data.truncated === true,
        };
    },
);

// ---------------------------------------------------------------------------
// Editorial metadata — artist/album "About", credits, relations, links
// ---------------------------------------------------------------------------
//
// lb-bot resolves MusicBrainz url-relations -> Wikidata -> Wikipedia and caches
// the answer for 30 days; the hub caches it again for six hours. So this is a
// cheap call in the steady state and a slow one exactly once per entity.
//
// Fail-soft twice over, and the distinction matters to the UI: null means we
// could not ask (no hub, lb-bot down) and the section must not render at all,
// while a shape with `found: false` means we asked and nobody has written about
// this — also nothing rendered, but the fallback to Navidrome's Last.fm bio is
// only correct in the second case... and in practice both end up there, because
// the fallback is what the page did before this existed.

const toMetaLink = (row: unknown): LbBotMetaLink[] => {
    if (!row || typeof row !== 'object') return [];
    const r = row as Json;
    const url = str(r.url);
    if (!url) return [];
    return [{ label: str(r.label), type: str(r.type), url }];
};

const toMetaRelation = (row: unknown): LbBotMetaRelation[] => {
    if (!row || typeof row !== 'object') return [];
    const r = row as Json;
    const name = str(r.name);
    if (!name) return [];
    return [
        {
            // lb-bot goes to real trouble to compute and merge these; dropping
            // them here is what left the members list a bare row of names.
            attributes: Array.isArray(r.attributes) ? r.attributes.map(str).filter(Boolean) : [],
            begin: str(r.begin),
            direction: str(r.direction),
            end: str(r.end),
            ended: r.ended === true,
            mbid: str(r.mbid),
            name,
            type: str(r.type),
        },
    ];
};

const toMetaCredit = (row: unknown): LbBotMetaCredit[] => {
    if (!row || typeof row !== 'object') return [];
    const r = row as Json;
    const name = str(r.name);
    const roles = Array.isArray(r.roles) ? r.roles.map(str).filter(Boolean) : [];
    if (!name || roles.length === 0) return [];
    return [{ mbid: str(r.mbid), name, roles }];
};

const toMeta = (data: Json): LbBotMeta => {
    const rawSource = (data.source ?? null) as Json | null;
    const sourceUrl = rawSource ? str(rawSource.url) : '';
    const relations = (data.relations ?? {}) as Json;
    const paragraphs = Array.isArray(data.paragraphs)
        ? data.paragraphs.map(str).filter(Boolean)
        : [];
    return {
        credits: Array.isArray(data.credits) ? data.credits.flatMap(toMetaCredit) : [],
        // Worbus P1: kept absent when lb-bot sent no key, so a persisted body can tell "never
        // asked" from "asked, nothing" (the renderer re-asks the first once per session).
        ...(Array.isArray(data.findIt) ? { findIt: toFindIt(data.findIt) } : {}),
        found: data.found === true,
        imageUrl: str(data.imageUrl),
        links: Array.isArray(data.links) ? data.links.flatMap(toMetaLink) : [],
        paragraphs,
        relations: {
            members: Array.isArray(relations.members)
                ? relations.members.flatMap(toMetaRelation)
                : [],
            related: Array.isArray(relations.related)
                ? relations.related.flatMap(toMetaRelation)
                : [],
        },
        // No URL means no attribution to render, which means the text is not
        // safe to show under CC BY-SA. Normalized to null so the renderer has
        // one thing to check rather than three.
        source: sourceUrl
            ? {
                  license: str(rawSource?.license),
                  name: str(rawSource?.name),
                  title: str(rawSource?.title),
                  url: sourceUrl,
              }
            : null,
        summary: str(data.summary) || paragraphs[0] || '',
        wikidataDescription: str(data.wikidataDescription),
    };
};

ipcMain.handle(
    'lbbot-meta-artist',
    async (_event, args: { mbid?: string; name?: string }): Promise<LbBotMeta | null> => {
        // `name` costs lb-bot an extra MusicBrainz search and takes the first
        // hit, so the MBID is always preferred when Navidrome carries one.
        const params: Record<string, string> = {};
        if (args.mbid) params.mbid = args.mbid;
        else if (args.name) params.name = args.name;
        else return null;
        const data = await get('/lb/meta/artist', params);
        return data ? toMeta(data) : null;
    },
);

ipcMain.handle(
    'lbbot-meta-album',
    async (_event, args: { releaseMbid?: string; rgid: string }): Promise<LbBotMeta | null> => {
        if (!args.rgid) return null;
        const params: Record<string, string> = { rgid: args.rgid };
        // Saves lb-bot the canonical-release resolution — two rate-limited
        // MusicBrainz seconds — when the caller already knows the release.
        if (args.releaseMbid) params.release_mbid = args.releaseMbid;
        const data = await get('/lb/meta/album', params);
        return data ? toMeta(data) : null;
    },
);

// I-020 "Refresh About": the same two reads with `refresh=1` (the hub allowlists
// it and bypasses its own cache and lb-bot's 30-day one), but result-shaped: the
// button has to tell "could not reach lb-bot" and "lb-bot answered an error" from
// a successful answer, which the fail-soft reads above collapse to null.
ipcMain.handle(
    'lbbot-meta-refresh',
    async (
        _event,
        args: {
            kind: 'album' | 'artist';
            mbid?: string;
            name?: string;
            releaseMbid?: string;
            rgid?: string;
        },
    ): Promise<LbBotResult<LbBotMeta>> => {
        const params: Record<string, string> = { refresh: '1' };
        if (args.kind === 'artist') {
            if (args.mbid) params.mbid = args.mbid;
            else if (args.name) params.name = args.name;
            else return failed<LbBotMeta>(0, 'No artist to refresh.');
        } else {
            if (!args.rgid) return failed<LbBotMeta>(0, 'No album to refresh.');
            params.rgid = args.rgid;
            if (args.releaseMbid) params.release_mbid = args.releaseMbid;
        }
        const result = await request('GET', `/lb/meta/${args.kind}`, { params });
        if (!result.ok) {
            return failed<LbBotMeta>(result.status, result.error, false, { code: result.code });
        }
        // A 200 whose body held nothing (empty / unparseable -> `{}`) is not an
        // answer: null data, so the caller keeps what it shows.
        const body = result.data ?? {};
        return {
            data: hasMetaFields(body) ? toMeta(body) : null,
            error: '',
            ok: true,
            status: result.status,
        };
    },
);

// ---------------------------------------------------------------------------
// Missing-album detail + download
// ---------------------------------------------------------------------------

const toEdition = (row: unknown): LbBotEdition[] => {
    if (!row || typeof row !== 'object') return [];
    const r = row as Json;
    return [
        {
            country: str(r.country),
            coverUrl: str(r.coverUrl),
            format: str(r.format),
            label: str(r.label),
            releaseMbid: str(r.releaseMbid),
            year: str(r.year),
        },
    ];
};

const toVariant = (row: unknown): LbBotVariant[] => {
    if (!row || typeof row !== 'object') return [];
    const r = row as Json;
    const editions = Array.isArray(r.editions) ? r.editions.flatMap(toEdition) : [];
    return [
        {
            coverUrl: str(r.coverUrl),
            disambiguation: str(r.disambiguation),
            editions,
            releaseMbid: str(r.releaseMbid),
            title: str(r.title),
            trackCount: num(r.trackCount),
            year: str(r.year),
        },
    ];
};

// Unlike the discography read, this one sits on a rate-limited MusicBrainz call
// upstream. The hub caches it for hours (the editions of a release do not
// change), but a cold call can take seconds — the sheet must show a skeleton.
ipcMain.handle(
    'lbbot-album-releases',
    async (_event, args: { rgid: string }): Promise<LbBotReleaseDetail | null> => {
        if (!args.rgid) return null;
        const data = await get('/lb/album/releases', { rgid: args.rgid });
        if (!data) return null;
        const releases = Array.isArray(data.releases) ? data.releases : [];
        return {
            artist: str(data.artist),
            // The one field on this route that is not about the release. It is
            // here because it is the only place an album page reached from a
            // Deezer row can learn its artist's identity at all — see the field
            // doc in `lbbot-types.ts`.
            artistMbid: str(data.artistMbid),
            coverUrl: str(data.coverUrl),
            title: str(data.title),
            variants: releases.flatMap(toVariant),
        };
    },
);

// `presenceKnown` is false for an album the library holds nothing of — which is
// the normal case here. Every track is missing; that is not an error state.
ipcMain.handle(
    'lbbot-album-tracklist',
    async (
        _event,
        args: { albumIds?: string[]; releaseMbid: string },
    ): Promise<LbBotTracklist | null> => {
        if (!args.releaseMbid) return null;
        const data = await get('/lb/album/tracklist', {
            album_ids: (args.albumIds ?? []).join(','),
            release_mbid: args.releaseMbid,
        });
        if (!data) return null;
        const rows = Array.isArray(data.tracks) ? data.tracks : [];
        const presenceKnown = data.presenceKnown === true;
        return {
            presenceKnown,
            tracks: rows.flatMap((row): LbBotTrack[] => {
                if (!row || typeof row !== 'object') return [];
                const r = row as Json;
                return [
                    {
                        position: num(r.position),
                        present: presenceKnown ? r.present === true : undefined,
                        title: str(r.title),
                    },
                ];
            }),
        };
    },
);

// MusicBrainz artist search, so a client's own search can offer a "Not in your
// library" section. Until this was whitelisted a remote client could only reach
// an external artist page if it already held an MBID from a Fresh row — which is
// what blocked every acquisition path that starts with "I want this artist".
ipcMain.handle(
    'lbbot-artist-lookup',
    async (_event, args: { q: string }): Promise<LbBotArtistCandidate[]> => {
        const q = (args.q ?? '').trim();
        if (!q) return [];
        const data = await get('/lb/artist/lookup', { q });
        const rows = Array.isArray(data?.candidates) ? data.candidates : [];
        return rows.flatMap((row): LbBotArtistCandidate[] => {
            if (!row || typeof row !== 'object') return [];
            const r = row as Json;
            const mbid = str(r.mbid);
            if (!mbid) return [];
            return [
                {
                    country: str(r.country),
                    disambiguation: str(r.disambiguation),
                    mbid,
                    name: str(r.name),
                    score: num(r.score),
                    type: str(r.type),
                },
            ];
        });
    },
);

// The picker's lookup (I-019), result-shaped: an error line (lb-bot answers 502
// `retryable` when MusicBrainz did not answer) must not read as "no artists
// found", which the fail-soft lookup above cannot tell apart.
ipcMain.handle(
    'lbbot-artist-search',
    async (_event, args: { q: string }): Promise<LbBotResult<LbBotArtistCandidate[]>> => {
        const q = (args.q ?? '').trim();
        if (!q) return { data: [], error: '', ok: true, status: 200 };
        const result = await request('GET', '/lb/artist/lookup', { params: { q } });
        if (!result.ok)
            return failed<LbBotArtistCandidate[]>(result.status, result.error, false, {
                code: result.code,
            });
        if (!Array.isArray(result.data?.candidates)) {
            return failed<LbBotArtistCandidate[]>(result.status, 'lb-bot sent no candidate list.');
        }
        return {
            data: result.data.candidates.flatMap((row): LbBotArtistCandidate[] => {
                if (!row || typeof row !== 'object') return [];
                const r = row as Json;
                const mbid = str(r.mbid);
                if (!mbid) return [];
                return [
                    {
                        country: str(r.country),
                        disambiguation: str(r.disambiguation),
                        mbid,
                        name: str(r.name),
                        score: num(r.score),
                        type: str(r.type),
                    },
                ];
            }),
            error: '',
            ok: true,
            status: result.status,
        };
    },
);

// MusicBrainz album search, the other half of "Not in your library". Unlike the
// artist route this answer carries ownership per candidate, marked by
// release-group id rather than by a name match — so the renderer can show an
// owned hit as a library row that opens the album instead of offering to fetch
// a record already on disk.
const toAlbumCandidates = (data: Json | null): LbBotAlbumCandidate[] => {
    const rows = Array.isArray(data?.candidates) ? data.candidates : [];
    return rows.flatMap((row): LbBotAlbumCandidate[] => {
        if (!row || typeof row !== 'object') return [];
        const r = row as Json;
        const rgid = str(r.rgid);
        if (!rgid) return [];
        return [
            {
                artist: str(r.artist),
                coverUrl: str(r.coverUrl),
                primaryType: str(r.primary_type),
                releaseAlbumId: str(r.releaseAlbumId),
                releaseOwned: r.releaseOwned === true,
                rgid,
                score: num(r.score),
                title: str(r.title),
                year: str(r.year),
            },
        ];
    });
};

ipcMain.handle(
    'lbbot-album-lookup',
    async (_event, args: { q: string }): Promise<LbBotAlbumCandidate[]> => {
        const q = (args.q ?? '').trim();
        if (!q) return [];
        return toAlbumCandidates(await get('/lb/album/lookup', { q }));
    },
);

// The same lookup for a caller that must tell "lb-bot found nothing" from "the
// lookup failed" (the Fix album match release-group fallback): a failure is not an
// empty answer and must not be kept as one.
ipcMain.handle(
    'lbbot-album-lookup-checked',
    async (_event, args: { q: string }): Promise<LbBotResult<LbBotAlbumCandidate[]>> => {
        const q = (args.q ?? '').trim();
        if (!q) return { data: [], error: '', ok: true, status: 200 };
        const result = await request('GET', '/lb/album/lookup', { params: { q } });
        if (!result.ok)
            return failed<LbBotAlbumCandidate[]>(result.status, result.error, false, {
                code: result.code,
            });
        return {
            data: toAlbumCandidates(result.data),
            error: '',
            ok: true,
            status: result.status,
        };
    },
);

// "Similar albums": shipped end to end in lb-bot and the hub and consumed by
// nobody until now — it was step 5 of DESIGN-lbbot-client-integration.md, left
// unticked when the Fresh half landed.
//
// Every row is an album the library already holds, so this is a rediscovery
// shelf rather than a shopping list, and `because` names the artist that
// justifies it. Rows are keyed by release-group only (lb-bot picks them out of
// its discography index), so the renderer routes through the external album
// page and lets it redirect to the library album.
const toSimilarAlbum = (row: unknown): LbBotSimilarAlbum[] => {
    if (!row || typeof row !== 'object') return [];
    const r = row as Json;
    const rgid = str(r.rgid);
    if (!rgid) return [];
    return [
        {
            albumId: str(r.albumId),
            artist: str(r.artist),
            artistId: str(r.artistId),
            because: str(r.because),
            coverUrl: str(r.coverUrl),
            rgid,
            sources: Array.isArray(r.sources) ? r.sources.map(str).filter(Boolean) : [],
            status: (str(r.status) || 'missing') as LbBotReleaseStatus,
            title: str(r.title),
            year: str(r.year),
        },
    ];
};

ipcMain.handle(
    'lbbot-album-similar',
    async (
        _event,
        args: { artistMbid?: string; artistName?: string; limit?: number; rgid?: string },
    ): Promise<LbBotSimilarAlbums | null> => {
        if (!args.artistMbid && !args.artistName) return null;
        const params: Record<string, string> = { limit: String(args.limit ?? 6) };
        if (args.artistMbid) params.artist_mbid = args.artistMbid;
        if (args.artistName) params.artist_name = args.artistName;
        // Excluding the album you are looking at is lb-bot's job, not a filter
        // here: it picks one album per similar artist, so dropping a row
        // afterwards would silently shorten the shelf instead of backfilling it.
        if (args.rgid) params.rgid = args.rgid;
        const data = await get('/lb/album/similar', params);
        if (!data) return null;
        const albums = Array.isArray(data.albums) ? data.albums.flatMap(toSimilarAlbum) : [];
        return {
            albums,
            because: str(data.because),
            sources: Array.isArray(data.sources) ? data.sources.map(str).filter(Boolean) : [],
        };
    },
);

// "Fans also like", and unlike the album shelf above this one is a shopping
// list: lb-bot marks ownership on each row instead of filtering on it, so the
// artists you do NOT have are the point. `owned` and `indexed` are separate
// facts — an artist can be in the library and never have been indexed, and the
// renderer offers a different action for each.
const toSimilarArtist = (row: unknown): LbBotSimilarArtist[] => {
    if (!row || typeof row !== 'object') return [];
    const r = row as Json;
    const name = str(r.name);
    const mbid = str(r.mbid);
    // Without one of the two there is nothing to render and nowhere to go: the
    // external page is keyed by MBID and the library page by artist id.
    if (!name && !mbid) return [];
    return [
        {
            artistId: str(r.artistId),
            indexed: r.indexed === true,
            mbid,
            name,
            owned: r.owned === true,
            score: num(r.score),
            sources: Array.isArray(r.sources) ? r.sources.map(str).filter(Boolean) : [],
        },
    ];
};

ipcMain.handle(
    'lbbot-artist-similar',
    async (
        _event,
        args: { limit?: number; mbid?: string; name?: string },
    ): Promise<LbBotSimilarArtists | null> => {
        if (!args.mbid && !args.name) return null;
        const params: Record<string, string> = { limit: String(args.limit ?? 20) };
        if (args.mbid) params.mbid = args.mbid;
        if (args.name) params.name = args.name;
        const data = await get('/lb/artist/similar', params);
        if (!data) return null;
        return {
            artists: Array.isArray(data.artists) ? data.artists.flatMap(toSimilarArtist) : [],
            because: str(data.because),
            sources: Array.isArray(data.sources) ? data.sources.map(str).filter(Boolean) : [],
        };
    },
);

/** Every failure kind lb-bot actually emits. Anything else is normalized away
 *  rather than passed through: the renderer switches on this to choose a label
 *  and a button, and an unknown string would silently fall through both. */
const FAILURE_KINDS = new Set<LbBotFailureKind>([
    'format_rejected',
    'mb_unavailable',
    'no_source',
    'placement_failed',
    'transfer_failed',
]);

const toFailureKind = (value: unknown): LbBotFailureKind => {
    const kind = str(value) as LbBotFailureKind;
    return FAILURE_KINDS.has(kind) ? kind : '';
};

const UNKNOWN_STATUS: LbBotFillStatus = {
    activeFiles: 0,
    album: '',
    allowMp3: false,
    artist: '',
    attempts: 0,
    bytesDone: 0,
    bytesTotal: 0,
    cancellable: false,
    done: 0,
    failed: 0,
    failureKind: '',
    groupId: '',
    mp3WouldHelp: false,
    percent: 0,
    quality: '',
    reason: '',
    releaseMbid: '',
    retryable: false,
    retryAt: 0,
    rgid: '',
    serverTime: 0,
    source: '',
    speedBps: 0,
    state: 'unknown',
    total: 0,
    updatedAt: 0,
    verifyGaveUp: false,
};

const FILL_STATES = new Set<LbBotFillState>([
    'cancelled',
    'downloading',
    'failed',
    'needs_match',
    'placed',
    'placing',
    'queued',
    'searching',
    'unknown',
    'verified',
]);

/** Normalize one status body — also the `fill` frame's album shape, which the
 *  renderer runs through the same rules (see `fillFrameToStatus`). */
export const toFillStatus = (data: Json | null): LbBotFillStatus => {
    if (!data) return UNKNOWN_STATUS;
    // An lb-bot from before `cancelled` was a state of its own wrote a cancel
    // as `failed` + `failureKind: 'cancelled'`; read both for one cycle.
    const rawState = str(data.state) || 'unknown';
    const legacyCancel = rawState === 'failed' && str(data.failureKind) === 'cancelled';
    const state = legacyCancel
        ? 'cancelled'
        : ((FILL_STATES.has(rawState as LbBotFillState) ? rawState : 'unknown') as LbBotFillState);
    // The Cancel rule: from the server when it states one, else the states it
    // would state for an older lb-bot.
    const cancellable =
        typeof data.cancellable === 'boolean'
            ? data.cancellable
            : state === 'searching' || state === 'queued' || state === 'downloading';
    return {
        activeFiles: num(data.activeFiles),
        album: str(data.album),
        // B-084: a key lb-bot did not send stays absent - not false, not 0.
        ...(typeof data.allFiles === 'boolean' ? { allFiles: data.allFiles } : {}),
        allowMp3: data.allowMp3 === true,
        artist: str(data.artist),
        attempts: num(data.attempts),
        bytesDone: num(data.bytesDone),
        bytesTotal: num(data.bytesTotal),
        cancellable,
        done: num(data.done),
        failed: num(data.failed),
        failureKind: legacyCancel ? '' : toFailureKind(data.failureKind),
        groupId: str(data.groupId),
        ...(typeof data.leftOut === 'number' && Number.isFinite(data.leftOut)
            ? { leftOut: data.leftOut }
            : {}),
        mp3WouldHelp: data.mp3WouldHelp === true,
        percent: num(data.percent),
        quality: str(data.quality),
        reason: str(data.reason),
        releaseMbid: str(data.releaseMbid),
        // An lb-bot that predates the field sends nothing, which reads as false —
        // and the renderer treats "no failureKind" as unknown-so-offer-Retry, so
        // an older service does not lose the button.
        retryable: legacyCancel ? false : data.retryable === true,
        retryAt: num(data.retryAt),
        rgid: str(data.rgid),
        serverTime: num(data.serverTime),
        source: str(data.source),
        speedBps: num(data.speedBps),
        state,
        total: num(data.total),
        updatedAt: num(data.updatedAt),
        verifyGaveUp: data.verifyGaveUp === true,
    };
};

// Idempotent per release-group on lb-bot's side: tapping Download twice (or from
// two devices) returns the fill already in flight instead of starting a second
// search, a second set of transfers and a second placement pass over one folder.
ipcMain.handle(
    'lbbot-download-album',
    async (
        _event,
        args: {
            /** B-084: ask the picked folder for every audio file in it (needs a source). */
            allFiles?: boolean;
            /** Widen this one album's search to MP3 — the whole-album counterpart
             *  of a gap group's opt-in, for a `format_rejected` fill with no group. */
            allowMp3?: boolean;
            artist?: string;
            /** Peers that already failed or crawled for this album — "try another source". */
            excludeUsers?: string[];
            quality?: string;
            releaseMbid?: string;
            rgid: string;
            sourceFolder?: string;
            sourceUsername?: string;
            title?: string;
            totalTracks?: number;
        },
    ): Promise<LbBotDownloadResult> => {
        if (!args.rgid) {
            return { error: 'No release', existing: false, ok: false, releaseMbid: '', status: 0 };
        }
        // An empty quality is omitted rather than sent: lb-bot reads "" as "use
        // the global Source preference", and sending the key at all would make
        // this download look like an override in its own status view. Same for
        // the chosen source — absent means "let lb-bot rank".
        const result = await request('POST', '/lb/album/download', {
            body: albumDownloadBody(args),
        });
        const data = result.data;
        const resolved = (data?.resolved ?? {}) as Json;
        const ok = result.ok && data?.ok === true;
        const code = ok ? '' : result.code || str(data?.code);
        return {
            // B-084: the echo of `allFiles`; absent stays undefined (an older hub or lb-bot).
            ...(typeof data?.allFiles === 'boolean' ? { allFiles: data.allFiles } : {}),
            ...(code ? { code } : {}),
            // A 200 carrying `ok: false` is lb-bot refusing for its own reason —
            // which it states in `error`, and which is the sentence worth showing.
            error: ok ? '' : result.error || str(data?.error) || 'lb-bot refused the download.',
            existing: data?.existing === true,
            ok,
            releaseMbid: str(resolved.release_mbid),
            status: result.status,
        };
    },
);

// The progress poll. Deliberately not the task id from the download call: that
// task completes the moment slskd accepts the enqueue, roughly a minute before
// anything reaches the library. Poll only while a relevant view is open, and no
// faster than the hub's cache TTL.
//
// A *result*, not a bare status: this used to collapse every failure — hub down,
// 502, timeout — into `unknown`, which is a real lb-bot answer meaning "nothing
// is filling this". The renderer then could not tell "can't reach lb-bot" from
// "lb-bot forgot this fill", and showed the last state forever for both.
ipcMain.handle(
    'lbbot-album-status',
    async (
        _event,
        args: { releaseMbid?: string; rgid?: string },
    ): Promise<LbBotResult<LbBotFillStatus>> => {
        if (!args.releaseMbid && !args.rgid) return failed(0, 'No release');
        const result = await request('GET', '/lb/album/status', {
            params: {
                release_mbid: args.releaseMbid ?? '',
                rgid: args.rgid ?? '',
            },
            timeoutMs: POLL_TIMEOUT_MS,
        });
        if (!result.ok) return failed(result.status, result.error, false, { code: result.code });
        return { data: toFillStatus(result.data), error: '', ok: true, status: result.status };
    },
);

// Every watched fill in one read. A downloads view with eight rows used to
// poll eight times per tick through the hub's four proxy slots; this is one
// request, on the hub's fast pool, that never queues behind a source search.
ipcMain.handle(
    'lbbot-fills',
    async (
        _event,
        args: { groupIds: string[]; releaseMbids: string[] },
    ): Promise<LbBotResult<LbBotFills>> => {
        const releaseMbids = (args.releaseMbids ?? []).filter(Boolean).slice(0, 32);
        const groupIds = (args.groupIds ?? []).filter(Boolean).slice(0, 32);
        if (releaseMbids.length === 0 && groupIds.length === 0) {
            return {
                data: { albums: {}, gaps: {}, serverTime: 0 },
                error: '',
                ok: true,
                status: 200,
            };
        }
        const result = await request('GET', '/lb/fills', {
            params: { group_ids: groupIds.join(','), release_mbids: releaseMbids.join(',') },
            timeoutMs: POLL_TIMEOUT_MS,
        });
        if (!result.ok) return failed(result.status, result.error, false, { code: result.code });
        const d = result.data ?? {};
        const albums: Record<string, LbBotFillStatus> = {};
        const rawAlbums = (d.albums ?? {}) as Record<string, Json>;
        for (const [mbid, body] of Object.entries(rawAlbums)) {
            if (body && typeof body === 'object') albums[mbid] = toFillStatus(body);
        }
        const gaps: Record<string, LbBotGap> = {};
        const rawGaps = (d.gaps ?? {}) as Record<string, Json>;
        for (const [gid, body] of Object.entries(rawGaps)) {
            if (body && typeof body === 'object') gaps[gid] = toGap(body, gid);
        }
        return {
            data: { albums, gaps, serverTime: num(d.serverTime) },
            error: '',
            ok: true,
            status: result.status,
        };
    },
);

// Stop one album fill wherever it has got to — searching, queued or transferring.
// lb-bot records it as a retryable `cancelled` failure, which is what lets the row
// offer Retry at all; before this the only cancel was slskd's own UI, and lb-bot
// read that as a transfer failure and re-queued the album from another peer.
ipcMain.handle(
    'lbbot-cancel-album',
    async (
        _event,
        args: { releaseMbid: string },
    ): Promise<{ cancelled: boolean; code?: string; ok: boolean; status: LbBotFillStatus }> => {
        if (!args.releaseMbid) return { cancelled: false, ok: false, status: UNKNOWN_STATUS };
        const result = await request('POST', '/lb/album/cancel', {
            body: { release_mbid: args.releaseMbid },
        });
        const data = result.data;
        return {
            // `false` with `ok` is lb-bot saying "too late" — the files are
            // being placed — or "nothing was running". The status says which.
            cancelled: data?.cancelled === true,
            // Worbus P1: the refusal's code, so the renderer applies it from this answer too.
            code: result.code,
            ok: result.ok && data?.ok === true,
            status: toFillStatus((data?.status ?? null) as Json | null),
        };
    },
);

// Widens the accepted formats for one album's searches only — lb-bot's global
// policy stays flac/opus. Offered only when a failure reported `mp3WouldHelp`
// and lb-bot has a review group for the album to hang the flag on.
ipcMain.handle(
    'lbbot-allow-mp3',
    async (_event, args: { allow?: boolean; groupId: string }): Promise<boolean> => {
        if (!args.groupId) return false;
        const { data } = await request('POST', '/lb/album/allow-mp3', {
            body: { allow: args.allow !== false, group_id: args.groupId },
        });
        return data?.ok === true;
    },
);

// ---------------------------------------------------------------------------
// Source review — shared by the album download (§3) and gap filling (§4)
// ---------------------------------------------------------------------------
//
// One set of normalizers, because the two flows show the same thing: lb-bot's
// ranked Soulseek folders, each paired against a canonical tracklist. The only
// difference is where the files come from — `/lb/album/sources` carries them
// inline, `/lb/gap` has them stripped by the hub and needs `gapSourceFiles`.

const strList = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

const toCoverage = (value: unknown): LbBotSourceCoverage => {
    const r = (value ?? {}) as Json;
    return {
        haveTracks: num(r.haveTracks),
        totalTracks: num(r.totalTracks),
        unmatched: strList(r.unmatched),
    };
};

const toSourceFile = (row: unknown): LbBotSourceFile[] => {
    if (!row || typeof row !== 'object') return [];
    const r = row as Json;
    const match = r.matchedTo;
    return [
        {
            accepted: r.accepted !== false,
            bitrate: num(r.bitrate),
            durationSec: num(r.durationSec),
            ext: str(r.ext),
            filename: str(r.filename),
            // Null is meaningful, not missing: a file matching no tracklist slot
            // is the tell that a folder is the wrong album however plausible its
            // name reads. Never collapse it to an empty object.
            matchedTo:
                match && typeof match === 'object'
                    ? {
                          basis: str((match as Json).basis),
                          position: str((match as Json).position),
                          title: str((match as Json).title),
                      }
                    : null,
            sizeMb: num(r.sizeMb),
        },
    ];
};

const toSource = (row: unknown): LbBotGapSource[] => {
    if (!row || typeof row !== 'object') return [];
    const r = row as Json;
    return [
        {
            albumMatch: num(r.albumMatch),
            albumMatchOk: r.albumMatchOk === true,
            // B-019: a missing field is lb-bot's own `True` default — verified.
            artistVerified: r.artistVerified !== false,
            bitrate: str(r.bitrate),
            coverage: str(r.coverage),
            coverageDetail: toCoverage(r.coverageDetail),
            coverageFull: r.coverageFull === true,
            // B-084: absent stays absent (unknown), never 0 - and a gap-fill row has none.
            ...(typeof r.extraFiles === 'number' && Number.isFinite(r.extraFiles)
                ? { extraFiles: r.extraFiles }
                : {}),
            fileCount: num(r.fileCount),
            files: Array.isArray(r.files) ? r.files.flatMap(toSourceFile) : [],
            filesTruncated: r.filesTruncated === true,
            flags: strList(r.flags),
            folder: str(r.folder),
            format: str(r.format),
            freeSlot: r.freeSlot === true,
            id: num(r.id),
            peer: str(r.peer),
            queueLength: num(r.queueLength),
            rank: num(r.rank),
            recommendation: str(r.recommendation),
            recommended: r.recommended === true,
            score: num(r.score),
            size: str(r.size),
            speedMbps: num(r.speedMbps),
        },
    ];
};

// The route no client ever called, and the one that makes a download reviewable.
// Coverage here is computed against the canonical MusicBrainz tracklist rather
// than a file count — lb-bot's own comment records that the count-based version
// "reported a folder holding a completely different album as a complete match".
//
// Slow on purpose: a live slskd fan-out, 30-90s. The hub gives it the long
// timeout and a short cache so re-opening the modal doesn't start another search.
// Unlike the gap poll this is NOT stripped, so the per-file evidence rides along
// with the search and needs no second call.
ipcMain.handle(
    'lbbot-album-sources',
    async (
        _event,
        args: {
            album?: string;
            artist?: string;
            refresh?: boolean;
            releaseMbid?: string;
            rgid: string;
            total?: number;
        },
    ): Promise<LbBotResult<LbBotGapSource[]>> => {
        if (!args.rgid) return failed(0, 'No release');
        const result = await request('GET', '/lb/album/sources', {
            params: albumSourcesParams({ ...args, refresh: args.refresh === true }),
        });
        if (!result.ok) {
            return failed(result.status, result.error, false, { code: result.code });
        }
        const rows = Array.isArray(result.data?.sources) ? result.data.sources : [];
        return { data: rows.flatMap(toSource), error: '', ok: true, status: result.status };
    },
);

// ---------------------------------------------------------------------------
// Gap filling
// ---------------------------------------------------------------------------

const toGapTrack = (row: unknown): LbBotGapTrack[] => {
    if (!row || typeof row !== 'object') return [];
    const r = row as Json;
    return [
        {
            // B-071: a missing field (an lb-bot older than S-022) is 0, "not known".
            disc: num(r.disc),
            downloadError: str(r.downloadError),
            position: num(r.position),
            state: (str(r.state) || 'missing') as LbBotGapTrackState,
            title: str(r.title),
        },
    ];
};

const toGapTask = (value: unknown): LbBotGapTask | null => {
    if (!value || typeof value !== 'object') return null;
    const r = value as Json;
    return {
        current: str(r.current),
        error: str(r.error),
        id: str(r.id),
        label: str(r.label),
        status: str(r.status),
        summary: str(r.summary),
    };
};

// One review group: the tracklist with per-track state, the ranked sources, and
// the running search. Never cached by the hub, and `sources[].files` is stripped
// there — that listing is fetched per source, on demand, below.
//
// Deliberately NOT /api/tasks or /api/gaps: both deep-copy lb-bot's entire
// multi-MB review state under its process-wide lock, and neither is whitelisted.
// Everything a client needs about a running search is `sourceTask` here.
const toGap = (d: Json, groupId: string): LbBotGap => ({
    album: str(d.album),
    albumId: str(d.albumId),
    allowMp3: d.allowMp3 === true,
    artist: str(d.artist),
    // lb-bot sends the album artist's Navidrome id; "Wrong edition?" falls back to that page.
    artistId: str(d.artistId),
    canonicalMbid: str(d.canonicalMbid),
    extra: num(d.extra),
    failDetail: str(d.failDetail),
    failReason: str(d.failReason),
    id: str(d.id) || groupId,
    missingCount: num(d.missingCount),
    mp3WouldHelp: d.mp3WouldHelp === true,
    noSourceReason: str(d.noSourceReason),
    present: num(d.present),
    sources: Array.isArray(d.sources) ? d.sources.flatMap(toSource) : [],
    sourcesFoundAt: num(d.sourcesFoundAt),
    sourcesPage: num(d.sourcesPage),
    sourcesPages: num(d.sourcesPages),
    sourcesTotal: num(d.sourcesTotal),
    sourceTask: toGapTask(d.sourceTask),
    // B-011: files already downloaded but never filed — see LbBotGap.stalledPlacement.
    stalledPlacement: d.stalledPlacement === true,
    status: (str(d.status) || 'ready') as LbBotGapStatus,
    total: num(d.total),
    tracks: Array.isArray(d.tracks) ? d.tracks.flatMap(toGapTrack) : [],
});

ipcMain.handle(
    'lbbot-gap',
    async (_event, args: { groupId: string }): Promise<LbBotResult<LbBotGap>> => {
        if (!args.groupId) return failed(0, 'No review group');
        const result = await request('GET', '/lb/gap', {
            params: { group_id: args.groupId },
            timeoutMs: POLL_TIMEOUT_MS,
        });
        if (!result.ok) {
            return failed(result.status, result.error, false, { code: result.code });
        }
        return {
            data: toGap(result.data ?? {}, args.groupId),
            error: '',
            ok: true,
            status: result.status,
        };
    },
);

// The counterpart to the hub's `strip` on /lb/gap: the poll can't afford every
// source's peer listing, but the user still has to be able to answer "does this
// peer actually have my missing tracks, or twelve from another pressing". So it
// is fetched once, when a source is expanded. Upstream expands the peer's real
// directory, so it is slow — and `expanded: false` means the peer was
// unreachable and these rows are the original search hits, not the real folder.
ipcMain.handle(
    'lbbot-gap-source-files',
    async (
        _event,
        args: { groupId: string; sourceIndex: number },
    ): Promise<LbBotResult<LbBotSourceFiles>> => {
        if (!args.groupId) return failed(0, 'No review group');
        const result = await request('GET', '/lb/gap/source-files', {
            params: { group_id: args.groupId, source_index: String(args.sourceIndex) },
        });
        if (!result.ok) {
            return failed(result.status, result.error, false, { code: result.code });
        }
        const d = result.data ?? {};
        return {
            data: {
                coverage: str(d.coverage),
                coverageDetail: toCoverage(d.coverageDetail),
                expanded: d.expanded === true,
                fileCount: num(d.fileCount),
                files: Array.isArray(d.files) ? d.files.flatMap(toSourceFile) : [],
                filesTruncated: d.filesTruncated === true,
            },
            error: '',
            ok: true,
            status: result.status,
        };
    },
);

/** The gap writes. Each answers with a task id the clients discard — `sourceTask`
 *  on the gap detail is how a running search is watched. */
const gapAction = async (route: string, body: Json): Promise<LbBotGapAction> => {
    const result = await request('POST', route, { body });
    // lb-bot's `code` rides along (R12, B-238): the box decides from it whether the refusal says
    // the cards are stale, never from the sentence.
    if (!result.ok) return failed(result.status, result.error, false, { code: result.code });
    const ok = result.data?.ok !== false;
    const code = ok ? '' : str(result.data?.code);
    // B-233: what the gap watch starts from (LbBotGapAction).
    const gap =
        ok && result.data?.gap && typeof result.data.gap === 'object' ? result.data.gap : null;
    const taskId = ok ? str(result.data?.task_id) : '';
    return {
        ...(code ? { code } : {}),
        data: ok,
        error: ok ? '' : str(result.data?.error) || 'lb-bot refused the request.',
        ...(gap ? { gap: toGap(gap as Json, str(body.group_id)) } : {}),
        ok,
        status: result.status,
        ...(taskId ? { taskId } : {}),
    };
};

// Find sources without enqueuing anything — the review step, and the reason §3
// and §4 share components. NOTE the trap this route sets: the POST approves the
// group's pending missing tracks and *then* starts the background search, so the
// very next poll reads `picking` with an empty source list. Terminal judgements
// belong on `sourceTask.status`, never on the group's own `status`.
ipcMain.handle('lbbot-gap-search', async (_event, args: { force?: boolean; groupId: string }) =>
    args.groupId
        ? gapAction('/lb/gap/search', { force: args.force === true, group_id: args.groupId })
        : failed<boolean>(0, 'No review group'),
);

// Search, rank and commit in one shot. Kept, but demoted: it is the old blind
// behaviour, and the picker exists because blind picked wrong.
ipcMain.handle('lbbot-gap-auto', async (_event, args: { groupId: string }) =>
    args.groupId
        ? gapAction('/lb/gap/auto', { group_id: args.groupId })
        : failed<boolean>(0, 'No review group'),
);

ipcMain.handle('lbbot-gap-fetch', async (_event, args: { groupId: string; sourceId: number }) =>
    args.groupId
        ? gapAction('/lb/gap/fetch', { group_id: args.groupId, sourceId: args.sourceId })
        : failed<boolean>(0, 'No review group'),
);

ipcMain.handle('lbbot-gap-cancel', async (_event, args: { groupId: string }) =>
    args.groupId
        ? gapAction('/lb/gap/cancel', { group_id: args.groupId })
        : failed<boolean>(0, 'No review group'),
);

// Re-reads the album from Navidrome *and* walks its folder for files Navidrome
// hasn't indexed yet — which is also the manual reconcile after a fill lands.
ipcMain.handle('lbbot-gap-rescan', async (_event, args: { groupId: string }) =>
    args.groupId
        ? gapAction('/lb/gap/rescan', { group_id: args.groupId })
        : failed<boolean>(0, 'No review group'),
);

/**
 * Tell the user a fill landed while Worbus for desktop was in the background.
 *
 * The renderer raises a toast unconditionally; this is the half a toast cannot do,
 * and it is deliberately suppressed when the window is focused so a fill that
 * completes while the user is watching does not announce itself twice.
 *
 * `Notification.isSupported()` is false on some Linux setups with no notification
 * daemon, where constructing one throws.
 */
ipcMain.handle('lbbot-notify', (event, args: { body: string; title: string }) => {
    if (!Notification.isSupported()) return;
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window?.isFocused()) return;
    try {
        const notification = new Notification({ body: args.body, title: args.title });
        // Bring Worbus for desktop forward on click — the album is on an artist page somewhere,
        // and the notification is the only handle the user has on it.
        notification.on('click', () => {
            window?.show();
            window?.focus();
        });
        notification.show();
    } catch (error) {
        console.error(`[lbbot] could not post notification — ${String(error)}`);
    }
});

// ---------------------------------------------------------------------------
// Deezer browse — charts and editorial
// ---------------------------------------------------------------------------

// Free and unauthenticated upstream, and the first source on this surface with
// no MusicBrainz ids of its own: lb-bot resolves every row by NAME. That is why
// the marking rule below is stricter than elsewhere — an unresolved row is
// `owned: false` with no id, never a guess — and why a row with no `rgid` is
// rendered as information rather than as something to open or acquire.
const toBrowseAlbum = (row: unknown): LbBotBrowseAlbum[] => {
    if (!row || typeof row !== 'object') return [];
    const r = row as Json;
    const title = str(r.title);
    if (!title) return [];
    return [
        {
            artist: str(r.artist),
            coverUrl: str(r.coverUrl),
            releaseAlbumId: str(r.releaseAlbumId),
            releaseOwned: r.releaseOwned === true,
            rgid: str(r.rgid),
            title,
        },
    ];
};

const toBrowseArtist = (row: unknown): LbBotBrowseArtist[] => {
    if (!row || typeof row !== 'object') return [];
    const r = row as Json;
    const name = str(r.name);
    if (!name) return [];
    return [
        {
            artistId: str(r.artistId),
            imageUrl: str(r.imageUrl),
            indexed: r.indexed === true,
            mbid: str(r.mbid),
            name,
            owned: r.owned === true,
        },
    ];
};

const toBrowse = (data: Json | null): LbBotBrowse | null => {
    if (!data) return null;
    return {
        albums: Array.isArray(data.albums) ? data.albums.flatMap(toBrowseAlbum) : [],
        artists: Array.isArray(data.artists) ? data.artists.flatMap(toBrowseArtist) : [],
    };
};

// `genre` defaults to "0" — Deezer's "All", which is exactly what a bare `chart`
// already resolved to. So the default request is byte-for-byte the old one, and
// a hub too old to whitelist the parameter drops it silently and answers the
// global chart, which is also what this client would have asked for.
//
// There is deliberately no country axis. Deezer's open API has none: the chart
// is geolocated by lb-bot's own egress address, so a country picker would be a
// control that silently did nothing. (Measured from this network, the "global"
// chart comes back French.)
ipcMain.handle(
    'lbbot-deezer-chart',
    async (_event, args: { genre?: string; limit?: number }): Promise<LbBotBrowse | null> =>
        toBrowse(
            await get('/lb/deezer/chart', {
                genre: args?.genre || '0',
                limit: String(args?.limit ?? 20),
            }),
        ),
);

ipcMain.handle(
    'lbbot-deezer-editorial',
    async (_event, args: { genre?: string; limit?: number }): Promise<LbBotBrowse | null> =>
        toBrowse(
            await get('/lb/deezer/editorial', {
                genre: args?.genre || '0',
                limit: String(args?.limit ?? 20),
            }),
        ),
);

// The genre ids the two feeds above accept. Its own route rather than a table
// compiled into each client, because the ids are Deezer's and this project has
// already paid once for a list maintained by hand in two repos.
ipcMain.handle('lbbot-deezer-genres', async (): Promise<LbBotDeezerGenres | null> => {
    const data = await get('/lb/deezer/genres');
    if (!data) return null;
    const rows = Array.isArray(data.genres) ? data.genres : [];
    return {
        genres: rows.flatMap((row): LbBotDeezerGenre[] => {
            if (!row || typeof row !== 'object') return [];
            const r = row as Json;
            const id = str(r.id);
            const name = str(r.name);
            // Both are load-bearing: the id is interpolated into the upstream
            // path and the name is the whole of the chip.
            return id && name ? [{ id, imageUrl: str(r.imageUrl), name }] : [];
        }),
    };
});

// Deezer as a THIRD similarity source, beside ListenBrainz and Last.fm. It marks
// ownership exactly as `/lb/artist/similar` does, so the answer is reused rather
// than reshaped — a separate row type here would be a second vocabulary for the
// same fact.
ipcMain.handle(
    'lbbot-artist-related',
    async (
        _event,
        args: { limit?: number; mbid?: string; name?: string },
    ): Promise<LbBotSimilarArtists | null> => {
        if (!args.mbid && !args.name) return null;
        const params: Record<string, string> = { limit: String(args.limit ?? 20) };
        if (args.mbid) params.mbid = args.mbid;
        if (args.name) params.name = args.name;
        const data = await get('/lb/artist/related', params);
        if (!data) return null;
        return {
            artists: Array.isArray(data.artists) ? data.artists.flatMap(toSimilarArtist) : [],
            because: str(data.because),
            sources: Array.isArray(data.sources) ? data.sources.map(str).filter(Boolean) : [],
        };
    },
);

// ---------------------------------------------------------------------------
// Paste a link
// ---------------------------------------------------------------------------

// A user-initiated write-shaped read: it answers an `LbBotResult` rather than
// failing soft, because a paste box that swallows a bad URL silently is worse
// than one that says "that is not a link I can read".
//
// `kind: 'unknown'` is NOT such a failure — it is lb-bot's honest answer for a
// provider it does not parse, and the caller says so in those terms.
ipcMain.handle(
    'lbbot-resolve-link',
    async (_event, args: { url: string }): Promise<LbBotResult<LbBotResolvedLink>> => {
        const url = (args.url ?? '').trim();
        if (!url) return failed(0, 'Paste a link first.');
        const result = await request<Json>('POST', '/lb/resolve-link', { body: { url } });
        if (!result.ok || !result.data) {
            return failed(result.status, result.error || 'lb-bot could not read that link.');
        }
        const d: Json = result.data ?? {};
        const kind = str(d.kind);
        return {
            data: {
                artist: str(d.artist),
                confidence: num(d.confidence),
                kind: (['album', 'artist', 'track'].includes(kind)
                    ? kind
                    : 'unknown') as LbBotLinkKind,
                mbid: str(d.mbid),
                provider: str(d.provider),
                reason: str(d.reason),
                rgid: str(d.rgid),
                title: str(d.title),
            },
            error: '',
            ok: true,
            status: result.status,
        };
    },
);

// ---------------------------------------------------------------------------
// Wishlist
// ---------------------------------------------------------------------------

// The one place `retryable: false` becomes an action instead of a dead end.
// lb-bot never auto-retries `no_source` — it already walked its entire ranked
// source list, so asking again immediately is the same failure — but the
// Soulseek swarm changes over hours, which is what a slow periodic re-search
// against a persisted list is for.
const toWishlistEntry = (row: unknown): LbBotWishlistEntry[] => {
    if (!row || typeof row !== 'object') return [];
    const r = row as Json;
    const rgid = str(r.rgid);
    if (!rgid) return [];
    return [
        {
            addedAt: num(r.addedAt),
            artist: str(r.artist),
            attempts: num(r.attempts),
            lastReason: str(r.lastReason),
            lastTriedAt: num(r.lastTriedAt),
            rgid,
            title: str(r.title),
        },
    ];
};

// NOTE the envelope key is `wishlist`, not `entries`. Worth naming, because
// reading the wrong one is not an error anywhere: it yields an empty array, and
// an empty wishlist is a perfectly ordinary state, so the page would simply have
// said "nothing on the wishlist" forever.

// Worbus P4 (design §6.5): Needs attention reads only `counts` from `/lb/attention` (its
// `imports`, the albums lb-bot could not finish filing). Only the numbers cross to the renderer;
// null (an older hub or lb-bot, a refusal, a non-admin) reads as no imports.
ipcMain.handle('lbbot-attention-counts', async (): Promise<null | Record<string, number>> => {
    const data = await get('/lb/attention');
    const counts = data?.counts;
    if (!counts || typeof counts !== 'object' || Array.isArray(counts)) return null;
    return Object.fromEntries(
        Object.entries(counts as Json).filter(
            (entry): entry is [string, number] => typeof entry[1] === 'number',
        ),
    );
});

ipcMain.handle('lbbot-wishlist', async (): Promise<LbBotWishlist> => {
    const data = await get('/lb/wishlist');
    // A failed read rejects rather than answering an empty list: the wishlist section
    // has to say "could not read it", not "nothing on it", when lb-bot did not answer.
    if (!data) throw new Error('lb-bot did not answer /lb/wishlist');
    return {
        cooldownSeconds: num(data.cooldownSeconds),
        entries: Array.isArray(data.wishlist) ? data.wishlist.flatMap(toWishlistEntry) : [],
        intervalSeconds: num(data.intervalSeconds),
    };
});

ipcMain.handle(
    'lbbot-wishlist-add',
    async (
        _event,
        args: { artist: string; rgid: string; title: string },
    ): Promise<LbBotResult<boolean>> => {
        if (!args.rgid) return failed(0, 'That album has no MusicBrainz release-group id.');
        const result = await request('POST', '/lb/wishlist', {
            body: { artist: args.artist, rgid: args.rgid, title: args.title },
        });
        return { ...result, data: result.ok };
    },
);

ipcMain.handle(
    'lbbot-wishlist-remove',
    async (_event, args: { rgid: string }): Promise<LbBotResult<boolean>> => {
        if (!args.rgid) return failed(0, 'No album to remove.');
        const result = await request('POST', '/lb/wishlist/remove', { body: { rgid: args.rgid } });
        return { ...result, data: result.ok };
    },
);
