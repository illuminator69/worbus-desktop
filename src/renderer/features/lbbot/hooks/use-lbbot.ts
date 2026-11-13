import type {
    LbBotAlbumCandidate,
    LbBotAlbumCoverSet,
    LbBotAlbumJob,
    LbBotAlbumOverrideRow,
    LbBotAlbumState,
    LbBotArtistCandidate,
    LbBotBrowse,
    LbBotCover,
    LbBotDeezerGenres,
    LbBotDiscography,
    LbBotDownloadResult,
    LbBotFillFrame,
    LbBotFillState,
    LbBotFillStatus,
    LbBotGap,
    LbBotGapAction,
    LbBotGapSource,
    LbBotListeningPeriod,
    LbBotListeningStatus,
    LbBotListeningSummary,
    LbBotMergeJob,
    LbBotMergePreview,
    LbBotMergeRow,
    LbBotMeta,
    LbBotOverrideRemoved,
    LbBotOverrideSet,
    LbBotPreview,
    LbBotRecent,
    LbBotRelease,
    LbBotReleaseDetail,
    LbBotResolvedEdition,
    LbBotResolvedLink,
    LbBotResult,
    LbBotSiblingGroup,
    LbBotSimilarAlbums,
    LbBotSimilarArtists,
    LbBotSourceFiles,
    LbBotStatus,
    LbBotTracklist,
    LbBotUnowned,
    LbBotWishlist,
} from '/@/shared/types/lbbot-types';
import type { LbBotActivityRequest } from '/@/shared/utils/lbbot-activity';
import type { LbBotAttentionAlbum, LbBotAttentionFolder } from '/@/shared/utils/lbbot-attention';

import {
    keepPreviousData,
    QueryClient,
    useInfiniteQuery,
    useQuery,
    useQueryClient,
    UseQueryResult,
} from '@tanstack/react-query';
import isElectron from 'is-electron';
import {
    use,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    useSyncExternalStore,
} from 'react';
import { useLocation, useNavigate } from 'react-router';

import { api } from '/@/renderer/api';
import { noteScanStarted } from '/@/renderer/features/discography/hooks/scan-session';
import { allows, userAfterRefusal } from '/@/renderer/features/hub/utils/hub-roles';
import {
    isSourceVerified,
    type KeptListing,
    listingNeedsAsking,
    sourceKey,
} from '/@/renderer/features/lbbot/components/source-cards-model';
import { gapProgress } from '/@/renderer/features/lbbot/gap-stage';
import {
    type GapEntry,
    gapEntryAfterSummary,
    gapFailReason,
    gapSettleOutcome,
} from '/@/renderer/features/lbbot/hooks/fill-announce-logic';
import {
    gapIsBusy,
    gapReadCounts,
    gapWatchVerdict,
} from '/@/renderer/features/lbbot/hooks/gap-watch';
import {
    getIndexMirrorSnapshot,
    getMirrorArtistByNdId,
    loadIndexMirror,
    mirrorDiscography,
    onLbBotAvailable,
    subscribeIndexMirror,
    useMirrorArtistByNdId,
    useMirrorShown,
} from '/@/renderer/features/lbbot/index-mirror/index-mirror';
import {
    ActiveFill,
    useActiveFill,
    useActiveFillsStore,
    useActiveGap,
} from '/@/renderer/features/lbbot/stores/active-fills.store';
import {
    getLbBotMode,
    lbBotModeActions,
    useLbBotModeValue,
} from '/@/renderer/features/lbbot/stores/lbbot-mode.store';
import { nextFillExtras } from '/@/renderer/features/lbbot/utils/album-download';
import {
    artistLinkStep,
    fieldedAlbumQuery,
    normalizeAlbumTitle,
    pickAlbumCandidate,
    pickLibraryArtist,
    rankAlbumCandidates,
    sameAlbumTitle,
    sameArtist,
} from '/@/renderer/features/lbbot/utils/album-match';
import {
    PollAnswer,
    PollRow,
    PollSpec,
    PollState,
    runJob,
} from '/@/renderer/features/lbbot/utils/album-override';
import {
    describeOverrideFailure,
    effectiveArtistMbid,
    isNavidromeArtistId,
    isOlderLbBot,
    OverrideFailure,
    overrideKind,
    OverrideKind,
    overridesByNdId,
    OverridesByNdId,
    planIndexStart,
    planScan,
} from '/@/renderer/features/lbbot/utils/artist-override';
import { artistTapKey, createTapGuard } from '/@/renderer/features/lbbot/utils/artist-tap';
import { artistLinkPath } from '/@/renderer/features/lbbot/utils/external-paths';
import { forgetAlbumCovers } from '/@/renderer/features/lbbot/utils/forget-album-covers';
import {
    classifyRefresh,
    metaHasContent,
    normalizeOverridesData,
    OverridesData,
} from '/@/renderer/features/lbbot/utils/lbbot-data';
import { staleUnlessAnswered } from '/@/renderer/features/lbbot/utils/persisted-queries';
import { importFinished } from '/@/renderer/features/listening/listening-logic';
import { queryClient } from '/@/renderer/lib/react-query';
import { getServerById, useCurrentServerId } from '/@/renderer/store';
import {
    hubRolesNow,
    lbBotDownNow,
    useHubConnected,
    useHubRoles,
    useHubStore,
} from '/@/renderer/store/hub.store';
import { toast } from '/@/shared/components/toast/toast';
import {
    AlbumArtistListSort,
    AlbumListSort,
    ArtistListSort,
    ServerType,
    SortOrder,
} from '/@/shared/types/domain-types';
import { isLbRefusal } from '/@/shared/utils/lbbot-failure';
import {
    downloadsShown,
    isP1Peer,
    LbIndexProgress,
    LbMode,
    stateAfterRefusal,
    tooOldAfterRefusal,
} from '/@/shared/utils/lbbot-mode';
import { normalizeLbBotWebUrl, routeAdvertised } from '/@/shared/utils/lbbot-wire';

/**
 * lb-bot surfaces for the renderer.
 *
 * The contract for every hook here is the same one Tier-2 AudioMuse follows:
 * never on the critical render path, never an error state. A missing hub, an
 * unconfigured LBBOT_URL, an unreachable lb-bot and an unindexed artist all
 * resolve to "render nothing", because the artist page has to look exactly as it
 * does today whenever this layer is absent.
 */

const lbBot = isElectron() ? window.api.lbBot : null;

/** Cover Art Archive front cover for a release-group.
 *
 * Built here rather than proxied: lb-bot's /api/cover serves *Navidrome* art
 * keyed by a Navidrome album id, which by definition does not exist for a
 * release the library doesn't have. The Archive is public, so the client fetches
 * it directly — which also keeps multi-megabyte images out of the hub's cache.
 */
export const caaCoverUrl = (rgid: string, size: 250 | 500 = 250): string =>
    rgid ? `https://coverartarchive.org/release-group/${rgid}/front-${size}` : '';

/** Albums the library holds part of, keyed by the Navidrome album ids lb-bot
 *  matched them to — which is how a page or a context menu finds the gap for an
 *  album it already has. Only rows carrying a live review group qualify: without
 *  a `group_id` there is nothing to act on. */
export const gapsByAlbumId = (
    data: LbBotDiscography | null | undefined,
): Map<string, LbBotRelease> => {
    const map = new Map<string, LbBotRelease>();
    for (const release of data?.releases ?? []) {
        if (release.status !== 'incomplete' || !release.groupId) continue;
        for (const albumId of release.navidromeAlbumIds) map.set(albumId, release);
    }
    return map;
};

/**
 * What the hub says about lb-bot: whether it is reachable, and which routes the
 * hub proxies.
 *
 * **`welcome.lb` first.** A hub new enough to mirror lb-bot's index states both
 * in every `welcome` (`adoptLbBotWelcome`), so no page waits on a `/lb/status`
 * round trip before its first lb-bot read — the probe used to gate every one.
 * An older hub sends no `lb`, and then the probe below answers exactly as it
 * always has; it is disabled, not removed, while the welcome's answer stands.
 */
const useLbBotStatus = (): LbBotStatus | undefined => {
    const advertised = useHubStore((state) => state.lbStatus);
    const probe = useQuery({
        enabled: !!lbBot && !advertised,
        gcTime: Infinity,
        queryFn: async () => {
            const status = await lbBot!.status();
            // Worbus P1: a `/lb/status` read moves the downloads mode like an `lb` frame does
            // (only when it carries the key). Behind an older hub it never does.
            lbBotModeActions().applyFrame(status);
            return status;
        },
        queryKey: ['lbbot', 'status'],
        // The hub gaining an LBBOT_URL doesn't restart this app, so don't cache
        // "off" forever — but don't re-probe on every artist page either.
        staleTime: 10 * 60 * 1000,
    });
    return advertised ?? probe.data;
};

/**
 * Take the hub's `welcome.lb` — or its absence — as the lb-bot status for this
 * connection, and invalidate the probe.
 *
 * Called on EVERY welcome, i.e. on every (re)connect: a hub that restarted may
 * have gained or lost LBBOT_URL, been upgraded, or been swapped for an older one
 * at the same address. A welcome with no `lb` clears the stored answer, which
 * re-enables the probe; the invalidation makes that probe ask again rather than
 * serve its answer from the previous connection.
 */
export const adoptLbBotWelcome = (lb: unknown): void => {
    const raw = lb && typeof lb === 'object' ? (lb as Record<string, unknown>) : null;
    const lbStatus: LbBotStatus | null =
        raw && typeof raw.available === 'boolean'
            ? {
                  available: raw.available,
                  routes: Array.isArray(raw.routes)
                      ? raw.routes.filter((route): route is string => typeof route === 'string')
                      : [],
                  webUrl: normalizeLbBotWebUrl(raw.webUrl),
              }
            : null;
    useHubStore.getState().actions.setStore({ lbStatus });
    void queryClient.invalidateQueries({ queryKey: ['lbbot', 'status'] });
    // "This lb-bot is older" was learned from the lb-bot of the last connection; an
    // upgraded one must be asked again. The album and merge flags have no successful
    // read to clear them (unlike the override list's), so a welcome does.
    for (const key of [ALBUM_OVERRIDE_OLDER_KEY, MERGE_OLDER_KEY, SCAN_NEEDS_MBID_KEY]) {
        if (queryClient.getQueryData(key)) queryClient.setQueryData(key, false);
    }
};

/**
 * The hub's `{t: "lb", available, routes}` frame (Ruling R18): its own lb-bot
 * probe changed its verdict mid-connection. The same object as `welcome.lb`,
 * applied the same way — the welcome's answer is a connect-time snapshot, and
 * with the `/lb/status` probe disabled while it stands, this frame is the only
 * way a connected client learns that lb-bot came up or went down.
 *
 * A malformed frame is ignored rather than adopted: unlike a welcome with no
 * `lb` (an older hub, which must fall back to the probe), a frame that says
 * nothing parseable is not a statement that lb-bot is gone.
 */
export const adoptLbBotFrame = (frame: unknown): boolean => {
    const raw = frame && typeof frame === 'object' ? (frame as Record<string, unknown>) : null;
    if (!raw || typeof raw.available !== 'boolean') return false;
    adoptLbBotWelcome(raw);
    return raw.available;
};

/**
 * The hub socket is gone, so lb-bot — reached only through the hub — is too.
 *
 * `welcome.lb` and the `lb` frame are the only things that move the verdict, and
 * both arrive over the socket: kept as it stood, a lost connection (the laptop
 * leaving the LAN, the hub going down) left every lb-bot surface "available"
 * for the whole outage, each read failing soft into a null that then stood as
 * the answer. The routes and `webUrl` are kept — they describe the same hub,
 * which the next welcome restates — only `available` drops. Behind an older hub
 * (no `lb`, the probe answering) the probe is asked again instead.
 */
export const markLbBotUnreachable = (): void => {
    const { actions, lbStatus } = useHubStore.getState();
    if (lbStatus) {
        if (lbStatus.available) actions.setStore({ lbStatus: { ...lbStatus, available: false } });
        return;
    }
    void queryClient.invalidateQueries({ queryKey: ['lbbot', 'status'] });
};

/**
 * Forget what the hub said about lb-bot — for the hub being switched off in
 * settings, or pointed at a different address (R17). Either way the stored
 * answer describes a hub this app is no longer talking to, and it would
 * otherwise stand for the rest of the session: every lb-bot surface still
 * "available", failing soft on each use until a restart. Cleared, the
 * `/lb/status` probe takes over again (asked afresh, not served from the old
 * hub's cached answer) until the next welcome states it.
 */
export const clearLbBotStatus = (): void => {
    if (useHubStore.getState().lbStatus !== null) {
        useHubStore.getState().actions.setStore({ lbStatus: null });
    }
    // Even with nothing stored: behind an older hub the probe's own cached
    // answer (kept indefinitely, re-asked every ten minutes) is the stale one.
    void queryClient.invalidateQueries({ queryKey: ['lbbot', 'status'] });
};

/**
 * The lb-bot answers whose ownership marking a missed `library` frame leaves
 * wrong — the routes the hub itself drops on every library event
 * (`LB_LIBRARY_ROUTES`), as this app caches them. `status` is not here:
 * {@link adoptLbBotWelcome} re-asks it on its own.
 */
const LB_OWNERSHIP_KINDS = new Set([
    'album-lookup',
    'artist-related',
    'artist-similar',
    'discography',
    'fresh-releases',
    // I-006: listening rows carry `owned` / album ids, and an unowned-album tile
    // must not keep offering a download once the library holds the record.
    'listening-recent',
    'listening-summary',
    'listening-unowned',
    'wishlist',
]);

/** The override-map query (I-019), one key for the hook, the refresh and the persister. */
const OVERRIDES_KEY = ['lbbot', 'overrides'] as const;

let overridesTimer: null | number = null;

/**
 * Ask lb-bot for the override map again. Called on every welcome, after a set or
 * remove, and on `index` frames — which arrive every ~2 s during a bulk build,
 * so a frame only arms a single trailing refresh a few seconds out instead of
 * one request per frame (the map is a small read, but it shares the hub's four
 * proxy slots). Like {@link invalidateLbBotOwnership}, with lb-bot down it only
 * marks the map stale: a refetch then would fail, and a failed fetch keeps the
 * last map anyway.
 */
export const refreshLbBotOverrides = (delayMs = 0): void => {
    const run = () => {
        overridesTimer = null;
        const down = lbBotDownNow();
        void queryClient.invalidateQueries({
            queryKey: OVERRIDES_KEY,
            refetchType: down ? 'none' : 'active',
        });
    };
    if (delayMs <= 0) {
        if (overridesTimer !== null) window.clearTimeout(overridesTimer);
        run();
        return;
    }
    if (overridesTimer === null) overridesTimer = window.setTimeout(run, delayMs);
};

/** lb-bot's index head (`welcome.lbIndex`) at the last ownership invalidation. */
let ownershipHead: null | string = null;

/**
 * Mark every cached lb-bot answer that carries ownership stale — for a new hub
 * connection. A `library` frame sent while the socket was down is lost, and
 * with it the one signal that a Fresh row, a Deezer tile or a similar artist
 * now says "owned"; the hub dropped its own copies when it happened, but these
 * (Fresh and the Deezer rows restored from disk among them) would stand until
 * their `staleTime` ran out, an hour or more. Worbus for Android does the same on every
 * welcome (Ruling R28).
 *
 * Not a library event: nothing in Navidrome's cache is touched. Only what is on
 * screen refetches now, and it keeps painting its answer until the new one
 * lands; the rest asks again on its next mount.
 *
 * Call it AFTER {@link adoptLbBotWelcome}, and pass `welcome.lbIndex`:
 * - Every event that changes ownership is an lb-bot index write, so a head
 *   that has not moved since the last time this ran means nothing was missed,
 *   and nothing is re-asked. Compared with that last run rather than with the
 *   mirror's cursor: the mirror being current says nothing about answers
 *   fetched before it caught up — Fresh restored from yesterday's disk, say —
 *   and the first welcome of a session always runs.
 * - With lb-bot down, the answers are only marked stale, not refetched. The
 *   mounted observers still carry the `enabled` of their last render — React
 *   has not re-rendered them with the new verdict yet — so an active refetch
 *   here asked a dead lb-bot, got the fail-soft null, and replaced good (and
 *   persisted) answers with it. Marked stale, they refetch once lb-bot is back
 *   and the observers are enabled again.
 */
export const invalidateLbBotOwnership = (indexHint?: unknown): void => {
    // Before the head check below: an override is a client-visible fact the head
    // may not have moved for (a set made while this socket was down).
    refreshLbBotOverrides();
    const hint =
        indexHint && typeof indexHint === 'object' ? (indexHint as Record<string, unknown>) : null;
    const head =
        hint && typeof hint.seq === 'number' && typeof hint.epoch === 'string'
            ? `${hint.epoch}:${hint.seq}`
            : null;
    if (head !== null && head === ownershipHead) return;
    ownershipHead = head;
    const down = lbBotDownNow();
    void queryClient.invalidateQueries({
        predicate: (query) => {
            const [scope, kind, feed] = query.queryKey as unknown[];
            if (scope !== 'lbbot' || typeof kind !== 'string') return false;
            // The Deezer chart and editorial rows, not the genre list.
            if (kind === 'deezer') return feed === 'chart' || feed === 'editorial';
            return LB_OWNERSHIP_KINDS.has(kind);
        },
        refetchType: down ? 'none' : 'active',
    });
};

/**
 * Whether the lb-bot layer is reachable at all. Worbus P1 (B-263): lb-bot refusing this hub
 * (`lbRefused`, a 401 `signin_required`) reads as unreachable - lb-bot surfaces render nothing,
 * the index mirror still renders its local data - until the next `welcome` clears it.
 */
export const useLbBotAvailable = (): boolean => {
    const refused = useHubStore((state) => state.lbRefused);
    // Worbus P2: too old for this (non-primary) user - unavailable, until the hub says otherwise.
    const tooOld = useHubStore((state) => state.lbTooOld);
    return useLbBotStatus()?.available === true && !refused && !tooOld;
};

/**
 * lb-bot's downloads mode (Worbus P1): `on`, `off`, or `unknown` for an older peer, which
 * behaves as today. See `lbbot-mode.ts` for how it moves.
 */
export const useLbBotMode = (): LbMode => useLbBotModeValue();

/**
 * Whether download actions are offered: always, except when lb-bot said downloading is off, or
 * (Worbus P2) the signed-in user is not an admin - getting albums is an admin action, and a
 * non-admin sees the same page a downloads-off server shows (browse, wishlist, Scan now).
 */
export const useLbBotDownloadsShown = (): boolean => {
    const allowed = allows(useHubRoles(), 'downloads');
    return downloadsShown(useLbBotModeValue()) && allowed;
};

/** A peer from Worbus P1 on (it reported the mode): the P1-only offers (Scan now without an
 *  MBID, the 3 s scan poll, following a worker's scan) are made only to one. */
export const useIsP1Peer = (): boolean => isP1Peer(useLbBotModeValue());

/** Worbus P1: downloading is known to be off - the ledger's and the acquire path's non-hook
 *  functions refuse locally then, without a request. */
const downloadsOffNow = (): boolean =>
    getLbBotMode() === 'off' || !allows(hubRolesNow(), 'downloads');

/** {@link useLbBotDownloadsShown} outside React: a failed fill action toasts only while true. */
export const downloadsShownNow = (): boolean => !downloadsOffNow();

/** lb-bot's index build countdown, or null - always null while lb-bot is not available (the
 *  hub keeps the last progress while lb-bot is gone; a bar for a gone lb-bot never ends). */
export const useLbBotIndexProgress = (): LbIndexProgress | null => {
    const available = useLbBotAvailable();
    const progress = useHubStore((state) => state.lbProgress);
    return available ? progress : null;
};

/**
 * Mount once (beside `useLbBotIndexSync`): apply lb-bot's refusals, whichever route got them.
 * The main client's one request function sends `lbbot-refusal`; a 409 `downloads_off` turns the
 * mode off, a 401 `signin_required` marks lb-bot refused for this connection.
 */
export const useLbBotRefusals = (): void => {
    useEffect(() => {
        if (!lbBot?.onRefusal) return undefined;
        return lbBot.onRefusal(({ code }) => applyLbBotRefusal(code));
    }, []);
};

/**
 * Apply one lb-bot refusal code (`stateAfterRefusal`): from the `lbbot-refusal` event, or read off
 * an action's own answer. Idempotent, so the event and the answer may arrive in either order: an
 * action applies its answer's code itself before deciding what to say, never relying on the event
 * having come first.
 */
export const applyLbBotRefusal = (code: string | undefined): void => {
    const hub = useHubStore.getState();
    const current = { mode: getLbBotMode(), refused: hub.lbRefused };
    const next = stateAfterRefusal(current, code);
    if (next.refused !== current.refused) hub.actions.setStore({ lbRefused: next.refused });
    // Worbus P2 (review I3): `lbbot_too_old` sets its own flag, and an answer that got through
    // afterwards (main's `answered`) ends it.
    const tooOld = tooOldAfterRefusal(hub.lbTooOld, code);
    if (tooOld !== hub.lbTooOld) hub.actions.setStore({ lbTooOld: tooOld });
    // Worbus P2: an `admin_only` / `primary_only` means the flags are already lower than this
    // client believed; the action hides in place, and the next `user` frame restates them.
    const user = userAfterRefusal(hub.user, code);
    if (user !== hub.user) hub.actions.setStore({ user });
    if (next.mode !== current.mode) lbBotModeActions().adopt(next.mode);
};

/** An action's answer, with its refusal (if any) applied first: see {@link applyLbBotRefusal}. */
const withRefusal = <T extends { code?: string; ok: boolean }>(result: T): T => {
    if (!result.ok) applyLbBotRefusal(result.code);
    return result;
};

/**
 * lb-bot's own web UI, when the hub says where it is ("" otherwise) — for the
 * screens that have to hand the user over to lb-bot's workspace. `#/gaps/<id>`
 * opens one album's Fill-gaps page there.
 */
export const useLbBotWebUrl = (): string => useLbBotStatus()?.webUrl ?? '';

/**
 * Ruling R21 for the lb-bot answers react-query keeps on disk
 * (`persisted-queries.ts`): with the hub switched off in settings, or never set
 * up, they are not shown. `enabled: false` is not enough on its own — a
 * disabled query still returns whatever `main.tsx` hydrated, so About, Fresh
 * and the Deezer rows went on rendering the last hub's answers with no hub.
 * The same predicate as the index mirror ({@link useMirrorShown}), and the same
 * reading of it: lb-bot merely down still shows them, and nothing is deleted,
 * so switching the hub back on paints them again at once.
 */
const useShownWithHub = <TData>(query: UseQueryResult<TData>): UseQueryResult<TData> => {
    const shown = useMirrorShown();
    // Spread only when hidden: it reads every tracked property of the result,
    // which is harmless for a query that cannot fetch.
    return shown ? query : ({ ...query, data: undefined } as UseQueryResult<TData>);
};

/**
 * Whether the hub in front of lb-bot proxies a given route.
 *
 * This app ships independently of the hub, and the hub is a long-running process
 * that only picks up an edit when it restarts — so "my client is newer than my
 * hub" is a permanent condition, not an edge case, and without asking it shows
 * up as a button that silently 404s.
 */
export const useHubSupports = (route: string): boolean =>
    routeAdvertised(useLbBotStatus()?.routes, route);

/**
 * The same question as a predicate, for a caller checking several routes at
 * once — the Discover catalogue asks about a different route per row and would
 * otherwise have to call a hook in a loop.
 */
export const useLbBotRouteSupport = (): ((route: string) => boolean) => {
    const routes = useLbBotStatus()?.routes;
    return useCallback((route: string) => routeAdvertised(routes, route), [routes]);
};

/** What {@link useLbBotDiscography} answers: the discography, wherever it came
 *  from, and whether a first read is still outstanding. */
export interface LbBotDiscographyRead {
    /** Undefined until something has answered; `{indexed: false}` from the
     *  network for an artist lb-bot has never scanned. */
    data: LbBotDiscography | null | undefined;
    /** Read from the local index mirror rather than from lb-bot. The mirror
     *  carries no `scan` record — see `toDiscography`. */
    fromMirror: boolean;
    /** Neither source has answered yet and one of them is on its way. */
    isLoading: boolean;
}

/** `loaded` alone, as a boolean snapshot, so a page re-renders once when the
 *  stored mirror has been read rather than on every change to any artist. */
const getMirrorLoaded = () => getIndexMirrorSnapshot().loaded;
/** The envelope `stale` is computed against, as one primitive for the same
 *  reason: a mirror moving under a bulk build must not re-render every page. */
const getMirrorEnvelopeKey = () => {
    const { meta } = getIndexMirrorSnapshot();
    return `${meta.scanVersion}:${meta.ttlDays}`;
};

/**
 * An artist's full MusicBrainz discography as lb-bot indexed it.
 *
 * **The local mirror first, synchronously** (PLAN-lbbot-index-mirror §5). The
 * mirror holds lb-bot's whole index in memory, kept current by the change feed,
 * so for any artist lb-bot has indexed the answer is here on the render that
 * first asks — which is what lets an artist page paint its owned and missing
 * tiles in one pass, in the same frame as Navidrome's own data, instead of
 * splicing lb-bot's rows in a second later and shifting everything below them.
 * The lookup is lb-bot's own (`_index_get_artist`: the MBID key first, then
 * the Navidrome id), so the mirror and the network read name the same artist.
 *
 * **The network as the fallback,** only for an artist the mirror does not hold:
 * one lb-bot has never scanned (which answers `{indexed: false}` and is what
 * offers the scan), a mirror still on its first pull, or a hub too old to serve
 * the feed at all. It waits for the stored mirror to be read before deciding
 * the artist is absent, so a page opened during startup does not ask lb-bot for
 * something it already has on disk. The GET is an instant SQLite read on
 * lb-bot's side; the expensive MusicBrainz walk is only ever the explicit POST
 * below.
 *
 * The mirror is shown whatever `welcome.lb` says about reachability: it is data
 * already on this machine, and an lb-bot that is down (or a laptop with no
 * network) does not make the discography it indexed yesterday any less true.
 * Acting on it — a scan, a download — still goes through the hub and fails soft
 * there, exactly as it did before. What it does follow is the hub SETTING
 * (Ruling R21): with the hub switched off, or missing its URL or token, the
 * mirror answers nothing (`mirrorShown`), the fallback query is disabled by
 * `available`, and every caller renders exactly what it renders with no hub.
 */
export const useLbBotDiscography = (ndId: string, mbid?: null | string): LbBotDiscographyRead => {
    const available = useLbBotAvailable();
    const loaded = useSyncExternalStore(subscribeIndexMirror, getMirrorLoaded);
    const envelope = useSyncExternalStore(subscribeIndexMirror, getMirrorEnvelopeKey);
    const mirrored = useMirrorArtistByNdId(ndId, mbid);
    // Derived outside the store's snapshot: a snapshot that built a new object
    // on every read would never compare equal and would render forever.
    const fromMirror = useMemo(
        () => (mirrored ? mirrorDiscography(mirrored) : undefined),
        // `envelope` is what `stale` is computed against; the memo must follow it.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [mirrored, envelope],
    );

    const query = useQuery({
        enabled: !!lbBot && available && !!ndId && loaded && !mirrored,
        // The fallback only. Long enough to outlive a trip into an album and
        // back, and never shorter than `staleTime`, which the 20 s default
        // would otherwise silently cancel.
        gcTime: 5 * 60 * 1000,
        queryFn: () => lbBot!.discography(ndId, mbid ?? undefined),
        queryKey: ['lbbot', 'discography', ndId],
        // The hub caches this for 60s; asking more often than that only costs
        // round trips. Refetching on focus would poll lb-bot every alt-tab.
        refetchOnWindowFocus: false,
        staleTime: 60 * 1000,
    });

    // Ruling R21 for the fallback too: a disabled query still returns its cached
    // answer, which would otherwise keep painting tiles (and offering actions
    // that fail) after the hub is switched off.
    const shown = useMirrorShown();
    if (fromMirror) return { data: fromMirror, fromMirror: true, isLoading: false };
    return {
        data: shown ? query.data : undefined,
        fromMirror: false,
        // A disabled query stays `pending` forever, so this is `isLoading`
        // (pending AND fetching), plus the short window before the stored
        // mirror has been read — during which the answer may well be local.
        isLoading: !!ndId && (!loaded || query.isLoading),
    };
};

/**
 * Hold a page until the stored mirror has been read into memory — at most
 * {@link MIRROR_READY_TIMEOUT_MS}, so an IndexedDB that never answers costs a
 * pause rather than a page that never opens.
 *
 * For a page that renders under a Suspense boundary it is already waiting on,
 * i.e. the artist page's Navidrome queries: waiting there is what makes "owned
 * and missing in the same pass" hold even when the app has just started, where
 * a lookup against a mirror not read yet would miss and the tiles would splice
 * in a moment later. The mirror starts loading at app start (`useHub`), so in
 * practice this has nothing left to wait for by the time anyone opens a page.
 */
const MIRROR_READY_TIMEOUT_MS = 1500;
let mirrorReady: null | Promise<void> = null;

export const useIndexMirrorReady = (): void => {
    if (!lbBot || getIndexMirrorSnapshot().loaded) return;
    mirrorReady ??= Promise.race([
        loadIndexMirror(),
        new Promise<void>((resolve) => window.setTimeout(resolve, MIRROR_READY_TIMEOUT_MS)),
    ]);
    use(mirrorReady);
};

/**
 * The picker's MusicBrainz artist search (I-019). Unlike {@link useLbBotArtistLookup}
 * it is result-shaped (a failure is an error line, never "no artists found" — lb-bot
 * answers 502 `retryable` when MusicBrainz did not answer) and it searches ANY
 * non-blank term: a two-character name such as "U2" is a real artist.
 */
export const useLbBotArtistSearch = (term: string) => {
    const available = useLbBotAvailable();
    const q = term.trim();
    return useQuery<LbBotArtistCandidate[]>({
        enabled: !!lbBot && available && q.length > 0,
        gcTime: 10 * 60 * 1000,
        queryFn: async () => {
            const result = await lbBot!.artistSearch(q);
            if (!result.ok || !result.data) throw new LbBotReadError(result);
            return result.data;
        },
        queryKey: ['lbbot', 'artist-search', q],
        refetchOnWindowFocus: false,
        retry: false,
        staleTime: 10 * 60 * 1000,
    });
};

/**
 * Worbus P1 (F6): an lb-bot answered Scan now without an MBID 400 "mbid is required" - it is older
 * than P1 after all, and an artist needs an MBID to scan again. Cleared by the next welcome.
 */
const SCAN_NEEDS_MBID_KEY = ['lbbot', 'scan-needs-mbid'] as const;

export const useScanNeedsMbid = (): boolean =>
    useQuery<boolean>({
        enabled: false,
        gcTime: Infinity,
        initialData: false,
        queryFn: () => false,
        queryKey: SCAN_NEEDS_MBID_KEY,
        staleTime: Infinity,
    }).data;

/** How long a scan's follow polls before giving up (a scan that retries MusicBrainz can take a
 *  few minutes; the record says when it is really over). */
const SCAN_FOLLOW_MS = 5 * 60 * 1000;

/**
 * Trigger the (slow, rate-limited) MusicBrainz scan for one artist. Worbus P1: with no MBID, a P1
 * peer scans by the Navidrome id alone ("Scan now"), polls every 3 s instead of 5, and follows a
 * scan that was already running (`running: true`, possibly the worker's `auto-index`) through the
 * discography's `scan` record - never a task route.
 */
export const useIndexArtist = (ndId: string) => {
    const queryClient = useQueryClient();
    const p1Peer = useIsP1Peer();
    const needsMbid = useScanNeedsMbid();
    const [pending, setPending] = useState(false);
    const [error, setError] = useState('');
    // Not a failure: lb-bot started no scan because another library artist holds
    // this discography.
    const [note, setNote] = useState('');

    const indexArtist = useCallback(
        async (mbid: string | undefined, name: string) => {
            if (!lbBot) return false;
            const byNdId = !mbid && p1Peer && !needsMbid && isNavidromeArtistId(ndId);
            if (mbid ? !name : !byNdId) return false;
            setPending(true);
            setError('');
            setNote('');
            // What the index says *before* the scan. A rescan of an artist that
            // is already indexed never flips `indexed`, so waiting on that flag
            // alone declared victory on the first tick and dropped the spinner
            // while MusicBrainz was still being walked — which is exactly the
            // case a rescan button exists for.
            const before = queryClient.getQueryData<LbBotDiscography | null>([
                'lbbot',
                'discography',
                ndId,
            ]);
            // The page now reads an indexed artist from the mirror and never
            // fetches it, so the query cache is usually empty here — and a
            // baseline of 0 would read the first poll's (old) `scannedAt` as
            // the rescan having finished and drop the spinner at once.
            const previousScan = Math.max(
                before?.scannedAt ?? 0,
                getMirrorArtistByNdId(ndId, mbid)?.scannedAt ?? 0,
            );
            const answer = await lbBot.indexArtist(ndId, mbid || undefined, name);
            if (answer?.olderLbBot) {
                // Not a failure to shout about: the page goes back to "needs an MBID", as before P1.
                queryClient.setQueryData(SCAN_NEEDS_MBID_KEY, true);
                setPending(false);
                return false;
            }
            const plan = planIndexStart(answer);
            if (plan.kind === 'covered') {
                // Nothing was started, so there is nothing to wait on: no spinner.
                setPending(false);
                setNote(
                    'This artist shares its discography with another artist in your library, so there is nothing to scan from here.',
                );
                return false;
            }
            if (plan.kind === 'failed') {
                setPending(false);
                setError('lb-bot did not start the scan. Is it reachable?');
                return false;
            }
            const { taskId } = plan;
            // F7: the page's scan state follows this task id, wherever the scan was started from.
            noteScanStarted(ndId, taskId);
            // A big discography takes 10-60s at MusicBrainz's one-request-a-second.
            // Rather than polling a task, re-read the index a few times and let the
            // shelf appear when it appears — a miss just means "not yet".
            let attempts = 0;
            const everyMs = p1Peer ? 3000 : 5000;
            const tick = window.setInterval(async () => {
                attempts += 1;
                const data = await queryClient.fetchQuery({
                    queryFn: () => lbBot!.discography(ndId, mbid),
                    queryKey: ['lbbot', 'discography', ndId],
                });
                const rescanned = (data?.scannedAt ?? 0) > previousScan;
                // A failed scan used to be invisible: the index simply never
                // changed, the spinner ran out after 100 s, and the page said
                // nothing. lb-bot now keeps the old discography and says why.
                const scan = data?.scan;
                // Matched by task id, not time: lb-bot's clock is not this one.
                const failed = scan?.state === 'failed' && scan.taskId === taskId;
                if (failed) setError(scan.error || 'The discography scan failed.');
                // Worbus P1: a followed scan (the worker's, or one started elsewhere) can end
                // without moving `scannedAt` past what this page saw; its record says it ended.
                const finished = scan?.state === 'done' && scan.taskId === taskId;
                // A scan that retries MusicBrainz can take a few minutes; the
                // scan record says when it is really over, so waiting is cheap.
                if (
                    (data?.indexed && rescanned) ||
                    failed ||
                    finished ||
                    attempts * everyMs >= SCAN_FOLLOW_MS
                ) {
                    window.clearInterval(tick);
                    setPending(false);
                    // The page reads this artist from the mirror, which the
                    // poll above does not touch: without a pull of its own the
                    // new tiles would wait for the `index` frame, landing 1–3 s
                    // after the spinner stopped — or never, if that frame is
                    // lost (Ruling R23). A pull that finds nothing new costs
                    // ~100 bytes.
                    //
                    // `onLbBotAvailable`, not `requestIndexSync('index')`: the
                    // latter is dropped while a retry is pending, and this poll
                    // has just had lb-bot answer — whatever back-off the sync
                    // earned is over, so it is reset and the pull goes now.
                    if (data?.indexed && (rescanned || finished)) onLbBotAvailable();
                }
            }, everyMs);
            return true;
        },
        [ndId, needsMbid, p1Peer, queryClient],
    );

    return { error, indexArtist, note, pending };
};

/**
 * F7 (Call 13): lb-bot's scan record for an artist, which only the network read carries (the index
 * mirror has none). Read once when the page opens and every `pollMs` while a scan runs. Shares the
 * discography fallback's cache entry, so it costs no second request.
 */
export const useLbBotScanRead = (
    ndId: string,
    mbid: null | string | undefined,
    pollMs: null | number,
) => {
    const available = useLbBotAvailable();
    const shown = useMirrorShown();
    const query = useQuery({
        enabled: !!lbBot && available && !!ndId,
        gcTime: 5 * 60 * 1000,
        queryFn: () => lbBot!.discography(ndId, mbid ?? undefined),
        queryKey: ['lbbot', 'discography', ndId],
        refetchInterval: pollMs ?? false,
        refetchOnWindowFocus: false,
        staleTime: 0,
    });
    return {
        data: shown ? query.data : undefined,
        readAtMs: query.dataUpdatedAt > 0 ? query.dataUpdatedAt : null,
    };
};

/**
 * F7 (Call 8): a fill this machine's ledger does not hold (started from another device) is read once
 * from `/lb/album/status` by release-group and adopted into the ledger, so the album page's box and
 * the app-root watcher follow it from there. lb-bot answering `unknown` adopts nothing.
 */
const RUNNING_STATES = new Set(['downloading', 'placed', 'placing', 'queued', 'searching']);

export const useAdoptRemoteFill = (
    rgid: string,
    names: { album: string; artist: string },
    enabled: boolean,
) => {
    const available = useLbBotAvailable();
    useQuery({
        enabled: !!lbBot && available && enabled && !!rgid,
        gcTime: 60 * 1000,
        queryFn: async () => {
            const result = await lbBot!.albumStatus(undefined, rgid);
            const status = result.ok ? result.data : null;
            // Only a fill still running: a finished one (failed, cancelled, verified) is either this
            // machine's dismissed row or nothing to act on, and adopting it would bring it back.
            if (status && RUNNING_STATES.has(status.state) && status.releaseMbid) {
                const store = useActiveFillsStore.getState();
                if (!store.fills[rgid]) {
                    store.actions.start(rgid, status.releaseMbid, status.quality, {
                        album: status.album || names.album,
                        artist: status.artist || names.artist,
                    });
                    applyFillStatus(rgid, status);
                }
            }
            return status?.state ?? 'unknown';
        },
        queryKey: ['lbbot', 'adopt-fill', rgid],
        refetchOnWindowFocus: false,
        retry: false,
        staleTime: Infinity,
    });
};

/** The route whose advert says this hub proxies the override writes (I-019). */
const OVERRIDE_ROUTE = 'POST /lb/artist/override';

/**
 * Whether the override layer exists at all: lb-bot reachable and the hub
 * advertising the write route. Stricter than {@link useHubSupports}, which
 * assumes an EMPTY advert list means "supported": a hub that advertises nothing
 * predates this feature, and offering a picker its 404 would only answer with
 * "restart the hub" is worse than today's tooltip.
 */
export const useOverridesSupported = (): boolean => {
    const status = useLbBotStatus();
    return !!lbBot && !!status?.routes?.includes(OVERRIDE_ROUTE);
};

/**
 * The override map by Navidrome artist id (I-019), persisted so an artist page
 * opened offline still follows the user's choice. Refetched on welcome, on an
 * `index` frame and after a set or remove ({@link refreshLbBotOverrides}).
 *
 * A failed fetch THROWS rather than answering an empty map, so react-query keeps
 * the last good one — an empty map would silently send every overridden artist
 * back to its (possibly wrong or missing) tag.
 *
 * Returns the cached map even while lb-bot is down (a disabled query still
 * serves it); only the hub being switched off hides it (`useShownWithHub`).
 * `data` is undefined until a map exists; use {@link useEffectiveArtistMbid}
 * unless the whole map is wanted.
 */
/** "This lb-bot is older" (contract): once the list answered 404 with no code, or
 *  a set / remove answered 405, the override controls are hidden. Kept as query
 *  data so every hook sees it; not persisted. */
const OVERRIDES_OLDER_KEY = ['lbbot', 'overrides-older'] as const;
export const markOverridesOlder = (): void => {
    queryClient.setQueryData(OVERRIDES_OLDER_KEY, true);
};
export const useOverridesOlder = (): boolean =>
    useQuery<boolean>({
        enabled: false,
        gcTime: Infinity,
        initialData: false,
        queryFn: () => false,
        queryKey: OVERRIDES_OLDER_KEY,
        staleTime: Infinity,
    }).data;

/** The override controls (picker entry points, panel buttons) exist: the hub
 *  advertises the routes AND no answer has said this lb-bot is older. */
export const useOverrideControls = (): boolean => {
    const supported = useOverridesSupported();
    const older = useOverridesOlder();
    // Worbus P2: the override map is library data everyone reads; changing it is an admin's.
    const allowed = allows(useHubRoles(), 'artistMatch');
    return supported && !older && allowed;
};

const useOverridesQuery = <TData>(select: (raw: OverridesData) => TData) => {
    const available = useLbBotAvailable();
    const supported = useOverridesSupported();
    return useQuery<OverridesData, Error, TData>({
        enabled: !!lbBot && available && supported,
        gcTime: 60 * 60 * 1000,
        queryFn: async () => {
            const result = await lbBot!.overrides();
            if (!result.ok || !result.data) {
                // An lb-bot older than the hub: remember it, so the controls go.
                if (isOlderLbBot(result.status, result.code)) markOverridesOlder();
                throw new LbBotReadError(result);
            }
            if (queryClient.getQueryData(OVERRIDES_OLDER_KEY)) {
                queryClient.setQueryData(OVERRIDES_OLDER_KEY, false);
            }
            return {
                albums: result.data.albums,
                byNdId: overridesByNdId(result.data.artists),
                merges: result.data.merges,
                siblings: result.data.siblings,
                toCheck: result.data.toCheck,
            };
        },
        queryKey: OVERRIDES_KEY,
        refetchOnWindowFocus: false,
        retry: false,
        // Tolerates a body persisted before `toCheck` existed (a bare map).
        select: (raw) => select(normalizeOverridesData(raw)),
        staleTime: 10 * 60 * 1000,
    });
};

const selectByNdId = (data: OverridesData): OverridesByNdId => data.byNdId;
const selectAll = (data: OverridesData): OverridesData => data;

export const useLbBotOverrides = () => useShownWithHub(useOverridesQuery(selectByNdId));

/** The same cached read with the I-021 list: `toCheck` is null on an lb-bot that
 *  sends none. One query key, so the settings panel costs no extra request. */
export const useLbBotOverrideList = () => useShownWithHub(useOverridesQuery(selectAll));

/** `overrides[ndId]?.mbid ?? tagMbid` for one artist — the MBID every lb-bot call
 *  and MusicBrainz / ListenBrainz link for it should use. */
export const useEffectiveArtistMbid = (
    ndId: null | string | undefined,
    tagMbid: null | string | undefined,
): null | string | undefined => {
    const { data } = useLbBotOverrides();
    return effectiveArtistMbid(data, ndId, tagMbid);
};

/** Which of none / tag / override / override-same this artist is in. */
export const useArtistOverrideKind = (
    ndId: string,
    tagMbid: null | string | undefined,
): OverrideKind => {
    const { data } = useLbBotOverrides();
    return overrideKind(data, ndId, tagMbid);
};

/**
 * Choose, or clear, the MusicBrainz artist for one library artist (I-019).
 *
 * On success: refresh the override map first (so the page already resolves to the
 * new MBID), THEN follow the scan lb-bot started with the page's own
 * {@link useIndexArtist} flow — passed in, not a second watcher: the button that
 * owns it stays mounted when the picker closes, so its spinner and its mirror
 * pull outlive the dialog. lb-bot dedupes the scan on the one already running.
 * A remove falls back to the tag, and re-scans only when there is one.
 */
export const useArtistOverrideActions = (
    ndId: string,
    // Null from the settings panel: lb-bot starts the scan and the mirror's index
    // frame brings the result; a follow there would poll for a row that has
    // already unmounted.
    indexArtist: ((mbid: string, name: string) => Promise<boolean>) | null,
) => {
    const queryClient = useQueryClient();
    const [pending, setPending] = useState(false);
    const [failure, setFailure] = useState<null | OverrideFailure>(null);

    const settle = useCallback(async () => {
        await queryClient.invalidateQueries({ queryKey: OVERRIDES_KEY, refetchType: 'all' });
        // Worbus P1 (F7 walk): the artist's own read (`useLbBotScanRead`) carries the scan lb-bot
        // just started and `unresolved`; re-read it, so the page follows that scan and drops "couldn't
        // find this artist" even when the follow below cannot start.
        await queryClient.invalidateQueries({ queryKey: ['lbbot', 'discography', ndId] });
    }, [ndId, queryClient]);

    const set = useCallback(
        async (mbid: string, name: string): Promise<LbBotResult<LbBotOverrideSet>> => {
            setPending(true);
            setFailure(null);
            const result = await lbBot!.overrideSet(ndId, mbid, name);
            if (!result.ok) {
                if (isOlderLbBot(result.status, result.code)) markOverridesOlder();
                setFailure(describeOverrideFailure(result));
            } else {
                await settle();
                // lb-bot starts the scan itself; `task_id: ""` is its decision to
                // start none, and a scan from here would rewrite the wrong row.
                const scan = planScan(
                    'set',
                    { mbid: result.data?.mbid, taskId: result.data?.taskId ?? '' },
                    { mbid, name, tagMbid: undefined },
                );
                if (scan && indexArtist) void indexArtist(scan.mbid, scan.name);
            }
            setPending(false);
            return result;
        },
        [indexArtist, ndId, settle],
    );

    const remove = useCallback(
        async (
            tagMbid: null | string | undefined,
            name: string,
        ): Promise<LbBotResult<LbBotOverrideRemoved>> => {
            setPending(true);
            setFailure(null);
            const result = await lbBot!.overrideRemove(ndId);
            if (!result.ok) {
                if (isOlderLbBot(result.status, result.code)) markOverridesOlder();
                setFailure(describeOverrideFailure(result));
            } else {
                await settle();
                const scan = planScan(
                    'remove',
                    { taskId: result.data?.taskId ?? '' },
                    { mbid: '', name, tagMbid },
                );
                if (scan && indexArtist) void indexArtist(scan.mbid, scan.name);
            }
            setPending(false);
            return result;
        },
        [indexArtist, ndId, settle],
    );

    return { failure, pending, remove, set };
};

// ---------------------------------------------------------------------------
// Album override (I-022): "Fix album match"
// ---------------------------------------------------------------------------

/** The route whose advert says this hub proxies the album-override writes. */
const ALBUM_OVERRIDE_ROUTE = 'POST /lb/album/override';

/** "This lb-bot is older" for the album surface: a 405 on a write or a code-less
 *  404 on a read. Query data so every entry point sees it; not persisted. */
const ALBUM_OVERRIDE_OLDER_KEY = ['lbbot', 'album-override-older'] as const;
export const markAlbumOverrideOlder = (): void => {
    queryClient.setQueryData(ALBUM_OVERRIDE_OLDER_KEY, true);
};
const useAlbumOverrideOlder = (): boolean =>
    useQuery<boolean>({
        enabled: false,
        gcTime: Infinity,
        initialData: false,
        queryFn: () => false,
        queryKey: ALBUM_OVERRIDE_OLDER_KEY,
        staleTime: Infinity,
    }).data;

/**
 * The "Fix album match" entry points exist: the hub advertises the write route
 * AND no answer has said this lb-bot is older. Strict like
 * {@link useOverridesSupported} (an EMPTY advert is a hub that predates the
 * feature, not one that supports it), and gated on the contract's route.
 */
export const useAlbumOverrideControls = (): boolean => {
    const status = useLbBotStatus();
    const older = useAlbumOverrideOlder();
    const allowed = allows(useHubRoles(), 'albumMatch');
    return !!lbBot && !!status?.routes?.includes(ALBUM_OVERRIDE_ROUTE) && !older && allowed;
};

/** Marks "older" for the answers that mean it, then hands the result back. */
const noteAlbumResult = <T>(result: LbBotResult<T>): LbBotResult<T> => {
    if (!result.ok && isOlderLbBot(result.status, result.code)) markAlbumOverrideOlder();
    return result;
};

/**
 * The album as lb-bot has it now, plus its override row. The RESULT is the data
 * (a 404 `unknown_album` or an older lb-bot is an answer to show, not a thrown
 * error), and nothing is kept: tags change under this read.
 */
export const useAlbumOverrideState = (albumId: string, enabled = true) =>
    useQuery<LbBotResult<LbBotAlbumState>>({
        enabled: !!lbBot && !!albumId && enabled,
        gcTime: 0,
        queryFn: async () => noteAlbumResult(await lbBot!.albumOverride({ albumId })),
        queryKey: ['lbbot', 'album-override', albumId],
        refetchOnWindowFocus: false,
        retry: false,
        staleTime: 0,
    });

/**
 * A release group for an album lb-bot could not name (`rgid: ""`): one fielded
 * lookup, the answer validated against what was asked ({@link pickAlbumCandidate} -
 * never the first hit). `null` is "declined", a correct outcome; undefined while
 * unread; a failed lookup is an ERROR (`isError`), never an answer.
 */
export const useAlbumRgidLookup = (artist: string, title: string, enabled: boolean) =>
    useQuery<LbBotAlbumCandidate | null>({
        enabled: !!lbBot && enabled && !!title,
        gcTime: 10 * 60 * 1000,
        queryFn: async () => {
            const query = fieldedAlbumQuery(artist, title);
            if (!query) return null;
            const result = await lbBot!.albumLookupChecked(query);
            // A failed lookup THROWS: an error is not kept as an answer, and the
            // modal says the lookup failed (not that lb-bot does not know the album).
            if (!result.ok || !result.data) throw new LbBotReadError(result);
            return pickAlbumCandidate(result.data, { artist, title });
        },
        queryKey: ['lbbot', 'album-rgid-lookup', artist, title],
        refetchOnWindowFocus: false,
        retry: false,
        staleTime: 10 * 60 * 1000,
    });

/** Cover Art Archive candidates for the release in question. Result-shaped, and a
 *  failure is not kept (a 502 means "ask again"). */
export const useAlbumCovers = (rgid: string, releaseMbid: string, enabled: boolean) =>
    useQuery<LbBotResult<LbBotCover[]>>({
        enabled: !!lbBot && enabled && !!(rgid || releaseMbid),
        gcTime: 10 * 60 * 1000,
        queryFn: async () => noteAlbumResult(await lbBot!.albumCovers({ releaseMbid, rgid })),
        queryKey: ['lbbot', 'album-covers', rgid, releaseMbid],
        refetchOnWindowFocus: false,
        retry: false,
        staleTime: (query) => (query.state.data?.ok ? 5 * 60 * 1000 : 0),
    });

/** What an apply of this release would do to this album's files. Writes nothing,
 *  so it is a query; never kept for long (the files it describes change). */
export const useAlbumPreview = (albumId: string, releaseMbid: null | string) =>
    useQuery<LbBotResult<LbBotPreview>>({
        enabled: !!lbBot && !!albumId && !!releaseMbid,
        gcTime: 60 * 1000,
        queryFn: async () =>
            noteAlbumResult(await lbBot!.albumPreview(albumId, releaseMbid as string)),
        queryKey: ['lbbot', 'album-preview', albumId, releaseMbid],
        refetchOnWindowFocus: false,
        retry: false,
        staleTime: 0,
    });

export const applyAlbumOverride = async (args: {
    albumId: string;
    coverUrl?: string;
    force?: boolean;
    releaseMbid: string;
}): Promise<LbBotResult<LbBotAlbumJob>> => noteAlbumResult(await lbBot!.albumOverrideApply(args));

export const setAlbumCover = async (
    albumId: string,
    coverUrl: string,
): Promise<LbBotResult<LbBotAlbumCoverSet>> =>
    noteAlbumResult(await lbBot!.albumCoverSet(albumId, coverUrl));

export const removeAlbumOverride = async (id: string): Promise<LbBotResult<LbBotAlbumJob>> =>
    noteAlbumResult(await lbBot!.albumOverrideRemove(id));

/**
 * Follow an apply or a remove: `GET /lb/album/override?id=` every 2 s through the
 * pure {@link pollStep} machine (a failed poll is not an answer; three minutes
 * and it gives up). The loop outlives the modal on purpose - closing the dialog
 * does not stop lb-bot - and refreshes the override list when it ends, mounted
 * or not. The `library` frame the hub relays when Navidrome has re-indexed is
 * what refreshes the album and discography queries; nothing here refetches those.
 */
const useJobPoll = <TRow extends PollRow>(read: (id: string) => Promise<PollAnswer<TRow>>) => {
    const [state, setState] = useState<null | PollState<TRow>>(null);
    const token = useRef(0);
    const mounted = useRef(true);
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);

    /**
     * `seedState` is the state lb-bot already gave the row - the POST's own 200, or
     * the row of a job being picked up - so a remove/undo that failed before the
     * first tick is seen (X1). `onEnd` runs mounted or not.
     */
    const start = useCallback(
        (
            id: string,
            spec: PollSpec,
            options: { onEnd?: (ended: PollState<TRow>) => void; seedState?: string } = {},
        ) => {
            const mine = ++token.current;
            void runJob<TRow>({
                id,
                isCurrent: () => mine === token.current,
                now: () => Date.now(),
                onEnd: (ended) => {
                    void queryClient.invalidateQueries({
                        queryKey: OVERRIDES_KEY,
                        refetchType: 'all',
                    });
                    options.onEnd?.(ended);
                },
                onState: (next) => {
                    if (mine === token.current && mounted.current) setState(next);
                },
                read,
                seedState: options.seedState,
                spec,
                wait: (ms) => new Promise((resolve) => window.setTimeout(resolve, ms)),
            });
        },
        [read],
    );

    const reset = useCallback(() => {
        token.current += 1;
        setState(null);
    }, []);

    return { reset, start, state };
};

const readAlbumRow = async (id: string): Promise<PollAnswer<LbBotAlbumOverrideRow>> => {
    const result = await lbBot!
        .albumOverride({ id })
        .catch(
            (): LbBotResult<LbBotAlbumState> => ({ data: null, error: '', ok: false, status: 0 }),
        );
    const row = result.ok ? result.data?.override : null;
    return row
        ? { ok: true, row }
        : { code: result.code ?? '', ok: false, status: result.ok ? 0 : result.status };
};

const readMergeRow = async (id: string): Promise<PollAnswer<LbBotMergeRow>> => {
    const result = await lbBot!
        .mergeGet(id)
        .catch((): LbBotResult<LbBotMergeRow> => ({ data: null, error: '', ok: false, status: 0 }));
    return result.ok && result.data
        ? { ok: true, row: result.data }
        : { code: result.code ?? '', ok: false, status: result.ok ? 0 : result.status };
};

export const useAlbumJobPoll = () => useJobPoll<LbBotAlbumOverrideRow>(readAlbumRow);

// ---------------------------------------------------------------------------
// Artist name merge (I-023): "Merge into one name"
// ---------------------------------------------------------------------------

const MERGE_ROUTE = 'POST /lb/artist/merge';
const MERGE_OLDER_KEY = ['lbbot', 'artist-merge-older'] as const;
export const markMergeOlder = (): void => {
    queryClient.setQueryData(MERGE_OLDER_KEY, true);
};
const useMergeOlder = (): boolean =>
    useQuery<boolean>({
        enabled: false,
        gcTime: Infinity,
        initialData: false,
        queryFn: () => false,
        queryKey: MERGE_OLDER_KEY,
        staleTime: Infinity,
    }).data;

/** The merge surfaces exist: the hub advertises the route (strictly, like the
 *  override controls) and no answer has said this lb-bot is older. */
export const useMergeControls = (): boolean => {
    const status = useLbBotStatus();
    const older = useMergeOlder();
    const allowed = allows(useHubRoles(), 'merge');
    return !!lbBot && !!status?.routes?.includes(MERGE_ROUTE) && !older && allowed;
};

const noteMergeResult = <T>(result: LbBotResult<T>): LbBotResult<T> => {
    if (!result.ok && isOlderLbBot(result.status, result.code)) markMergeOlder();
    return result;
};

/** The same-MBID groups from the cached override list: null = unknown, [] = none. */
export const useLbBotSiblings = (): LbBotSiblingGroup[] | null | undefined =>
    useLbBotOverrideList().data?.siblings;

export interface MergePlan {
    /** The spelling that is rewritten (`from_nd_id`). */
    fromNdId: string;
    /** The artist whose name is kept (`nd_id`). */
    ndId: string;
}

/** "N files in M albums" for keeping `plan.ndId`'s name. Writes nothing. */
export const useMergePreview = (plan: MergePlan | null, enabled: boolean) =>
    useQuery<LbBotResult<LbBotMergePreview>>({
        enabled: !!lbBot && enabled && !!plan,
        gcTime: 60 * 1000,
        queryFn: async () => noteMergeResult(await lbBot!.mergePreview(plan as MergePlan)),
        queryKey: ['lbbot', 'merge-preview', plan?.ndId ?? '', plan?.fromNdId ?? ''],
        refetchOnWindowFocus: false,
        retry: false,
        staleTime: 0,
    });

export const startArtistMerge = async (plan: MergePlan): Promise<LbBotResult<LbBotMergeJob>> =>
    noteMergeResult(await lbBot!.mergeStart(plan));

export const undoArtistMerge = async (id: string): Promise<LbBotResult<LbBotMergeJob>> =>
    noteMergeResult(await lbBot!.mergeUndo(id));

export const useMergeJobPoll = () => useJobPoll<LbBotMergeRow>(readMergeRow);

// ---------------------------------------------------------------------------
// Listening history (I-006)
// ---------------------------------------------------------------------------

const LISTENING_ROUTE = 'GET /lb/listening/summary';

/**
 * Whether the My Listening surface exists: lb-bot reachable and the hub's
 * advert, non-empty, includes the summary route. An EMPTY advert means an old
 * hub, not support (so not {@link useHubSupports}).
 */
export const useListeningSupported = (): boolean => {
    const status = useLbBotStatus();
    // Worbus P1: a refused lb-bot (B-263) is as gone as an unreachable one, so Statistics leaves
    // the sidebar, the palette and the route instead of 401ing behind an older hub.
    const available = useLbBotAvailable();
    // Worbus P2: the listening history is the primary user's; lb-bot answers anyone else 403.
    const allowed = allows(useHubRoles(), 'listening');
    return !!lbBot && available && allowed && !!status?.routes?.includes(LISTENING_ROUTE);
};

/** A failed lb-bot read, carrying the HTTP status so a 404 / 405 (lb-bot older
 *  than the hub) can hide the surface instead of being reported as an error. */
export class LbBotReadError extends Error {
    code?: string;
    /** A refusal (`isLbRefusal`): the app-wide query error toast skips it. */
    quiet: boolean;
    status: number;
    constructor(result: LbBotResult<unknown>, fallback = 'lb-bot could not answer.') {
        super(result.error || fallback);
        this.code = result.code;
        this.quiet = isLbRefusal(result.code);
        this.status = result.status;
    }
}

export const isListeningUnavailable = (error: unknown): boolean =>
    error instanceof LbBotReadError && error.status === 404;

const unwrapListening = <T>(result: LbBotResult<T>): T => {
    if (!result.ok || !result.data) throw new LbBotReadError(result);
    return result.data;
};

/** The zone lb-bot buckets days and hours in; its own container runs in UTC. */
export const listeningTimeZone = (): string => {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
        return 'UTC';
    }
};

/** Sync state of the listens mirror. Polled every 5 s ONLY while it says importing. */
export const useListeningStatus = () => {
    const supported = useListeningSupported();
    const query = useQuery<LbBotListeningStatus>({
        enabled: supported,
        gcTime: 10 * 60 * 1000,
        queryFn: async () => unwrapListening(await lbBot!.listeningStatus()),
        queryKey: ['lbbot', 'listening-status'],
        refetchInterval: (q) => (q.state.data?.state === 'importing' ? 5000 : false),
        refetchOnWindowFocus: false,
        retry: false,
        staleTime: 30 * 1000,
    });
    // When an import ends, re-read what was read while it ran: otherwise the
    // summary keeps its partial totals, with no "Importing" label, until its
    // 5-minute staleTime runs out.
    const state = query.data?.state;
    const previous = useRef<LbBotListeningStatus['state'] | undefined>(undefined);
    useEffect(() => {
        if (state && importFinished(previous.current, state)) {
            for (const kind of ['listening-summary', 'listening-unowned', 'listening-recent']) {
                void queryClient.invalidateQueries({
                    queryKey: ['lbbot', kind],
                    refetchType: 'all',
                });
            }
        }
        previous.current = state;
    }, [state]);
    return query;
};

/**
 * The aggregates for a period. Persisted (`persisted-queries.ts`) so the last body
 * paints offline; a failed fetch throws, which keeps it. While the mirror is still
 * importing it is re-read every 15 s, so the numbers under "Importing N of M" move.
 */
export const useListeningSummary = (
    period: LbBotListeningPeriod,
    importing = false,
    // False while the status says `off` or an answer said this lb-bot is older:
    // there is nothing to read, and asking only collects errors.
    enabled = true,
) => {
    const supported = useListeningSupported() && enabled;
    const tz = listeningTimeZone();
    const query = useQuery<LbBotListeningSummary>({
        enabled: supported,
        gcTime: 30 * 60 * 1000,
        placeholderData: keepPreviousData,
        queryFn: async () => unwrapListening(await lbBot!.listeningSummary(period, tz)),
        queryKey: ['lbbot', 'listening-summary', period, tz],
        refetchInterval: importing ? 15_000 : false,
        refetchOnWindowFocus: false,
        retry: false,
        staleTime: 5 * 60 * 1000,
    });
    return useShownWithHub(query);
};

/** "Most played, not in your library" — albums or artists the library does not hold. */
export const useListeningUnowned = (
    period: LbBotListeningPeriod,
    kind: 'album' | 'artist',
    enabled = true,
) => {
    const supported = useListeningSupported() && enabled;
    return useQuery<LbBotUnowned>({
        enabled: supported,
        gcTime: 10 * 60 * 1000,
        // No placeholder: the Albums / Artists toggle would show the OTHER kind's rows.
        queryFn: async () => unwrapListening(await lbBot!.listeningUnowned(period, kind, 30)),
        queryKey: ['lbbot', 'listening-unowned', period, kind],
        refetchOnWindowFocus: false,
        retry: false,
        staleTime: 5 * 60 * 1000,
    });
};

/** Recent plays, newest first, paged on `nextBefore`. */
export const useListeningRecent = (enabled = true) => {
    const supported = useListeningSupported() && enabled;
    return useInfiniteQuery<
        LbBotRecent,
        Error,
        { pages: LbBotRecent[] },
        string[],
        number | undefined
    >({
        enabled: supported,
        gcTime: 10 * 60 * 1000,
        getNextPageParam: (last) => last.nextBefore ?? undefined,
        initialPageParam: undefined,
        queryFn: async ({ pageParam }) =>
            unwrapListening(await lbBot!.listeningRecent(50, pageParam)),
        queryKey: ['lbbot', 'listening-recent'],
        refetchOnWindowFocus: false,
        retry: false,
        staleTime: 60 * 1000,
    });
};

/**
 * Ask lb-bot to pull from ListenBrainz now. It answers at once; the caller sees
 * the result as the status moving, so this re-reads status right away and again
 * a few seconds on (the worker flips to importing / ready after the answer).
 */
export const requestListeningSync = async (): Promise<LbBotResult<boolean>> => {
    if (!lbBot) return { data: null, error: 'Not available here.', ok: false, status: 0 };
    const result = await lbBot.listeningSync();
    if (result.ok) {
        const reread = () =>
            void queryClient.invalidateQueries({
                queryKey: ['lbbot', 'listening-status'],
                refetchType: 'all',
            });
        reread();
        window.setTimeout(reread, 3000);
    }
    return result;
};

/**
 * Teach the index about one release-group, then re-read the discography.
 *
 * The case this exists for is constant rather than rare: lb-bot serves a stored
 * discography immediately even when stale *by design*, so a release published
 * since the last scan is simply absent — which is every row the Fresh tab leads
 * to. A full rescan for one album is a MusicBrainz request per second per
 * release-group, so it is never the answer here.
 *
 * Fires once per rgid and remembers that it did, including on failure: this runs
 * from a render effect on a page the user is looking at, and a route that is not
 * there (an older hub) or a MusicBrainz outage would otherwise retry forever.
 */
export const useIndexRelease = (ndId: string, artistMbid: string) => {
    const queryClient = useQueryClient();
    const tried = useRef(new Set<string>());

    return useCallback(
        async (
            rgid: string,
            opts: {
                artist?: string;
                external?: boolean;
                name?: string;
                title?: string;
                type?: string;
                year?: string;
            } = {},
        ) => {
            if (!lbBot || !rgid || tried.current.has(rgid)) return false;
            if (!artistMbid && !ndId) return false;
            tried.current.add(rgid);
            const result = await lbBot.indexRelease({
                artist: opts.artist,
                external: opts.external,
                mbid: artistMbid,
                name: opts.name,
                ndId,
                rgid,
                title: opts.title,
                type: opts.type,
                year: opts.year,
            });
            if (!result.ok) return false;
            await queryClient.invalidateQueries({ queryKey: ['lbbot', 'discography', ndId] });
            // A mirrored artist never reads that query, so the new row would
            // otherwise wait for the `index` frame — dropped while a retry is
            // pending, and losable. Pull now, as `useIndexArtist` does (R23).
            onLbBotAvailable();
            return true;
        },
        [ndId, artistMbid, queryClient],
    );
};

/**
 * Site-wide fresh releases, recent and upcoming.
 *
 * Unrelated to the home page's carousels, which query the user's own library.
 * lb-bot caches the ListenBrainz feed for an hour and the hub for a minute, so
 * this is cheap to re-enter — but there is nothing to poll for either.
 */
export const useLbBotFreshReleases = (days: number) => {
    const available = useLbBotAvailable();
    const query = useQuery({
        enabled: !!lbBot && available,
        // Every lb-bot hook sets its own `gcTime`, never below its `staleTime`:
        // the app default is 20 s, which drops an unwatched entry long before a
        // ten-minute staleness could ever matter and makes every re-entry a
        // fresh round trip. Persisted across restarts too (`main.tsx`).
        gcTime: 30 * 60 * 1000,
        // Switching the window keeps the previous window's rows on screen until
        // the new one answers, instead of blanking the page to a spinner and
        // back — the rows are the same shape, and most of them are the same rows.
        placeholderData: keepPreviousData,
        queryFn: () => lbBot!.freshReleases(days),
        queryKey: ['lbbot', 'fresh-releases', days],
        refetchOnWindowFocus: false,
        staleTime: 10 * 60 * 1000,
    });
    return useShownWithHub(query);
};

/**
 * MusicBrainz artist search — the "Not in your library" half of search.
 *
 * Until `/lb/artist/lookup` was whitelisted, a client could only reach an
 * external artist page if it already held an MBID from a Fresh row, which
 * blocked every acquisition path that starts with "I want this artist".
 *
 * Deliberately not fired on every keystroke: it is a live MusicBrainz search
 * behind lb-bot's global 1 req/sec lock, so the caller passes the *debounced*
 * query and short queries are skipped outright.
 */
const LOOKUP_MIN_LENGTH = 3;

export const useLbBotArtistLookup = (query: string, enabled = true) => {
    const available = useLbBotAvailable();
    const term = query.trim();
    const result = useQuery<LbBotArtistCandidate[]>({
        enabled: !!lbBot && available && enabled && term.length >= LOOKUP_MIN_LENGTH,
        gcTime: 10 * 60 * 1000,
        queryFn: () => lbBot!.artistLookup(term),
        queryKey: ['lbbot', 'artist-lookup', term],
        refetchOnWindowFocus: false,
        // A search ranking, not an entity — but stable enough within a session
        // that retyping the same term should not cost another MusicBrainz second.
        staleTime: 10 * 60 * 1000,
    });
    return useShownWithHub(result);
};

/**
 * MusicBrainz album search — the other half of "Not in your library".
 *
 * Same 1 req/sec lock, so the same rules: debounced term only, and nothing
 * shorter than {@link LOOKUP_MIN_LENGTH}. Note both lookups share that one
 * global second, so a search box firing them together spends two.
 *
 * Unlike the artist lookup, an owned hit is *not* dropped and not routed
 * externally: lb-bot marks ownership by release-group id, which is exact, and
 * `releaseAlbumId` is where the tap goes.
 */
export const useLbBotAlbumLookup = (query: string, enabled = true) => {
    const available = useLbBotAvailable();
    const term = query.trim();
    const result = useQuery<LbBotAlbumCandidate[]>({
        enabled: !!lbBot && available && enabled && term.length >= LOOKUP_MIN_LENGTH,
        gcTime: 10 * 60 * 1000,
        queryFn: () => lbBot!.albumLookup(term),
        queryKey: ['lbbot', 'album-lookup', term],
        refetchOnWindowFocus: false,
        staleTime: 10 * 60 * 1000,
    });
    return useShownWithHub(result);
};

/**
 * "Similar albums" for an album page.
 *
 * lb-bot has answered this route since the Fresh work shipped and no client has
 * ever called it — step 5 of DESIGN-lbbot-client-integration.md, left unticked.
 *
 * It needs the *artist*, not the album: similarity is computed artist-to-artist
 * (ListenBrainz, cross-checked with Last.fm) and rolled up to one album each.
 * `rgid` only excludes the album you are on, and lb-bot backfills the slot.
 *
 * Empty is the common case on a small or unindexed library, and it is not an
 * error — the shelf renders nothing.
 */
export const useLbBotSimilarAlbums = (args: {
    artistMbid?: null | string;
    artistName?: null | string;
    rgid?: null | string;
}) => {
    const available = useLbBotAvailable();
    const { artistMbid, artistName, rgid } = args;
    const query = useQuery<LbBotSimilarAlbums | null>({
        enabled: !!lbBot && available && !!(artistMbid || artistName),
        gcTime: 60 * 60 * 1000,
        queryFn: () =>
            lbBot!.albumSimilar({
                artistMbid: artistMbid ?? undefined,
                artistName: artistName ?? undefined,
                rgid: rgid ?? undefined,
            }),
        queryKey: ['lbbot', 'album-similar', artistMbid || artistName, rgid],
        refetchOnWindowFocus: false,
        // The hub holds this for hours and lb-bot caches the similarity for 24h.
        staleTime: 60 * 60 * 1000,
    });
    return useShownWithHub(query);
};

/**
 * "Fans also like" — similar artists, the ones you do not own included.
 *
 * The sibling `useLbBotSimilarAlbums` is deliberately a shelf of records you
 * already have. This is the other reading of the same merge: lb-bot marks each
 * row `owned` / `indexed` rather than filtering, so the unowned artists — the
 * point of a Discover row — survive to the client.
 *
 * Gated on `useHubSupports` as well as availability: the route is newer than
 * some hubs, and a hub that has not been restarted answers 404, which
 * `describeFailure` reports as "the hub is older than this app".
 *
 * Empty is the common case on a cold library and is not an error.
 */
export const useLbBotSimilarArtists = (args: {
    limit?: number;
    mbid?: null | string;
    name?: null | string;
}) => {
    const available = useLbBotAvailable();
    const supported = useHubSupports('GET /lb/artist/similar');
    const { limit, mbid, name } = args;
    const query = useQuery<LbBotSimilarArtists | null>({
        enabled: !!lbBot && available && supported && !!(mbid || name),
        gcTime: 60 * 60 * 1000,
        queryFn: () =>
            lbBot!.artistSimilar({
                limit,
                mbid: mbid ?? undefined,
                name: name ?? undefined,
            }),
        queryKey: ['lbbot', 'artist-similar', mbid || name, limit],
        refetchOnWindowFocus: false,
        // lb-bot caches the merge for 24h; what moves inside that window is the
        // ownership marking, which the hub keeps on its short TTL. An hour here
        // is well inside both and saves re-asking as the row's seed rotates
        // back around.
        staleTime: 60 * 60 * 1000,
    });
    return useShownWithHub(query);
};

/**
 * Editorial "About" for an artist: the real, full-length, attributed text this
 * page has never had — Navidrome's Last.fm agent returns a summary that ends in
 * a "Read more on Last.fm" anchor and nothing else.
 *
 * `mbid` is strongly preferred; passing only a name costs lb-bot a MusicBrainz
 * search and takes its top hit, which for a generically-named artist is a
 * coin toss. Both are accepted because Navidrome does not always carry an MBID.
 *
 * `staleTime: Infinity` — the text is an encyclopaedia article, lb-bot caches it
 * for 30 days and the hub for six hours. Asking again within a session is pure
 * round trip.
 */
export const useLbBotArtistMeta = (mbid?: null | string, name?: null | string) => {
    const available = useLbBotAvailable();
    const query = useQuery<LbBotMeta | null>({
        enabled: !!lbBot && available && !!(mbid || name),
        // Matched to `staleTime`: an answer that never goes stale must not be
        // dropped 20 s after the page closes. Persisted across restarts as
        // well (`main.tsx`), so an artist opened yesterday paints its About
        // from disk. The fail-soft null is the exception on both counts
        // (`staleUnlessAnswered`): kept, but asked again on the next mount.
        gcTime: Infinity,
        queryFn: () =>
            lbBot!.metaArtist({
                mbid: mbid ?? undefined,
                name: mbid ? undefined : (name ?? undefined),
            }),
        queryKey: ['lbbot', 'meta-artist', mbid || `name:${name}`],
        refetchOnWindowFocus: false,
        staleTime: staleUnlessAnswered(Infinity),
    });
    return useShownWithHub(query);
};

/** The release-groups whose persisted About was re-asked for Find it this session (F4). */
const findItAsked = new Set<string>();

/** The same for a release-group, plus release credits. `releaseMbid` is an
 *  optimisation, not a requirement: it saves lb-bot resolving the canonical
 *  release at one rate-limited MusicBrainz request per second.
 *
 *  `options.findIt`: the page shows Find it links (the not-owned album page). Only there is a
 *  persisted body without them asked again (F4); an owned page never shows them, and each ask
 *  can cost lb-bot MusicBrainz requests. */
export const useLbBotAlbumMeta = (
    rgid?: null | string,
    releaseMbid?: null | string,
    options: { findIt?: boolean } = {},
) => {
    const available = useLbBotAvailable();
    const p1Peer = useIsP1Peer();
    const wantsFindIt = options.findIt === true;
    const queryClient = useQueryClient();
    const query = useQuery<LbBotMeta | null>({
        enabled: !!lbBot && available && !!rgid,
        gcTime: Infinity,
        queryFn: () => lbBot!.metaAlbum({ releaseMbid: releaseMbid ?? undefined, rgid: rgid! }),
        queryKey: ['lbbot', 'meta-album', rgid],
        refetchOnWindowFocus: false,
        staleTime: staleUnlessAnswered(Infinity),
    });
    // Worbus P1 (F4): this body is persisted and never goes stale, so one saved before lb-bot sent
    // Find it links has no `findIt` key. A P1 peer is asked again for it, once per release-group
    // per app session - never in a loop when lb-bot legitimately leaves the key out. Not a
    // `refetch()`: the read answers null on any failure, and that null would replace the good
    // body on screen and on disk. The answer replaces the body only when there is one.
    const { data } = query;
    useEffect(() => {
        if (!wantsFindIt || !lbBot || !p1Peer || !available || !rgid) return;
        if (!data || 'findIt' in data || findItAsked.has(rgid)) return;
        findItAsked.add(rgid);
        const client = lbBot;
        void (async () => {
            try {
                const fresh = await client.metaAlbum({
                    releaseMbid: releaseMbid ?? undefined,
                    rgid,
                });
                if (fresh) queryClient.setQueryData(['lbbot', 'meta-album', rgid], fresh);
            } catch {
                // Kept as it was: Find it waits for the next session's ask.
            }
        })();
    }, [available, data, p1Peer, queryClient, releaseMbid, rgid, wantsFindIt]);
    return useShownWithHub(query);
};

/**
 * "Refresh About" (I-020): ask lb-bot to bypass its caches (`refresh=1`) and
 * REPLACE the cached, persisted body with the answer. Resolves to the sentence to
 * show: a failure leaves the existing body alone and says what is known about it
 * (`classifyRefresh`); "the same" is claimed only for a successful, identical answer.
 */
const refreshMeta = async (
    key: readonly unknown[],
    args: Parameters<NonNullable<typeof lbBot>['metaRefresh']>[0],
): Promise<{ message: string; ok: boolean }> => {
    if (!lbBot) return { message: 'Not available here.', ok: false };
    const result = await lbBot.metaRefresh(args);
    const current = queryClient.getQueryData<LbBotMeta | null>(key);
    const same = result.ok && !!current && JSON.stringify(current) === JSON.stringify(result.data);
    // An answer without About content (`found: false` and nothing else) never
    // replaces a shown body, whatever it is; neither does one equal to it.
    if (result.ok && metaHasContent(result.data) && !same) {
        queryClient.setQueryData(key, result.data);
    }
    return { message: classifyRefresh(result, same), ok: result.ok };
};

export const refreshArtistMeta = (
    mbid: null | string | undefined,
    name: null | string | undefined,
) =>
    refreshMeta(['lbbot', 'meta-artist', mbid || `name:${name}`], {
        kind: 'artist',
        mbid: mbid ?? undefined,
        name: mbid ? undefined : (name ?? undefined),
    });

export const refreshAlbumMeta = (
    rgid: null | string | undefined,
    releaseMbid: null | string | undefined,
) =>
    refreshMeta(['lbbot', 'meta-album', rgid], {
        kind: 'album',
        releaseMbid: releaseMbid ?? undefined,
        rgid: rgid ?? undefined,
    });

/** Editions of one release-group. Sits on MusicBrainz upstream — show a skeleton. */
export const useLbBotAlbumReleases = (rgid: null | string) =>
    useShownWithHub(
        useQuery<LbBotReleaseDetail | null>({
            enabled: !!lbBot && !!rgid,
            gcTime: Infinity,
            queryFn: () => lbBot!.albumReleases(rgid!),
            queryKey: ['lbbot', 'album-releases', rgid],
            // Which editions a release-group has does not change; the hub holds
            // this for hours and there is no reason for the renderer to ask again
            // — unless what it holds is a failure (`staleUnlessAnswered`).
            staleTime: staleUnlessAnswered(Infinity),
        }),
    );

/** Canonical tracklist for one release. */
export const useLbBotTracklist = (releaseMbid: null | string) =>
    useShownWithHub(
        useQuery<LbBotTracklist | null>({
            enabled: !!lbBot && !!releaseMbid,
            gcTime: Infinity,
            queryFn: () => lbBot!.albumTracklist(releaseMbid!),
            queryKey: ['lbbot', 'tracklist', releaseMbid],
            staleTime: staleUnlessAnswered(Infinity),
        }),
    );

/** States nothing further will happen from. `placed` is deliberately absent:
 *  the interesting transition is placed → verified, which is Navidrome
 *  confirming the files are actually in the library. */
const TERMINAL_STATES = new Set<string>(['cancelled', 'failed', 'needs_match', 'verified']);

/**
 * Bounded patience for `unknown`.
 *
 * `unknown` is ambiguous: it is both "this release has no fill" and "the
 * download POST returned but lb-bot's worker thread hasn't written its first
 * ledger row yet", which is the normal first second or two after a tap. So a
 * fresh fill ignores it for a grace period, and an established one settles
 * `gaveUp` only after lb-bot has said it CONTINUOUSLY for two minutes — a
 * window measured on the clock, not in ticks, because ticks now arrive from a
 * 30 s poll, a 5 s poll and the hub's push alike.
 */
const UNKNOWN_GRACE_MS = 30 * 1000;
const UNKNOWN_SETTLE_MS = 120 * 1000;

/** How long a fill may go without MOVING (state, files or bytes) before we
 *  stop believing in it. Measured from the last progress, not from the tap: a
 *  slow peer is not a dead fill. */
const WATCH_TIMEOUT_MS = 20 * 60 * 1000;

/** The poll floor, and how many identical answers it takes to step off it. */
const POLL_BASE_MS = 5000;
const QUIET_TICKS_FIRST = 4;
const QUIET_TICKS_SECOND = 10;

/** While the hub socket is up and a `fill` push or a fills answer arrived
 *  within PUSH_FRESH_MS, the poll is only a safety net and runs slowly. */
const PUSHED_POLL_MS = 30 * 1000;
const PUSH_FRESH_MS = 60 * 1000;

/**
 * How long before the next poll, given how many consecutive identical answers.
 *
 * Five seconds stays the answer for anything that is moving. An unchanged
 * payload is free information: back off, and snap back the moment it differs.
 */
const pollInterval = (quietTicks: number): number => {
    if (quietTicks < QUIET_TICKS_FIRST) return POLL_BASE_MS;
    if (quietTicks < QUIET_TICKS_SECOND) return POLL_BASE_MS * 2;
    return POLL_BASE_MS * 4;
};

/**
 * What the ledger watcher below registers so the two entry points that are not
 * React — a `fill` frame off the hub socket, and a cancel button — can reach the
 * query cache and the library refresh.
 */
const registry: {
    /** The `sourcesFoundAt` each gap's full view was last re-read for (B-042), so a
     *  summary reporting sources the cache holds no rows for costs one `/lb/gap`,
     *  not one per poll tick. */
    gapSourceReads: Map<string, number>;
    lastPushAt: number;
    queryClient: null | QueryClient;
    refresh: ((ndArtistId?: string, landing?: LbBotLibraryLanding) => void) | null;
} = { gapSourceReads: new Map(), lastPushAt: 0, queryClient: null, refresh: null };

const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const num = (value: unknown): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : 0;

const FILL_STATES: ReadonlySet<string> = new Set<LbBotFillState>([
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

/** A `fill` frame's album shape, read with the same rules the main process
 *  applies to a status body — the frame IS that body, minus the file list. */
export const fillFrameToStatus = (frame: LbBotFillFrame): LbBotFillStatus => {
    const rawState = str(frame.state) || 'unknown';
    const state = (FILL_STATES.has(rawState) ? rawState : 'unknown') as LbBotFillState;
    return {
        activeFiles: num(frame.activeFiles),
        album: str(frame.album),
        // B-084: a frame without the key (an older hub rebuilds it) leaves it undefined.
        ...(typeof frame.allFiles === 'boolean' ? { allFiles: frame.allFiles } : {}),
        allowMp3: frame.allowMp3 === true,
        artist: str(frame.artist),
        attempts: num(frame.attempts),
        bytesDone: num(frame.bytesDone),
        bytesTotal: num(frame.bytesTotal),
        cancellable:
            typeof frame.cancellable === 'boolean'
                ? frame.cancellable
                : state === 'searching' || state === 'queued' || state === 'downloading',
        done: num(frame.done),
        failed: num(frame.failed),
        failureKind: str(frame.failureKind) as LbBotFillStatus['failureKind'],
        groupId: str(frame.groupId),
        ...(typeof frame.leftOut === 'number' && Number.isFinite(frame.leftOut)
            ? { leftOut: frame.leftOut }
            : {}),
        mp3WouldHelp: frame.mp3WouldHelp === true,
        percent: num(frame.percent),
        quality: str(frame.quality),
        reason: str(frame.reason),
        releaseMbid: str(frame.releaseMbid),
        retryable: frame.retryable === true,
        retryAt: num(frame.retryAt),
        rgid: str(frame.rgid),
        serverTime: num(frame.serverTime),
        source: str(frame.source),
        speedBps: num(frame.speedBps),
        state,
        total: num(frame.total),
        updatedAt: num(frame.updatedAt),
        verifyGaveUp: frame.verifyGaveUp === true,
    };
};

const outcomeFor = (status: LbBotFillStatus) =>
    status.state === 'verified' || (status.state === 'placed' && status.verifyGaveUp)
        ? 'done'
        : status.state === 'cancelled'
          ? 'cancelled'
          : 'failed';

/**
 * The ONE place lb-bot's answer about an album fill reaches the ledger.
 *
 * A poll of one row, a poll of every row and a `fill` frame off the hub socket
 * all end here, so push cannot disagree with poll about what a state means.
 * It is also where the three things a status can be are kept apart: a real
 * state moves the row; `unknown` is bounded patience (above); and a FAILED
 * poll never comes here at all — `noteCheck` records it, and the row keeps
 * saying what it last knew plus "can't reach lb-bot".
 */
export const applyFillStatus = (rgid: string, status: LbBotFillStatus, now = Date.now()): void => {
    const { actions, fills } = useActiveFillsStore.getState();
    const fill = fills[rgid];
    const mbid = status.releaseMbid || fill?.releaseMbid;
    // B-084: `leftOut` / `allFiles` that this status does not carry are what the row
    // already knew (see `nextFillExtras`), so a frame never blanks them.
    const known = {
        allFiles: fill?.allFiles,
        leftOut: fill?.leftOut,
        source: fill?.lastSource,
    };
    const carried = nextFillExtras(known, status, { sameFill: true });
    // Keep an open modal's single-item read in step with what the ledger heard.
    if (mbid) {
        registry.queryClient?.setQueryData(['lbbot', 'album-status', mbid], {
            ...status,
            ...((carried.allFiles ?? known.allFiles) !== undefined
                ? { allFiles: carried.allFiles ?? known.allFiles }
                : {}),
            ...((carried.leftOut ?? known.leftOut) !== undefined
                ? { leftOut: carried.leftOut ?? known.leftOut }
                : {}),
        });
    }
    if (!fill) return;
    actions.noteCheck(rgid, '');

    if (status.state === 'unknown') {
        if (fill.settled || now - fill.startedAt < UNKNOWN_GRACE_MS) return;
        const since = fill.unknownSince || now;
        if (!fill.unknownSince) actions.describe(rgid, { unknownSince: since });
        if (now - since >= UNKNOWN_SETTLE_MS) {
            actions.settle(rgid, {
                outcome: 'gaveUp',
                reason: 'lb-bot no longer knows this download',
                state: fill.state,
            });
        }
        return;
    }

    // A reopened row is a new fill of the release: the old fill's numbers go with it.
    let reopened = false;
    // A settled row whose server side has come back to life — lb-bot's own
    // automatic retry, a wishlist re-search, a retry from the other client —
    // re-opens, so the ledger follows the fill rather than its last verdict.
    if (fill.settled) {
        const backAlive =
            !TERMINAL_STATES.has(status.state) &&
            status.updatedAt * 1000 > (fill.finishedAt ?? 0) - 1000;
        if (!backAlive) {
            // The server no longer has a retry pending (it fired, or lb-bot
            // restarted): stop watching this settled row for one.
            if ((fill.retryAt ?? 0) > 0 && !status.retryAt) actions.describe(rgid, { retryAt: 0 });
            return;
        }
        actions.reopen(rgid, status.releaseMbid);
        reopened = true;
    }

    const moved =
        status.state !== fill.state ||
        status.done !== (fill.done ?? 0) ||
        status.failed !== (fill.failedFiles ?? 0) ||
        status.bytesDone !== (fill.bytesDone ?? 0);
    actions.describe(rgid, {
        album: status.album,
        ...nextFillExtras(known, status, { sameFill: !reopened }),
        allowMp3: status.allowMp3,
        artist: status.artist,
        attempts: status.attempts,
        bytesDone: status.bytesDone,
        bytesTotal: status.bytesTotal,
        cancellable: status.cancellable,
        done: status.done,
        failedFiles: status.failed,
        failureKind: status.failureKind,
        groupId: status.groupId,
        lastSource: status.source,
        mp3WouldHelp: status.mp3WouldHelp,
        percent: status.percent,
        retryable: status.retryable,
        retryAt: status.retryAt ? status.retryAt * 1000 : 0,
        speedBps: status.speedBps,
        state: status.state,
        total: status.total,
        unknownSince: 0,
        verifyGaveUp: status.verifyGaveUp,
        ...(moved ? { lastProgressAt: now } : {}),
    });

    // `placed` says the files are in the library folder; refreshing now is what
    // makes the album appear the moment Navidrome's scan finishes.
    if ((status.state === 'placed' || status.state === 'verified') && fill.state !== status.state) {
        registry.refresh?.(undefined, {
            event: status.state === 'verified' ? 'albumIndexed' : 'albumPlaced',
        });
    }

    if (TERMINAL_STATES.has(status.state) || (status.state === 'placed' && status.verifyGaveUp)) {
        actions.settle(rgid, {
            attempts: status.attempts,
            cancellable: status.cancellable,
            failureKind: status.failureKind,
            mp3WouldHelp: status.mp3WouldHelp,
            outcome: outcomeFor(status),
            reason: status.reason,
            retryable: status.retryable,
            retryAt: status.retryAt ? status.retryAt * 1000 : 0,
            state: status.state,
            verifyGaveUp: status.verifyGaveUp,
        });
        return;
    }
    if (!moved && now - (fill.lastProgressAt ?? fill.startedAt) > WATCH_TIMEOUT_MS) {
        // Ran out of clock rather than failed — a different thing, and worth
        // saying so: nothing is known to have gone wrong.
        actions.settle(rgid, {
            outcome: 'gaveUp',
            reason: 'No progress for 20 minutes',
            state: status.state,
        });
    }
};

/**
 * The gap counterpart of `applyFillStatus`: one writer for the gap ledger. `sentAt`: when the
 * read that answered `gap` was sent (gap-watch.ts gapReadCounts).
 */
export const applyGapSummary = (
    groupId: string,
    gap: LbBotGap,
    now = Date.now(),
    sentAt = now,
): void => {
    const { actions, gaps } = useActiveFillsStore.getState();
    const queryKey = ['lbbot', 'gap', groupId];
    const entry = gapEntryAfterSummary(registry.queryClient?.getQueryData<GapEntry>(queryKey), gap);
    const merged = entry.data!;
    registry.queryClient?.setQueryData(queryKey, entry);
    // Results the cache holds no rows for (a search just finished): read the full
    // view once for that result set. Refetches now if the dialog is open, else
    // marks it stale for when it opens.
    if (
        merged.sources.length === 0 &&
        gap.sourcesTotal > 0 &&
        registry.gapSourceReads.get(groupId) !== gap.sourcesFoundAt
    ) {
        registry.gapSourceReads.set(groupId, gap.sourcesFoundAt);
        void registry.queryClient?.invalidateQueries({ queryKey });
    }
    const watch = gaps[groupId];
    if (!watch || !gapReadCounts(watch, gap, sentAt)) return;
    actions.noteCheck(groupId, '');
    const busy = gapIsBusy(gap);
    if (watch.settled) {
        if (busy) actions.startGap(groupId, { album: gap.album, artist: gap.artist });
        else return;
    }
    const progress = gapProgress(gap);
    const moved =
        gap.status !== watch.state ||
        progress.done !== (watch.done ?? 0) ||
        progress.failed !== (watch.failedFiles ?? 0);
    actions.describe(groupId, {
        album: gap.album,
        artist: gap.artist,
        cancellable:
            gap.status === 'downloading' ||
            gap.tracks.some((t) => t.state === 'downloading' || t.state === 'queued'),
        done: progress.done,
        failedFiles: progress.failed,
        mp3WouldHelp: gap.mp3WouldHelp,
        percent: progress.percent,
        stalledPlacement: gap.stalledPlacement,
        state: gap.status,
        total: progress.wanted,
        ...(moved ? { lastProgressAt: now } : {}),
    });
    // `complete` means the tracks are in the album folder; the discography row
    // and Navidrome's own list both have to be re-read or the album double-lists.
    if (gap.status === 'complete' && watch.state !== 'complete') registry.refresh?.(undefined);

    const verdict = gapWatchVerdict(watch, gap, { now, timeoutMs: WATCH_TIMEOUT_MS });
    if (verdict === 'gaveUp') {
        actions.settleGap(groupId, { outcome: 'gaveUp', state: gap.status });
        return;
    }
    if (verdict === 'wait') return;
    // Q-031: `picking` with the search finished and nothing downloaded is the
    // picker holding candidates and waiting on the user — a "your move", not a
    // failure. `picking` with a `downloaded` track is lb-bot's needs_match
    // bucket instead — `gapSettleOutcome` is the one place (shared with the gap
    // modal's `gapAwaitingMatch`) that tells the two apart.
    const { outcome, state } = gapSettleOutcome(gap);
    actions.settleGap(groupId, {
        mp3WouldHelp: gap.mp3WouldHelp,
        outcome,
        // B-011/B-044: lb-bot's human sentence, never the machine `failReason`
        // token ("stalled_placement", "blocked_no_source").
        reason: gapFailReason(gap) || gap.sourceTask?.error,
        state,
    });
};

/** A `fill` frame off the hub socket: lb-bot pushed a state or progress change. */
export const applyFillFrame = (frame: LbBotFillFrame): void => {
    registry.lastPushAt = Date.now();
    const key = str(frame.key);
    if (frame.kind === 'album') {
        const status = fillFrameToStatus(frame);
        const { fills } = useActiveFillsStore.getState();
        const rgid = fills[key] ? key : fills[status.rgid] ? status.rgid : key || status.rgid;
        if (rgid) applyFillStatus(rgid, status);
    } else if (frame.kind === 'gap') {
        // The frame is a summary; the poll carries the tracks. Re-read now.
        if (key) void registry.queryClient?.invalidateQueries({ queryKey: ['lbbot', 'gap', key] });
        void registry.queryClient?.invalidateQueries({ queryKey: ['lbbot', 'fills'] });
    } else if (frame.kind === 'wishlist') {
        void registry.queryClient?.invalidateQueries({ queryKey: ['lbbot', 'wishlist'] });
    }
};

/**
 * The ledger's own watcher. Mounted once, at the app root, whether or not any
 * page is showing a fill.
 *
 * Polling used to happen only from mounted rows — a tile, a `/downloads` row
 * that passed the current filter, an open modal — so a fill that failed while
 * none of those was on screen read "Downloading" until something remounted it,
 * and choosing the "Didn't land" chip stopped polling the fills in flight. This
 * reads every unsettled row in ONE request (`/lb/fills`), in the background
 * too, and hands each answer to `applyFillStatus` / `applyGapSummary`.
 *
 * Push accelerates it: while the hub socket is up and a `fill` frame arrived
 * recently, this is a 30 s safety net; otherwise it is the 5/10/20 s poll.
 */
export const useFillLedgerWatcher = () => {
    const queryClient = useQueryClient();
    const refresh = useLbBotLibraryRefresh();
    const connected = useHubConnected();
    useEffect(() => {
        registry.queryClient = queryClient;
        registry.refresh = refresh;
    }, [queryClient, refresh]);

    const fills = useActiveFillsStore((state) => state.fills);
    const gaps = useActiveFillsStore((state) => state.gaps);
    const releaseMbids = useMemo(
        () =>
            [
                ...new Set(
                    Object.values(fills)
                        // Settled rows with a pending automatic retry are watched too:
                        // that is how the row learns the retry began.
                        .filter((f) => f.releaseMbid && (!f.settled || (f.retryAt ?? 0) > 0))
                        .map((f) => f.releaseMbid),
                ),
            ].sort(),
        [fills],
    );
    const groupIds = useMemo(
        () =>
            Object.values(gaps)
                .filter((g) => !g.settled)
                .map((g) => g.groupId)
                .sort(),
        [gaps],
    );
    const quiet = useRef(0);
    const lastDigest = useRef('');

    useQuery({
        enabled: !!lbBot && (releaseMbids.length > 0 || groupIds.length > 0),
        queryFn: async () => {
            const sentAt = Date.now();
            const result = await lbBot!.fills(releaseMbids, groupIds);
            const state = useActiveFillsStore.getState();
            const keys = [
                ...Object.values(state.fills)
                    .filter((f) => releaseMbids.includes(f.releaseMbid))
                    .map((f) => f.rgid),
                ...groupIds,
            ];
            if (!result.ok || !result.data) {
                const error = result.error || 'Could not reach lb-bot';
                for (const key of keys) state.actions.noteCheck(key, error);
                throw new LbBotReadError(result, error);
            }
            const albums = result.data.albums;
            const digest = JSON.stringify([
                Object.entries(albums).map(([mbid, s]) => [
                    mbid,
                    s.state,
                    s.done,
                    s.failed,
                    s.bytesDone,
                    s.percent,
                    s.retryAt,
                ]),
                Object.values(result.data.gaps).map((g) => [
                    g.id,
                    g.status,
                    g.sourceTask?.status,
                    g.tracks.map((t) => t.state).join(''),
                ]),
            ]);
            quiet.current = digest === lastDigest.current ? quiet.current + 1 : 0;
            lastDigest.current = digest;
            const now = Date.now();
            for (const fill of Object.values(state.fills)) {
                const status = albums[fill.releaseMbid];
                if (status) applyFillStatus(fill.rgid, status, now);
            }
            for (const [gid, gap] of Object.entries(result.data.gaps)) {
                applyGapSummary(gid, gap, now, sentAt);
            }
            return result.data;
        },
        queryKey: ['lbbot', 'fills', releaseMbids.join(','), groupIds.join(',')],
        refetchInterval: () =>
            connected && Date.now() - registry.lastPushAt < PUSH_FRESH_MS
                ? PUSHED_POLL_MS
                : pollInterval(quiet.current),
        refetchIntervalInBackground: true,
        retry: false,
        staleTime: 0,
    });
};

/**
 * Poll one release's fill while a modal is open on it.
 *
 * The ledger watcher above already reads every watched fill; this is the one
 * single-item read, for a modal that wants the per-file list and a 5 s cadence
 * while the user is looking. A failed poll THROWS: react-query keeps the last
 * data and counts the failure, and the row says "can't reach" — it used to
 * arrive as `unknown`, which is a real answer meaning something else entirely.
 */
export const useLbBotFillStatus = (releaseMbid: null | string, enabled: boolean, rgid?: string) => {
    const queryClient = useQueryClient();
    const queryKey = ['lbbot', 'album-status', releaseMbid];
    const ticks = useRef({ quiet: 0 });
    return useQuery<LbBotFillStatus>({
        enabled: !!lbBot && !!releaseMbid && enabled,
        queryFn: async () => {
            const result = await lbBot!.albumStatus(releaseMbid!);
            if (!result.ok || !result.data) {
                const error = result.error || 'Could not reach lb-bot';
                if (rgid) useActiveFillsStore.getState().actions.noteCheck(rgid, error);
                throw new LbBotReadError(result, error);
            }
            const next = result.data;
            const previous = queryClient.getQueryData<LbBotFillStatus>(queryKey);
            const same =
                previous &&
                previous.state === next.state &&
                previous.done === next.done &&
                previous.bytesDone === next.bytesDone &&
                previous.failed === next.failed;
            ticks.current.quiet = same ? ticks.current.quiet + 1 : 0;
            const key = rgid || next.rgid;
            if (key) applyFillStatus(key, next);
            return next;
        },
        queryKey,
        refetchInterval: (query) => {
            const state = query.state.data?.state ?? 'unknown';
            if (TERMINAL_STATES.has(state)) return false;
            return pollInterval(ticks.current.quiet);
        },
        retry: false,
        staleTime: 0,
    });
};

export const startAlbumDownload = async (
    rgid: string,
    quality?: string,
    source?: { folder: string; peer: string },
    edition?: LbBotResolvedEdition,
    excludeUsers?: string[],
    /** Names for the ledger row when no edition was resolved to supply them —
     *  a one-tap acquire has the title and artist from whatever row it was
     *  fired from, and without them the downloads view captions the row with a
     *  release-group id. */
    names?: { album?: string; artist?: string },
    /** Widen this one album's search to MP3 — the whole-album counterpart of a
     *  gap group's opt-in. */
    allowMp3?: boolean,
    /** B-084: ask the picked folder for every audio file in it (needs `source`). The
     *  retry and "another source" paths never pass it: all files is consent for one
     *  folder, once. */
    allFiles?: boolean,
): Promise<LbBotDownloadResult> => {
    if (!lbBot) {
        return {
            error: 'lb-bot is not available.',
            existing: false,
            ok: false,
            releaseMbid: '',
            status: 0,
        };
    }
    const result = withRefusal(
        await lbBot.downloadAlbum(rgid, quality, source, edition, excludeUsers, allowMp3, allFiles),
    );
    if (result.ok) {
        // Registered here rather than in the sheet: the fill takes minutes, and
        // the page behind the sheet is what has to keep watching it. The edition's
        // artist and title ride along so the downloads view can name the row even
        // after lb-bot has forgotten the fill.
        useActiveFillsStore.getState().actions.start(rgid, result.releaseMbid, quality ?? '', {
            album: edition?.title || names?.album,
            allowMp3: allowMp3 === true,
            artist: edition?.artist || names?.artist,
            // The whole edition, not just its display fields: a Retry has to re-send
            // it or lb-bot re-resolves the group and the chosen pressing is lost.
            edition,
            excludedPeers: excludeUsers,
            sourceFolder: source?.folder,
            sourcePeer: source?.peer,
        });
    }
    return result;
};

/**
 * Why a one-tap acquire did not fire, in the terms the caller has to explain.
 *
 * `review` is not a failure — it is the picker doing its job. Every reason here
 * is a question only the user can answer.
 */
export type AcquireOutcome =
    | { format: string; kind: 'started'; peer: string; result: LbBotDownloadResult }
    /** Worbus P1: lb-bot's downloading is off (known, or a 409 `downloads_off` just said so). */
    | { kind: 'off' }
    | {
          kind: 'review';
          reason:
              | 'incomplete'
              | 'noSources'
              | 'unavailable'
              | 'uncertainMatch'
              | 'unverifiedArtist'
              | 'wrongFormat';
      };

/** Formats a lossless preference is actually satisfied by. */
const LOSSLESS = /^(flac|alac|wav|aiff|ape|wv)$/i;

/**
 * Acquire an unowned album in one gesture — reviewed, not blind.
 *
 * Reads the ranked sources first and only posts the download when lb-bot's own
 * top-ranked folder leaves nothing to decide: `albumMatchOk`, the artist
 * VERIFIED (checked directly, not by trusting the server's `recommended` flag
 * — B-019/R4; a self-titled or common-title album whose top folder comes from
 * an uncredited uploader must not go straight through), and coverage complete
 * against the canonical MusicBrainz tracklist. Anything else opens the picker
 * it would have bypassed — the one-tap version existed once and fetched the
 * wrong record for a self-titled album.
 *
 *  * `wrongFormat`: `quality` is a *ranking* term upstream, not a filter, so the
 *    folder can legitimately be MP3 when the preference is FLAC. The preference
 *    itself lives in lb-bot when it is the default (`''`), so there is nothing
 *    to check against — but when the user has picked a *lossless* one on this
 *    client, a lossy top pick is exactly the surprise the source row exists to
 *    prevent, and it goes to the picker instead.
 *
 * The sources fetch is keyed identically to {@link useLbBotAlbumSources} — the
 * key includes the edition, so this searches for the edition the picker opens
 * on ({@link defaultEdition}) rather than leaving lb-bot to resolve one — and the
 * picker this falls through to finds the answer already in hand instead of
 * starting a second 30-90 s search.
 */
/**
 * The edition the album page's pickers open on: its first variant's first edition,
 * else the variant's own release — as the source search wants it. The panel
 * sizes `totalTracks` off the edition's tracklist once it loads; the variant's
 * count stands in here, which changes the search's parameters but not its key.
 * Undefined with no editions, where both leave the resolution to lb-bot.
 */
export const defaultEdition = (
    detail: LbBotReleaseDetail | null | undefined,
    fallback: { artist?: string; title?: string },
): LbBotResolvedEdition | undefined => {
    const variant = detail?.variants[0];
    const releaseMbid = variant?.editions[0]?.releaseMbid || variant?.releaseMbid;
    if (!variant || !releaseMbid) return undefined;
    return {
        artist: detail.artist || fallback.artist || '',
        releaseMbid,
        title: variant.title || fallback.title || '',
        totalTracks: variant.trackCount || 0,
    };
};

export const useAcquireAlbum = () => {
    const queryClient = useQueryClient();
    return useCallback(
        async (release: {
            artist?: string;
            rgid: string;
            title?: string;
        }): Promise<AcquireOutcome> => {
            if (!lbBot || !release.rgid) return { kind: 'review', reason: 'unavailable' };
            if (downloadsOffNow()) return { kind: 'off' };

            // The editions read is `useLbBotAlbumReleases`' own query, so it
            // is usually cached (and persisted) already; fail-soft to lb-bot's
            // own resolution, exactly as the picker does with no editions.
            const detail = await queryClient.fetchQuery<LbBotReleaseDetail | null>({
                gcTime: Infinity,
                queryFn: () => lbBot!.albumReleases(release.rgid),
                queryKey: ['lbbot', 'album-releases', release.rgid],
                staleTime: staleUnlessAnswered(Infinity),
            });
            const edition = defaultEdition(detail, release);
            const answer = await queryClient.fetchQuery<LbBotResult<LbBotGapSource[]>>({
                // `useLbBotAlbumSources`' own, so a "review" answer's picker
                // finds this 30-90 s slskd search still cached rather than
                // repeating it once the 20 s default has dropped it.
                gcTime: 5 * 60 * 1000,
                queryFn: () => lbBot!.albumSources(release.rgid, edition),
                queryKey: ['lbbot', 'album-sources', release.rgid, edition?.releaseMbid ?? ''],
                staleTime: 60 * 1000,
            });
            // A stale "on" (an older hub, the first seconds after a restart): the 409 is the answer,
            // not "lb-bot would not answer". Applied here, whether or not the refusal event came
            // first, so every surface is off by the time the caller reads `off`.
            if (answer) withRefusal(answer);
            if (answer && !answer.ok && answer.code === 'downloads_off') return { kind: 'off' };
            const sources = answer?.ok ? (answer.data ?? []) : null;
            if (!sources) return { kind: 'review', reason: 'unavailable' };

            const top = sources[0];
            if (!top) return { kind: 'review', reason: 'noSources' };
            if (!top.albumMatchOk) return { kind: 'review', reason: 'uncertainMatch' };
            // B-019 (ruling R4): the server already refuses to mark an
            // unverified row `recommended`, but this path never READ
            // `recommended` either — it went straight from `sources[0]` to
            // posting the download. Checked directly (not via `recommended`)
            // so this holds even if the server's own guard ever slips.
            if (!isSourceVerified(top)) return { kind: 'review', reason: 'unverifiedArtist' };
            if (!top.coverageFull || top.coverageDetail.totalTracks <= 0) {
                return { kind: 'review', reason: 'incomplete' };
            }

            const quality = useActiveFillsStore.getState().preferredQuality;
            const wantsLossless = quality === 'flac-16-44' || quality === 'flac-any';
            if (wantsLossless && !LOSSLESS.test((top.format || '').trim())) {
                return { kind: 'review', reason: 'wrongFormat' };
            }

            const result = await startAlbumDownload(
                release.rgid,
                quality,
                { folder: top.folder, peer: top.peer },
                undefined,
                undefined,
                { album: release.title, artist: release.artist },
            );
            if (!result.ok && result.code === 'downloads_off') return { kind: 'off' };
            return { format: top.format, kind: 'started', peer: top.peer, result };
        },
        [queryClient],
    );
};

/**
 * Drop everything this artist page derives from the library, in both directions.
 *
 * A landed album changes two independent answers at once — Navidrome now has an
 * album it didn't, and lb-bot no longer counts that release-group as missing —
 * and showing one without the other is exactly the double-listing this fixes.
 */
const PLACED_FALLBACK_REFRESH_MS = 20_000;

export const useLbBotLibraryRefresh = () => {
    const queryClient = useQueryClient();
    return useCallback(
        (ndArtistId?: string, landing?: LbBotLibraryLanding) => {
            // The hub drops its cached discography before it broadcasts, so this
            // re-read is lb-bot's live answer rather than a minute-old copy.
            if (landing?.event === 'artistScanned' && landing.ndArtistId) {
                // A scan changes one artist's index and nothing in Navidrome.
                void queryClient.invalidateQueries({
                    queryKey: ['lbbot', 'discography', landing.ndArtistId],
                });
                return;
            }
            void queryClient.invalidateQueries({ queryKey: ['lbbot', 'discography'] });
            if (ndArtistId) {
                void queryClient.invalidateQueries({
                    queryKey: ['lbbot', 'discography', ndArtistId],
                });
            }
            if (landing?.event === 'artistScanned') return;
            // `albumPlaced` fires before Navidrome's scan, so re-reading the
            // library then only fetches it as it was. `albumIndexed` follows
            // once Navidrome has the album and is the one worth a refetch.
            //
            // With the album ids the frame now carries, only the lists and the
            // named albums are dropped — not every album detail in the cache.
            const ids = landing?.ndAlbumIds ?? [];
            const artist = landing?.ndArtistId ?? ndArtistId ?? '';
            const invalidateLibrary = () => {
                // Review M2: a named album's cover may have changed (lb-bot's cover or override
                // announces itself so, once Navidrome has rescanned): its covers are asked again.
                forgetAlbumCovers(ids);
                void queryClient.invalidateQueries({
                    predicate: (query) => {
                        const [scope, kind] = query.queryKey as unknown[];
                        return (
                            scope === 'lbbot' &&
                            typeof kind === 'string' &&
                            kind.startsWith('listening-') &&
                            kind !== 'listening-status'
                        );
                    },
                });
                void queryClient.invalidateQueries({
                    predicate: (query) => {
                        const [, kind, scope] = query.queryKey as [string, string?, string?];
                        if (kind === 'albums') {
                            if (ids.length === 0 || scope === 'list') return true;
                            const serialized = JSON.stringify(query.queryKey);
                            return ids.some((id) => serialized.includes(id));
                        }
                        if (kind === 'albumArtists') {
                            if (!artist || scope === 'list') return true;
                            return JSON.stringify(query.queryKey).includes(artist);
                        }
                        return false;
                    },
                });
            };
            if (landing?.event === 'albumPlaced') {
                // An lb-bot predating `albumIndexed` never sends the follow-up,
                // so still look once its quick scan has plausibly finished.
                window.setTimeout(invalidateLibrary, PLACED_FALLBACK_REFRESH_MS);
                return;
            }
            invalidateLibrary();
        },
        [queryClient],
    );
};

/** What a `library` frame (or the local fill poll) says landed. */
export interface LbBotLibraryLanding {
    /** `albumPlaced` (files placed, not scanned), `albumIndexed` (Navidrome has
     *  it) or `artistScanned` (a discography scan finished or failed). */
    event?: string;
    ndAlbumIds?: string[];
    ndArtistId?: string;
}

/**
 * One tile's fill, from the ledger. The ledger watcher keeps it live; this
 * costs nothing for a release nobody started, which is nearly all of them.
 * The second argument is kept for call-site compatibility — the page refresh
 * on landing is now the watcher's job, whichever page is open.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept for call-site compatibility
export const useWatchedFill = (rgid: string, _ndArtistId?: string): ActiveFill | undefined => {
    const fill = useActiveFill(rgid);
    return fill && !fill.settled
        ? fill
        : fill?.settled && fill.outcome === 'done'
          ? undefined
          : fill;
};

export const allowMp3ForAlbum = async (groupId: string): Promise<boolean> =>
    lbBot ? lbBot.allowMp3(groupId, true) : false;

// ---------------------------------------------------------------------------
// Reviewing a source before committing to it
// ---------------------------------------------------------------------------

/**
 * How many consecutive failed polls to absorb before saying anything.
 *
 * lb-bot takes a process-wide lock on *every* route, and the hub's proxy timeout
 * is the only thing separating "slow" from "502" — so an ordinary poll can fail
 * while a large search holds that lock. The poll is retried in five seconds
 * anyway; blanking a modal for one bad tick is the defect, not the tick.
 */
const TRANSIENT_FAILURE_LIMIT = 2;

/**
 * Keep the last good payload across transient upstream failures, and surface an
 * error only once they stop looking transient.
 *
 * The ref is written during render rather than in an effect so the very first
 * result is already reflected in what this returns; guarding on the result's
 * identity keeps that idempotent under React's double-render.
 */
const useToleratedResult = <T>(result: LbBotResult<T> | undefined) => {
    const state = useRef<{ data: null | T; failures: number; seen: unknown }>({
        data: null,
        failures: 0,
        seen: null,
    });
    if (result && result !== state.current.seen) {
        state.current.seen = result;
        if (result.ok) {
            state.current.data = result.data;
            state.current.failures = 0;
        } else {
            state.current.failures += 1;
        }
    }
    return {
        data: state.current.data,
        error: state.current.failures > TRANSIENT_FAILURE_LIMIT ? (result?.error ?? '') : '',
    };
};

/**
 * The ranked Soulseek folders for one release-group.
 *
 * Fired only when the user asks — it is a live slskd fan-out and takes 30-90s.
 * The hub caches it briefly, so re-opening the modal doesn't start another
 * search, which is why the query is kept fresh here for the same span.
 */
export const useLbBotAlbumSources = (
    rgid: null | string,
    enabled: boolean,
    edition?: LbBotResolvedEdition,
    /** F7: the album page keeps an answer for the whole 5 minutes it is cached, so coming back to
     *  the page shows it instead of starting a second live search. */
    options: { staleTime?: number } = {},
) => {
    // Search again (R12, review F4): the next fetch asks lb-bot to search afresh, once.
    const refreshNext = useRef(false);
    const query = useQuery<LbBotResult<LbBotGapSource[]>>({
        enabled: !!lbBot && !!rgid && enabled,
        gcTime: 5 * 60 * 1000,
        queryFn: () => {
            const refresh = refreshNext.current;
            refreshNext.current = false;
            return lbBot!.albumSources(rgid!, edition, { refresh }).then(withRefusal);
        },
        // Keyed on the edition too: two pressings of the same group are two
        // different searches, and re-using one's answer for the other is exactly
        // the wrong-record mistake this screen exists to prevent.
        queryKey: ['lbbot', 'album-sources', rgid, edition?.releaseMbid ?? ''],
        retry: false,
        staleTime: options.staleTime ?? 60 * 1000,
    });
    const { refetch } = query;
    const again = useCallback(() => {
        refreshNext.current = true;
        return refetch();
    }, [refetch]);
    return {
        again,
        error: query.data && !query.data.ok ? query.data.error : '',
        isLoading: query.isFetching,
        queryKey: ['lbbot', 'album-sources', rgid, edition?.releaseMbid ?? ''],
        refetch: query.refetch,
        sources: query.data?.ok ? (query.data.data ?? []) : null,
    };
};

/** Fill progress, counted off the tracks (one copy, in the pure `gap-stage.ts`). */
export { gapProgress };

/** Is anything still happening to this gap? (the pure `gap-watch.ts`). */
export { gapIsBusy };

/** A gap read as the box's query keeps it: when failing reads began rides along (0: answered).
 *  B-234: the app-root watcher writes the same key in the same shape (`gapEntryAfterSummary`),
 *  keeping the clock. */
type GapRead = GapEntry & LbBotResult<LbBotGap>;

/**
 * One review group, polled while something is on screen to show it.
 *
 * Without a `poll` predicate it polls for as long as it is enabled: the expensive
 * mistake on this API is settling *early* (see `gapIsBusy`), and five seconds is
 * the floor lb-bot's single process and process-wide lock can afford anyway. The
 * album page's gaps box, which sits on the page for the whole visit, passes one
 * (`gapPolls`): it reads once, then polls while something moves.
 */
export const useLbBotGap = (
    groupId: null | string,
    enabled: boolean,
    /** R11: poll only while this says so (the album page's gaps box reads once, then polls while
     *  something moves, `gapPolls`); absent, it polls for as long as it is enabled. It is given
     *  the last record that answered and when reads started failing (0 while they answer). */
    poll?: (gap: LbBotGap | null, failingSince: number) => boolean,
) => {
    const queryClient = useQueryClient();
    const queryKey = ['lbbot', 'gap', groupId];
    const quiet = useRef(0);
    // The last record that answered, for the poll predicate: a failed tick carries none.
    const lastGood = useRef<LbBotGap | null>(null);
    const query = useQuery<GapRead>({
        enabled: !!lbBot && !!groupId && enabled,
        // A failed tick must not blank the modal while the retry is pending.
        placeholderData: keepPreviousData,
        queryFn: async () => {
            const before = queryClient.getQueryData<GapRead>(queryKey);
            const previous = before?.data;
            const next = await lbBot!.gap(groupId!);
            if (next.ok) lastGood.current = next.data;
            // Per-track states are the whole of a gap's progress, so they are what
            // the "has anything moved?" digest is built from. Same reason as the
            // album path: most ticks re-read a body that has not changed.
            const digest = (gap: LbBotGap | null | undefined) =>
                gap
                    ? `${gap.status}|${gap.sourceTask?.status}|${gap.tracks.map((t) => t.state).join('')}`
                    : '';
            quiet.current = digest(previous) === digest(next.data) ? quiet.current + 1 : 0;
            // A failed read is not an answer (PROTOCOL 15.2): when the failing began rides with
            // the result, so a caller can bound its patience on the clock.
            return {
                ...next,
                failingSince: next.ok ? 0 : before?.failingSince || Date.now(),
            };
        },
        queryKey,
        refetchInterval: (query) =>
            !poll ||
            poll(
                query.state.data?.ok ? query.state.data.data : lastGood.current,
                query.state.data?.failingSince ?? 0,
            )
                ? pollInterval(quiet.current)
                : false,
        retry: false,
        staleTime: 0,
    });
    const tolerated = useToleratedResult(query.data);
    return {
        error: tolerated.error,
        /** When reads started failing (0 while they answer), as of the last read. */
        failingSince: query.data?.failingSince ?? 0,
        gap: tolerated.data,
        isLoading: query.isFetching && !tolerated.data,
        /** When the last read landed, answered or not. */
        readAt: query.dataUpdatedAt,
        refetch: query.refetch,
    };
};

/**
 * A source's real folder listing, fetched when its card is chosen and kept.
 *
 * `/lb/gap` has these stripped by the hub — lb-bot embeds every ranked source's
 * entire peer listing, ten to a page, on a path polled every five seconds. So
 * they are fetched per source, once, on demand, by the source's index in the
 * current list. Kept by the folder's identity (`sourceKey`), never by that
 * index (review minor 11): after Search again an index names another folder,
 * whose card must not show the previous one's files.
 */
export const useGapSourceFiles = (groupId: null | string, listAt: number) => {
    const [files, setFiles] = useState<Record<string, KeptListing<LbBotResult<LbBotSourceFiles>>>>(
        {},
    );
    const [loading, setLoading] = useState<Record<string, boolean>>({});

    /** A card chosen opens its listing, fetched once and kept. */
    const open = useCallback(
        async (source: LbBotGapSource) => {
            const key = sourceKey(source);
            if (!listingNeedsAsking(files[key], listAt) || loading[key] || !lbBot || !groupId) {
                return;
            }
            setLoading((prev) => ({ ...prev, [key]: true }));
            const result = await lbBot.gapSourceFiles(groupId, source.id);
            setFiles((prev) => ({ ...prev, [key]: { listAt, result } }));
            setLoading((prev) => ({ ...prev, [key]: false }));
        },
        [files, groupId, listAt, loading],
    );

    /** What a chosen card shows: its listing, its loading, or why it could not be read; null
     *  for a folder never opened. */
    const view = useCallback(
        (source: LbBotGapSource) => {
            const key = sourceKey(source);
            const result = files[key]?.result;
            if (!result && !loading[key]) return null;
            return {
                error: result && !result.ok ? result.error : '',
                loading: !!loading[key],
                value: result?.ok ? result.data : null,
            };
        },
        [files, loading],
    );

    return { open, view };
};

// ---------------------------------------------------------------------------
// Gap actions
// ---------------------------------------------------------------------------

const NO_CLIENT: LbBotResult<boolean> = {
    data: null,
    error: 'lb-bot is not available.',
    ok: false,
    status: 0,
};

export const searchGapSources = (groupId: string, force = false): Promise<LbBotGapAction> =>
    lbBot ? lbBot.gapSearch(groupId, force).then(withRefusal) : Promise.resolve(NO_CLIENT);

export const autoFillGap = (groupId: string): Promise<LbBotGapAction> =>
    lbBot ? lbBot.gapAuto(groupId).then(withRefusal) : Promise.resolve(NO_CLIENT);

export const fetchGapSource = (groupId: string, sourceId: number): Promise<LbBotGapAction> =>
    lbBot ? lbBot.gapFetch(groupId, sourceId).then(withRefusal) : Promise.resolve(NO_CLIENT);

/**
 * B-233: a gap action was answered `ok`: watch the fill it started from that answer. The watch
 * starts now, after the answer arrived, so a read sent before it does not count; it keeps the
 * task the answer named (search, auto); and the group the answer carried (fetch) is its first
 * read (gap-watch.ts).
 */
export const startGapWatch = (
    groupId: string,
    meta: { album?: string; artist?: string },
    answer?: Pick<LbBotGapAction, 'gap' | 'taskId'>,
): void => {
    useActiveFillsStore
        .getState()
        .actions.startGap(groupId, { ...meta, taskId: answer?.taskId || undefined });
    if (answer?.gap) applyGapSummary(groupId, answer.gap);
};

export const cancelGapFill = (groupId: string): Promise<LbBotResult<boolean>> =>
    lbBot ? lbBot.gapCancel(groupId).then(withRefusal) : Promise.resolve(NO_CLIENT);

export const rescanGapAlbum = (groupId: string): Promise<LbBotResult<boolean>> =>
    lbBot ? lbBot.gapRescan(groupId).then(withRefusal) : Promise.resolve(NO_CLIENT);

/**
 * A gap fill's last known group, for the page. The ledger watcher polls it
 * (and the modal, while open); this only reads what they wrote to the query
 * cache. Returns undefined for a gap nobody started, which is nearly all of
 * them, so the hook costs nothing until the user acts.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept for call-site compatibility
export const useWatchedGap = (groupId: string, _ndArtistId?: string) => {
    const watch = useActiveGap(groupId);
    const query = useQuery<LbBotResult<LbBotGap>>({
        enabled: false,
        queryFn: () => lbBot!.gap(groupId),
        queryKey: ['lbbot', 'gap', groupId],
    });
    return watch && query.data?.ok ? (query.data.data ?? undefined) : undefined;
};

/**
 * Ask again for a fill the ledger remembers, with the options it was started with.
 *
 * Never automatic. lb-bot already walks its entire ranked source list before it
 * reports a failure, so an unattended retry re-runs the identical search against the
 * identical peers; the user asking again is the new information — the swarm has moved
 * on, or they have just allowed mp3.
 *
 * A gap retries as `search`, never `auto`: `auto` is what failed, and `search` stops
 * after ranking so the candidates can be judged. That review step matters more here,
 * not less — the tracks land inside a record the user already owns, so a different
 * pressing contaminates the album rather than merely disappointing.
 */
export const retryFill = async (
    row: { isGap: boolean; key: string; otherSourceExcludes?: string[] },
    options: { allowMp3?: boolean; anotherSource?: boolean } = {},
): Promise<boolean> => {
    // Worbus P1: nothing is fetched while downloading is off; refused here, with no request.
    if (downloadsOffNow()) return false;
    const { actions, fills } = useActiveFillsStore.getState();
    if (row.isGap) {
        const result = await searchGapSources(row.key, true);
        if (result.ok) startGapWatch(row.key, {}, result);
        return result.ok;
    }
    const fill = fills[row.key];
    if (!fill) return false;
    // "Try another source" drops the chosen peer and tells lb-bot which ones to skip,
    // so re-ranking cannot hand the album straight back to the peer that crawled.
    const anotherSource = options.anotherSource === true;
    const result = await startAlbumDownload(
        row.key,
        fill.quality,
        !anotherSource && fill.sourcePeer
            ? { folder: fill.sourceFolder ?? '', peer: fill.sourcePeer }
            : undefined,
        // The pressing the user chose, re-sent verbatim. Dropping it here handed the
        // release-group back to lb-bot's resolver, which picks "official, earliest"
        // and caches a transient MusicBrainz failure for five minutes.
        fill.edition,
        anotherSource ? row.otherSourceExcludes : undefined,
        { album: fill.album, artist: fill.artist },
        options.allowMp3 === true || fill.allowMp3 === true,
    );
    // Re-open the existing row rather than adding a second one, so the history stays
    // one line per album rather than one per attempt.
    if (result.ok) actions.reopen(row.key, result.releaseMbid);
    return result.ok;
};

/**
 * Widen this one album's search to include mp3, then ask again. Offered only when
 * lb-bot said the search rejected mp3s and would otherwise have found something.
 *
 * `groupId` is lb-bot's **review group**, never the release-group id. A gap's key
 * is one; an album fill only learns it from a status poll, and it used to be given
 * `row.key` — the rgid — which `/lb/album/allow-mp3` accepted, matched nothing, and
 * reported through a result the caller discarded. The retry then ran against the
 * same format policy that had just rejected everything. So: refuse rather than
 * guess, and let the MP3 half actually decide whether to retry.
 */
/**
 * Stop a fill the user no longer wants — too slow, wrong peer, changed their mind.
 *
 * Settles the row from lb-bot's answer rather than waiting for a poll: the downloads
 * view may be the only thing open, and a cancel that still reads "Downloading" until
 * some artist page happens to poll is not a cancel. A fill lb-bot no longer knows
 * about is settled too — from the user's side it is not running either way.
 */
export const cancelFill = async (row: {
    isGap: boolean;
    key: string;
    /** For a fill this client never started (it is running from another device):
     *  the modal knows the release even when the ledger has no row. */
    releaseMbid?: string;
}): Promise<boolean> => {
    const { actions, fills } = useActiveFillsStore.getState();
    if (row.isGap) {
        const result = await cancelGapFill(row.key);
        if (result.ok) actions.settleGap(row.key, { outcome: 'cancelled', state: 'cancelled' });
        return result.ok;
    }
    const fill = fills[row.key];
    const releaseMbid = row.releaseMbid || fill?.releaseMbid;
    if (!lbBot) return false;
    if (!releaseMbid) {
        if (!fill) return false;
        actions.settle(row.key, { outcome: 'cancelled', state: 'cancelled' });
        return true;
    }
    const { cancelled, code, ok, status } = await lbBot.cancelAlbum(releaseMbid);
    if (!ok) {
        applyLbBotRefusal(code);
        return false;
    }
    if (!cancelled) {
        // lb-bot answered, and said no: too late (the files are being placed)
        // or nothing was running. Its status says which — show that, not a
        // row that claims a cancel happened.
        if (
            status.state === 'placing' ||
            status.state === 'placed' ||
            status.state === 'verified'
        ) {
            toast.show({ message: "Too late to cancel — it's being added to the library." });
            if (fill) applyFillStatus(row.key, status);
        } else if (fill && !fill.settled) {
            actions.settle(row.key, { outcome: 'cancelled', state: 'cancelled' });
        }
        return true;
    }
    if (fill?.settled) {
        // A failed row whose automatic retry was pending: the verdict changes
        // in place rather than through `settle`, which is once-only.
        actions.describe(row.key, {
            cancellable: false,
            outcome: 'cancelled',
            retryAt: 0,
            state: 'cancelled',
        });
    } else if (fill) {
        actions.settle(row.key, {
            failureKind: '',
            outcome: 'cancelled',
            retryable: false,
            state: 'cancelled',
        });
    }
    return true;
};

/**
 * Widen this one album's search to include mp3, then ask again. Offered when
 * lb-bot said the search rejected mp3s and would otherwise have found something.
 *
 * With a review group, the opt-in is set on the group (`/lb/album/allow-mp3`)
 * and the retry follows. Without one — an artist-page download has none — the
 * retry itself carries `allowMp3`, the whole-album counterpart lb-bot now
 * takes on `album/download`. Either way the retry runs only if the opt-in took.
 */
export const allowMp3AndRetry = async (row: {
    groupId: string;
    isGap: boolean;
    key: string;
}): Promise<boolean> => {
    if (downloadsOffNow()) return false;
    if (row.groupId) {
        if (!(await allowMp3ForAlbum(row.groupId))) return false;
        return retryFill(row);
    }
    if (row.isGap) return false;
    return retryFill(row, { allowMp3: true });
};

// ---------------------------------------------------------------------------
// Track C: Deezer browse, paste-a-link, wishlist
// ---------------------------------------------------------------------------

/**
 * Deezer's charts and editorial selections, ownership-marked.
 *
 * One hook for both feeds because they are the same request with a different
 * path, and the rows are the same shape — the difference is the *question*, and
 * that lives in the row's `because` line rather than in the data.
 *
 * Gated on `useHubSupports` as well as availability, like `/lb/artist/similar`:
 * this route is newer than some hubs, and a hub that has not been restarted
 * answers 404, which `describeFailure` reports as "the hub is older than this
 * app". Hiding the row is the right answer, not showing that sentence.
 *
 * lb-bot caches both feeds for six hours and the hub for the same, so a long
 * `staleTime` here costs nothing and saves a round trip per navigation.
 */
const useLbBotBrowse = (feed: 'chart' | 'editorial', limit = 20, genre = '0') => {
    const available = useLbBotAvailable();
    const supported = useHubSupports(`GET /lb/deezer/${feed}`);
    const query = useQuery<LbBotBrowse | null>({
        enabled: !!lbBot && available && supported,
        gcTime: 60 * 60 * 1000,
        // A genre chip switches the key. Keep the previous genre's tiles in
        // place until the new chart answers, so the row neither collapses to
        // nothing (a row with no cards renders nothing) nor pushes every row
        // below it up and then back down.
        placeholderData: keepPreviousData,
        queryFn: () =>
            feed === 'chart'
                ? lbBot!.deezerChart(limit, genre)
                : lbBot!.deezerEditorial(limit, genre),
        // The genre is in the key, so switching chips is a cache lookup after
        // the first visit rather than another trip through the hub's four
        // shared proxy slots.
        queryKey: ['lbbot', 'deezer', feed, limit, genre],
        refetchOnWindowFocus: false,
        staleTime: 60 * 60 * 1000,
    });
    return useShownWithHub(query);
};

export const useLbBotDeezerChart = (limit = 20, genre = '0') =>
    useLbBotBrowse('chart', limit, genre);
export const useLbBotDeezerEditorial = (limit = 20, genre = '0') =>
    useLbBotBrowse('editorial', limit, genre);

/**
 * Deezer's genre list, for the chip row that scopes both feeds above.
 *
 * Gated on the hub advertising the route, which is what makes this additive: an
 * older hub hides the chips entirely and both rows behave exactly as they did
 * before, because `genre` defaults to Deezer's "All" and that is byte-for-byte
 * the request they were already making.
 *
 * Genre is the only axis offered. Deezer's open API has no country parameter —
 * the chart is geolocated by lb-bot's egress address — so a country picker
 * could only ever be a control that silently did nothing.
 */
export const useLbBotDeezerGenres = () => {
    const available = useLbBotAvailable();
    const supported = useHubSupports('GET /lb/deezer/genres');
    const query = useQuery<LbBotDeezerGenres | null>({
        enabled: !!lbBot && available && supported,
        gcTime: Infinity,
        queryFn: () => lbBot!.deezerGenres(),
        queryKey: ['lbbot', 'deezer', 'genres'],
        refetchOnWindowFocus: false,
        // Deezer has changed these ids before, which is why they are a route and
        // not a table — but not within a session. A failed read is asked again
        // on the next mount, or the chips would stay hidden until a restart.
        staleTime: staleUnlessAnswered(Infinity),
    });
    return useShownWithHub(query);
};

/**
 * Where a Deezer browse tile should open.
 *
 * A `BrowseTarget` rather than a bare release-group id, and that shape is the
 * fix for half of a real failure: an id can express only one of three outcomes,
 * which is how a tile for an album the user owned in full came to open a
 * download page captioned "Not in your library".
 */
export type BrowseTarget =
    | { albumId: string; kind: 'library' }
    | { artist: string; kind: 'external'; rgid: string; title: string; year?: string };

/**
 * Resolve one Deezer browse row to a destination, library first.
 *
 * lb-bot marks the browse feeds against its **local release-group index**, which
 * only covers artists whose discography somebody has actually scanned. So
 * `releaseOwned: false` means "not in lb-bot's index", **not** "not in your
 * library" — two different questions that happen to share a word. Measured
 * 2026-09-23: the real `Daft Punk — Discovery` comes back `releaseOwned: false`
 * from the deployed service, for an album owned in full, because that artist had
 * never been scanned. No amount of fixing the search fixes that half.
 *
 * Navidrome holds the whole library and answers "do I have this" exactly, for
 * one cheap request. So the order is:
 *
 *   1. lb-bot already marked it owned, with an id → the library album
 *   2. **the library itself, matched on artist + title** → the library album
 *   3. lb-bot resolved an rgid → the external page
 *   4. one *fielded* MusicBrainz search, validated → library if owned, else external
 *   5. decline, and say so
 *
 * Steps 2 and 4 both drop the edition suffix: Deezer ships "Discovery
 * (Remastered)" where MusicBrainz and the library both say "Discovery".
 */
/**
 * Where an artist credit should open, given whatever handles are to hand.
 *
 * The album page's artist control has always been gated on an artist id **or**
 * an MBID. Reached from the Fresh tab or a discography shelf one of those is
 * populated; reached from a **Deezer browse row** neither is, because Deezer
 * carries no MusicBrainz ids at all — which is the whole reason those rows
 * arrive unresolved. So the control hid itself, correctly, and took the only
 * route to the discography scan with it.
 *
 * Resolution order mirrors what the album side settled:
 *
 *   1. the artist id the caller already knew
 *   2. **the library, matched on name** — either the browse row's plain credit
 *      ("Daft Punk") or lb-bot's full MusicBrainz one, since either may be how
 *      the library filed them
 *   3. an MBID: the page's own, else the one `/lb/album/releases` answers
 *   4. nothing, and the credit stays plain text rather than becoming a control
 *      that refuses
 *
 * Library before MusicBrainz for the reason the album side established: an
 * owned artist must open *their* page, because the external one renders every
 * album they own as "Added - syncing".
 */
export const useArtistTarget = (args: {
    artistId?: string;
    artistMbid?: string;
    name?: string;
}): string | undefined => {
    const serverId = useCurrentServerId();
    const { artistId, artistMbid, name } = args;

    const local = useQuery<null | string>({
        enabled: Boolean(serverId) && !artistId && Boolean(name),
        gcTime: 5 * 60 * 1000,
        queryFn: async () => {
            const found = await api.controller
                .getAlbumArtistList({
                    apiClientProps: { serverId: serverId! },
                    query: {
                        limit: 25,
                        searchTerm: name!,
                        sortBy: AlbumArtistListSort.NAME,
                        sortOrder: SortOrder.ASC,
                        startIndex: 0,
                    },
                })
                .catch(() => null);
            return (found?.items ?? []).find((row) => sameArtist(row.name, name!))?.id ?? null;
        },
        queryKey: ['lbbot', 'artist-target', serverId, name],
        staleTime: 5 * 60 * 1000,
    });

    return artistLinkPath(artistId || local.data || '', artistMbid || '', name);
};

/**
 * The artist page for a name and an MBID, worked out when it is asked for: the library's
 * own page when the library has that artist (`pickLibraryArtist`, review M4), else the
 * virtual one. For a row of many artists, where a search per row on render would be one
 * request per card. Review L1: it answers the path; `useOpenLbBotArtist` decides whether the
 * tap still navigates.
 */
export const useResolveLibraryArtistPath = () => {
    const serverId = useCurrentServerId();

    return useCallback(
        async (artistMbid: string, name: string, owned?: boolean) => {
            if (!serverId) return artistLinkPath('', artistMbid, name);
            // B-407 review M4: the search's rows are cached (not one answer per name), and the
            // row's MBID and ownership pick among them (`pickLibraryArtist`).
            const search = (roles: 'album' | 'all') =>
                queryClient
                    .fetchQuery<{ id: string; mbz: null | string; name: string }[]>({
                        gcTime: 5 * 60 * 1000,
                        queryFn: async () => {
                            const query = {
                                limit: 25,
                                searchTerm: name,
                                sortOrder: SortOrder.ASC,
                                startIndex: 0,
                            };
                            const found = await (
                                roles === 'album'
                                    ? api.controller.getAlbumArtistList({
                                          apiClientProps: { serverId },
                                          query: { ...query, sortBy: AlbumArtistListSort.NAME },
                                      })
                                    : api.controller.getArtistList({
                                          apiClientProps: { serverId },
                                          query: { ...query, sortBy: ArtistListSort.NAME },
                                      })
                            ).catch(() => null);
                            return (found?.items ?? []).map((row) => ({
                                id: row.id,
                                mbz: row.mbz ?? null,
                                name: row.name,
                            }));
                        },
                        queryKey: ['lbbot', 'artist-search', serverId, roles, name],
                        staleTime: 5 * 60 * 1000,
                    })
                    .catch(() => []);
            const row = { mbid: artistMbid, name, owned };
            let libraryId = pickLibraryArtist(await search('album'), row);
            // VM walk edge: an artist only on others' albums (a track artist) is no album artist;
            // on a miss, Navidrome's artists of every role are asked (one more search, on a miss).
            if (!libraryId && getServerById(serverId)?.type === ServerType.NAVIDROME) {
                libraryId = pickLibraryArtist(await search('all'), row);
            }
            return artistLinkPath(libraryId || '', artistMbid, name);
        },
        [serverId],
    );
};

/**
 * B-407: an lb-bot row's artist, opened on tap. lb-bot's own match opens the library page; a row
 * it did not match is looked up in the library by name with B-313's rule (`useResolveLibraryArtistPath`, the
 * album page's rule), else the MBID's virtual page (`artistLinkStep`). For a link that also has
 * an href (`artistLinkPath`), `looksUp` says whether the tap must be taken over.
 */
export const useOpenLbBotArtist = () => {
    const navigate = useNavigate();
    const resolvePath = useResolveLibraryArtistPath();
    // Review L1: where the tap was made, and whether this caller is still mounted, when the
    // lookup ends; the busy link is the guard's pending key.
    const location = useLocation();
    const here = useRef(location.key);
    here.current = location.key;
    const mounted = useRef(true);
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);
    const pending = useSyncExternalStore(artistTaps.subscribe, artistTaps.pending);

    const open = useCallback(
        (artist: LbBotArtistLinkRow) => {
            const step = artistLinkStep(artist.artistId, artist.mbid, artist.name);
            const token = artistTaps.begin(artistTapKey(artist));
            if (token === null) return; // a second tap on the link still pending
            if (step === 'lookup') {
                const from = here.current;
                void resolvePath(artist.mbid ?? '', artist.name ?? '', artist.owned)
                    .catch(() => undefined)
                    .then((to) => {
                        const go = artistTaps.finish(
                            token,
                            mounted.current && here.current === from,
                        );
                        if (go && to) navigate(to);
                    });
                return;
            }
            artistTaps.finish(token, true); // supersedes a lookup still pending
            const to =
                step === 'library'
                    ? artistLinkPath(artist.artistId ?? '', '')
                    : step === 'external'
                      ? artistLinkPath('', artist.mbid ?? '', artist.name ?? undefined)
                      : undefined;
            if (to) navigate(to);
        },
        [navigate, resolvePath],
    );

    const looksUp = useCallback(
        (artist: LbBotArtistLinkRow) =>
            artistLinkStep(artist.artistId, artist.mbid, artist.name) === 'lookup',
        [],
    );

    /** Whether this row's tap is the one being looked up (its busy state). */
    const isPending = useCallback(
        (artist: LbBotArtistLinkRow) => pending !== null && pending === artistTapKey(artist),
        [pending],
    );

    return { isPending, looksUp, open, pending };
};

/** Review L1: one guard for every lb-bot artist link's tap (`artist-tap.ts`). */
const artistTaps = createTapGuard();

export interface LbBotArtistLinkRow {
    /** lb-bot's own match to a library artist; empty when it found none. */
    artistId?: null | string;
    mbid?: null | string;
    name?: null | string;
    /** lb-bot's word on ownership, where the row has one (review M4: only an owned row's credit
     *  may be split to find the library artist). */
    owned?: boolean;
}

export const useResolveBrowseAlbum = () => {
    const [pending, setPending] = useState('');
    const serverId = useCurrentServerId();

    /** Step 2. One Navidrome search, scored by the same rules step 4 uses, so a
     *  library hit and a MusicBrainz hit cannot disagree about what "the same
     *  album" means. */
    const localAlbumFor = useCallback(
        async (album: { artist: string; title: string }): Promise<null | string> => {
            if (!serverId) return null;
            const term = normalizeAlbumTitle(album.title);
            if (!term) return null;
            const found = await api.controller
                .getAlbumList({
                    apiClientProps: { serverId },
                    query: {
                        limit: 25,
                        searchTerm: term,
                        sortBy: AlbumListSort.NAME,
                        sortOrder: SortOrder.ASC,
                        startIndex: 0,
                    },
                })
                .catch(() => null);
            const hit = (found?.items ?? []).find(
                (row) =>
                    sameAlbumTitle(row.name, album.title) &&
                    sameArtist(row.albumArtistName || '', album.artist),
            );
            return hit?.id ?? null;
        },
        [serverId],
    );

    const resolve = useCallback(
        async (album: {
            artist: string;
            releaseAlbumId?: string;
            releaseOwned?: boolean;
            rgid?: string;
            title: string;
        }): Promise<BrowseTarget | null> => {
            // 1. lb-bot's own badge, when it carries an id to act on.
            if (album.releaseOwned && album.releaseAlbumId) {
                return { albumId: album.releaseAlbumId, kind: 'library' };
            }
            setPending(`${album.artist}-${album.title}`);
            try {
                // 2. The library, before the network. Free, exact and offline.
                const local = await localAlbumFor(album);
                if (local) return { albumId: local, kind: 'library' };

                // 3. lb-bot placed the row but the library does not have it.
                if (album.rgid) {
                    return {
                        artist: album.artist,
                        kind: 'external',
                        rgid: album.rgid,
                        title: album.title,
                    };
                }

                // 4. One fielded search, and the answer checked against the
                //    question. Trusting the order is what opened a parody.
                const query = fieldedAlbumQuery(album.artist, album.title);
                if (!lbBot || !query) return null;
                const candidates = await lbBot.albumLookup(query).catch(() => []);
                // Validated against the question, then ordered (ownership, no
                // bracketed qualifier, lb-bot's order) - see `rankAlbumCandidates`
                // for why validation alone leaves a bootleg one place from winning.
                const ranked = rankAlbumCandidates(candidates, album);
                const hit = ranked[0];
                if (!hit) return null;
                if (hit.releaseAlbumId) {
                    return { albumId: hit.releaseAlbumId, kind: 'library' };
                }
                // MusicBrainz named the record but lb-bot has no Navidrome id
                // for it — which may still be an album on disk by an unscanned
                // artist, so ask the library again under its canonical title.
                const canonical = await localAlbumFor({
                    artist: hit.artist || album.artist,
                    title: hit.title || album.title,
                });
                if (canonical) return { albumId: canonical, kind: 'library' };
                return {
                    artist: hit.artist || album.artist,
                    kind: 'external',
                    rgid: hit.rgid,
                    title: hit.title || album.title,
                    year: hit.year,
                };
            } finally {
                setPending('');
            }
        },
        [localAlbumFor],
    );

    return { pending, resolve };
};

/**
 * Deezer's "related artists" — a third similarity source beside ListenBrainz
 * and Last.fm.
 *
 * Answers in the *same* shape as `useLbBotSimilarArtists`, deliberately: lb-bot
 * marks ownership identically, so one renderer serves both and there is no
 * second vocabulary to keep in step.
 */
export const useLbBotRelatedArtists = (args: {
    limit?: number;
    mbid?: null | string;
    name?: null | string;
}) => {
    const available = useLbBotAvailable();
    const supported = useHubSupports('GET /lb/artist/related');
    const { limit, mbid, name } = args;
    const query = useQuery<LbBotSimilarArtists | null>({
        enabled: !!lbBot && available && supported && !!(mbid || name),
        gcTime: 60 * 60 * 1000,
        queryFn: () =>
            lbBot!.artistRelated({ limit, mbid: mbid ?? undefined, name: name ?? undefined }),
        queryKey: ['lbbot', 'artist-related', mbid || name, limit],
        refetchOnWindowFocus: false,
        staleTime: 60 * 60 * 1000,
    });
    return useShownWithHub(query);
};

/**
 * Resolve a pasted streaming URL.
 *
 * Imperative, because it is a one-shot the user pressed and the answer is
 * navigated to rather than rendered. Returns the result unchanged so the caller
 * can tell "lb-bot cannot read that link" (an error worth saying) from
 * `kind: 'unknown'` (a legitimate answer about a provider it does not parse).
 */
export const useResolveLink = () => {
    const [pending, setPending] = useState(false);

    const resolve = useCallback(async (url: string): Promise<LbBotResult<LbBotResolvedLink>> => {
        if (!lbBot) return NO_LINK;
        setPending(true);
        const result = await lbBot.resolveLink(url);
        setPending(false);
        return result;
    }, []);

    return { pending, resolve };
};

const NO_LINK: LbBotResult<LbBotResolvedLink> = {
    data: null,
    error: 'lb-bot is not available in this build.',
    ok: false,
    status: 0,
};

/**
 * The wishlist: albums nobody was sharing, kept for a slow re-search.
 *
 * Polled on a long interval rather than on a notification, because the thing
 * that changes it is lb-bot's own periodic re-search running on a scale of
 * hours — a landing also fires `/lb/notify`, which refreshes the library, but
 * the row leaving this list is a separate fact.
 */
/**
 * Worbus P4 (design §6.5): `/lb/attention`'s counts, for the imports row and the to-fix badge.
 * Admin only, like the rest of `/lb/attention` (a non-admin never asks). `null` data (an older
 * hub or lb-bot) reads as no imports (`attentionImports`).
 */
/** What `/lb/attention` answers a client (main's allowlist): counts, folders, and Need you's albums. */
export interface LbBotAttentionAnswer {
    /** null from a main or lb-bot before the rows: Need you then reads `/lb/activity` alone. */
    albums: LbBotAttentionAlbum[] | null;
    counts: Record<string, number>;
    folders: LbBotAttentionFolder[];
    foldersCut: number;
}

/**
 * Review L4: an admin's read (`/lb/attention`, `/lb/activity`) holds other clients' album names.
 * When this user may no longer read it (demoted by a `user` frame, the hub's setup removed, a
 * hub without the route) the cached answer is dropped, not merely hidden; a read that only failed
 * keeps its last answer (review L2), as does a blip in lb-bot's availability.
 */
const useAdminLbRead = (queryKey: readonly string[], allowed: boolean): void => {
    useEffect(() => {
        if (allowed) return;
        void queryClient.cancelQueries({ exact: true, queryKey });
        queryClient.removeQueries({ exact: true, queryKey });
        // eslint-disable-next-line react-hooks/exhaustive-deps -- the key is a constant per caller
    }, [allowed]);
};

const ATTENTION_KEY = ['lbbot', 'attention-counts'] as const;
const ACTIVITY_KEY = ['lbbot', 'activity'] as const;

export const useLbBotAttention = () => {
    const available = useLbBotAvailable();
    const supported = useHubSupports('GET /lb/attention');
    const admin = allows(useHubRoles(), 'needsAttention');
    const setUp = useMirrorShown();
    const allowed = !!lbBot && supported && admin && setUp;
    useAdminLbRead(ATTENTION_KEY, allowed);
    const query = useQuery<LbBotAttentionAnswer | null>({
        enabled: allowed && available,
        gcTime: 5 * 60 * 1000,
        queryFn: async () => {
            const answer: unknown = await lbBot!.attentionCounts();
            if (!answer || typeof answer !== 'object') return null;
            // B-406: the counts with the folders; a main from before them sent the counts alone.
            const a = answer as Record<string, unknown>;
            return 'counts' in a
                ? {
                      ...(answer as Omit<LbBotAttentionAnswer, 'albums'>),
                      albums: Array.isArray(a.albums) ? (a.albums as LbBotAttentionAlbum[]) : null,
                  }
                : { albums: null, counts: a as Record<string, number>, folders: [], foldersCut: 0 };
        },
        queryKey: [...ATTENTION_KEY],
        // Need you reads its albums too (another client's picks): polled as `/lb/activity` is.
        refetchInterval: 60 * 1000,
        refetchOnWindowFocus: true,
        staleTime: 60 * 1000,
    });
    const shown = useShownWithHub(query);
    return allowed ? shown : ({ ...shown, data: undefined } as typeof shown);
};

/**
 * Activity's Need you (the owner, 2026-11-13): every client's requests lb-bot's ledger holds,
 * `/lb/activity` (PROTOCOL §15.6). Admin only, as the badge is; null data (an older hub or lb-bot,
 * not read yet) leaves Need you to this device's ledger and `/lb/attention`'s albums
 * (`needYouItems`). Re-read on a `fill` frame (`invalidateNeedYouReads`), on focus, and every
 * 60 s while shown. A failed read keeps the last good list (review L2).
 */
export const useLbBotActivity = () => {
    const available = useLbBotAvailable();
    const supported = useHubSupports('GET /lb/activity');
    const admin = allows(useHubRoles(), 'needsAttention');
    const setUp = useMirrorShown();
    const allowed = !!lbBot && supported && admin && setUp;
    useAdminLbRead(ACTIVITY_KEY, allowed);
    const query = useQuery<LbBotActivityRequest[] | null>({
        enabled: allowed && available,
        gcTime: 5 * 60 * 1000,
        queryFn: () => lbBot!.activity(),
        queryKey: [...ACTIVITY_KEY],
        refetchInterval: 60 * 1000,
        refetchOnWindowFocus: true,
        staleTime: 30 * 1000,
    });
    const shown = useShownWithHub(query);
    return allowed ? shown : ({ ...shown, data: undefined } as typeof shown);
};

/**
 * A fill moved (a `fill` frame): what lb-bot's ledger and its attention list say may have too.
 * Main runs one read of each at a time and folds a burst into one follow-up (review L4).
 */
export const invalidateNeedYouReads = (): void => {
    void queryClient.invalidateQueries({ exact: true, queryKey: [...ACTIVITY_KEY] });
    void queryClient.invalidateQueries({ exact: true, queryKey: [...ATTENTION_KEY] });
};

export const useLbBotWishlist = () => {
    const available = useLbBotAvailable();
    const supported = useHubSupports('GET /lb/wishlist');
    const query = useQuery<LbBotWishlist>({
        enabled: !!lbBot && available && supported,
        gcTime: 5 * 60 * 1000,
        queryFn: () => lbBot!.wishlist(),
        queryKey: ['lbbot', 'wishlist'],
        refetchOnWindowFocus: true,
        staleTime: 60 * 1000,
    });
    return useShownWithHub(query);
};

/**
 * Add to / remove from the wishlist, invalidating the list either way.
 *
 * The add is offered on exactly one thing: a fill that failed `no_source`.
 * Everything else either retries usefully or needs fixing in lb-bot, and
 * offering a wishlist button there would be a second dead end wearing a
 * different label.
 */
export const useWishlistActions = () => {
    const queryClient = useQueryClient();

    const invalidate = useCallback(
        () => queryClient.invalidateQueries({ queryKey: ['lbbot', 'wishlist'] }),
        [queryClient],
    );

    const add = useCallback(
        async (args: { artist: string; rgid: string; title: string }): Promise<boolean> => {
            if (!lbBot) return false;
            const result = await lbBot.wishlistAdd(args);
            if (result.ok) void invalidate();
            else toast.error({ message: result.error || 'lb-bot would not take that request.' });
            return result.ok;
        },
        [invalidate],
    );

    const remove = useCallback(
        async (rgid: string): Promise<boolean> => {
            if (!lbBot) return false;
            const result = await lbBot.wishlistRemove(rgid);
            if (result.ok) void invalidate();
            else toast.error({ message: result.error || 'lb-bot would not take that request.' });
            return result.ok;
        },
        [invalidate],
    );

    return { add, remove };
};
