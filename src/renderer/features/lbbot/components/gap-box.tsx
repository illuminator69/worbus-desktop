import { useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';

import styles from './gap-box.module.css';

import { albumQueries } from '/@/renderer/features/albums/api/album-api';
import { PillTone, ReleasePill } from '/@/renderer/features/discography/components/release-pill';
import scanStyles from '/@/renderer/features/discography/components/scan.module.css';
import { openAlbumMatchModal } from '/@/renderer/features/lbbot/components/album-match-modal';
import { RequestSteps } from '/@/renderer/features/lbbot/components/request-steps';
import { SourceCards, SourceRefusal } from '/@/renderer/features/lbbot/components/source-cards';
import {
    refusalSaysListIsStale,
    refusalUnder,
    shownSelection,
    sourceKey,
} from '/@/renderer/features/lbbot/components/source-cards-model';
import {
    GAP_RESULT_HOLD_MS,
    gapBoxGroup,
    type GapBoxGroup,
    gapFillLanded,
    type GapFillRow,
    gapMatchPending,
    gapPolls,
    gapProgress,
    gapReadGaveUp,
    gapRowsOwed,
    gapStage,
    gapStageFamily,
    gapTracksToFetch,
    type GapView,
    gapViewOnAsk,
    heldTracks,
    searchProgressLine,
} from '/@/renderer/features/lbbot/gap-stage';
import { useKeepTopInView } from '/@/renderer/features/lbbot/hooks/use-keep-top-in-view';
import {
    allowMp3ForAlbum,
    autoFillGap,
    cancelFill,
    fetchGapSource,
    gapIsBusy,
    gapsByAlbumId,
    rescanGapAlbum,
    searchGapSources,
    startGapWatch,
    useAlbumOverrideControls,
    useGapSourceFiles,
    useHubSupports,
    useLbBotAvailable,
    useLbBotDiscography,
    useLbBotDownloadsShown,
    useLbBotGap,
    useLbBotWebUrl,
} from '/@/renderer/features/lbbot/hooks/use-lbbot';
import { gapBoxShrinks } from '/@/renderer/features/lbbot/keep-top';
import { gapSearchForce } from '/@/renderer/features/lbbot/search-again';
import {
    useActiveFillsActions,
    useActiveGap,
} from '/@/renderer/features/lbbot/stores/active-fills.store';
import { gapPositionLabel, gapShowsDisc } from '/@/renderer/features/lbbot/utils/gap-position';
import { Fold } from '/@/renderer/features/motion/fold';
import { GrowBox } from '/@/renderer/features/motion/grow-box';
import { HoldWhile } from '/@/renderer/features/motion/hold-while';
import { useCurrentServer } from '/@/renderer/store';
import { ActionIcon } from '/@/shared/components/action-icon/action-icon';
import { Button } from '/@/shared/components/button/button';
import { Icon } from '/@/shared/components/icon/icon';
import { Album } from '/@/shared/types/domain-types';
import {
    LbBotGapAction,
    LbBotGapSource,
    LbBotGapTrackState,
    LbBotResult,
} from '/@/shared/types/lbbot-types';

/*
 * navi-connect R11 (B-223): the gaps box on the owned album page, after Worbus for Android's `GapBox`, which
 * retired its `GapFillSheet` as this retires Worbus for desktop's gap modal. What the modal did and where each
 * thing went:
 *
 * | The modal                                         | The box                                       |
 * |---------------------------------------------------|-----------------------------------------------|
 * | the album, "9/12" and the extra-files badge       | the page itself; the line counts what is      |
 * |                                                   |   missing                                     |
 * | the tracklist with a state on every row           | `tracks`: only the missing ones, each with    |
 * |                                                   |   its pill (the page lists the rest), B-071   |
 * |                                                   |   disc numbers kept                           |
 * | "Counted against the release...", Wrong edition?  | `tracks`' note, with Wrong edition? in it     |
 * | Find sources / Search again                       | Fill gaps (the line's button); Search again   |
 * |                                                   |   under the sources                           |
 * | the source rows, Show files, Fill N from source   | `choosing`: the radio cards, the listing on a |
 * |                                                   |   pick, Request under the chosen one          |
 * | Pick the best source for me                       | a quiet button under the sources              |
 * | the progress line and bar                         | `active`: the steps, the bar, the count       |
 * | Cancel                                            | `active`'s Cancel request                     |
 * | Allow MP3 for this album                          | "Allow MP3 for this request" where lb-bot     |
 * |                                                   |   says it would help                          |
 * | Re-check album, Open in lb-bot                    | `tracks`' quiet buttons; `attention`'s rows   |
 * | the stalled-placement and awaiting-match lines    | `attention`, in lb-bot's words                |
 *
 * Which stage shows is `gapStage`'s (gap-stage.ts, every precedence a harness case). The box
 * follows its content's height and fades between kinds of stage, so nothing swaps at once.
 */

/** Where the user had each album's box this session (not persisted), so coming back keeps it. */
const gapViews = new Map<string, GapView>();

/** History entries whose `lbGapView` ask has been taken, so a return to one does not repeat it. */
const consumedAsks = new Set<string>();

/** Released if lb-bot never admits to the fetch: a request that quietly did not take gives the box back. */
const COMMIT_RELEASE_MS = 30_000;

/** When the page re-reads the album after a fill lands: Navidrome may still be scanning the files. */
const LANDED_REFRESH_MS = [5_000, 20_000, 45_000];

const TRACK_TONE: Partial<Record<LbBotGapTrackState, PillTone>> = {
    done: 'owned',
    downloaded: 'syncing',
    downloading: 'active',
    failed: 'failed',
    picked: 'active',
    queued: 'active',
};

/**
 * A missing row's pill, from en.json (review minor 9). B-004: `cancelled` is the user's verdict,
 * not a failure, and its word is the app's shared `common.cancelled`.
 */
const useTrackLabel = () => {
    const { t } = useTranslation();
    return (state: LbBotGapTrackState): string => {
        switch (state) {
            case 'cancelled':
                return t('common.cancelled');
            case 'done':
                return t('naviConnect.gapBox.trackAdded');
            case 'downloaded':
                return t('naviConnect.gapBox.trackDownloaded');
            case 'downloading':
                return t('naviConnect.gapBox.trackDownloading');
            case 'failed':
                return t('naviConnect.gapBox.trackFailed');
            case 'missing':
                return t('naviConnect.gapBox.trackMissing');
            case 'picked':
                return t('naviConnect.gapBox.trackPicked');
            case 'queued':
                return t('naviConnect.gapBox.trackQueued');
            case 'skipped':
                return t('naviConnect.gapBox.trackSkipped');
            default:
                return String(state).replace('_', ' ');
        }
    };
};

/** Where the album-page state a context-menu entry sends asks the box to open. */
export interface GapBoxLocationState {
    lbGapView?: GapView;
}

/**
 * The gaps box for an album the library holds part of, above the tracklist's toolbar. Renders
 * nothing unless lb-bot knew this exact album incomplete during the visit and the hub proxies the
 * gap routes:
 * not configured, unreachable, a hub too old and a complete album all look like no box at all
 * (the same decision the context menu's "Find N missing tracks" makes). It never starts a
 * discography scan: the index answers from the mirror or one read.
 */
export const AlbumGapBox = ({ album }: { album: Album }) => {
    const artistId = album.albumArtists?.[0]?.id ?? '';
    const discography = useLbBotDiscography(artistId);
    const available = useLbBotAvailable();
    // A hub older than this app proxies no gap routes: without asking, Fill gaps would 404 quietly.
    const supported = useHubSupports('POST /lb/gap/search');
    const release = useMemo(
        () => gapsByAlbumId(discography.data).get(album.id),
        [discography.data, album.id],
    );
    // Once shown, the box stays for the visit (review I3): the index flips the album to present as
    // the fill lands, and the box has its result row to show and its re-reads to run.
    const [kept, setKept] = useState<GapBoxGroup | null>(null);
    const shown = gapBoxGroup(
        kept,
        album.id,
        release?.groupId
            ? {
                  groupId: release.groupId,
                  missing: Math.max((release.totalTracks ?? 0) - (release.presentTracks ?? 0), 0),
              }
            : null,
    );
    if (shown && (shown.groupId !== kept?.groupId || shown.albumId !== kept.albumId)) {
        setKept(shown);
    }
    if (!available || !supported || !shown) return null;
    return (
        <GapBox
            albumId={album.id}
            albumName={album.name}
            groupId={shown.groupId}
            key={shown.groupId}
            mirroredMissing={shown.mirroredMissing}
            songCount={album.songs?.length ?? album.songCount ?? 0}
        />
    );
};

const GapBox = ({
    albumId,
    albumName,
    groupId,
    mirroredMissing,
    songCount,
}: {
    albumId: string;
    albumName: string;
    groupId: string;
    mirroredMissing: number;
    songCount: number;
}) => {
    const { t } = useTranslation();
    const trackLabel = useTrackLabel();
    const [view, setViewState] = useState<GapView>(() => gapViews.get(groupId) ?? 'folded');
    const [searchAsked, setSearchAsked] = useState(false);
    const [committed, setCommitted] = useState(false);
    const [working, setWorking] = useState(false);
    const [error, setError] = useState('');
    // A refused Request, shown under that card's button (B-238), not at the box's foot.
    const [refused, setRefused] = useState<null | {
        message: string;
        sourceKey: string;
        stale: boolean;
    }>(null);
    const [picked, setPicked] = useState<null | number>(null);
    const [fetched, setFetched] = useState<LbBotGapSource | null>(null);
    const [now, setNow] = useState(() => Date.now());
    const root = useRef<HTMLElement>(null);
    // Worbus P1: with downloading off the box keeps the missing-tracks list, Recheck and Open in
    // lb-bot, and offers no fill, search, fetch, auto, cancel or MP3 opt-in. A sources view left
    // open when the mode flips (a stale "on" answered by a 409) reads as the track list.
    const downloadsShown = useLbBotDownloadsShown();
    const shownView: GapView = downloadsShown || view !== 'sources' ? view : 'tracks';

    const setView = (next: GapView) => {
        gapViews.set(groupId, next);
        setViewState(next);
        setError('');
        setRefused(null);
    };

    const active = useActiveGap(groupId);
    const { dismiss } = useActiveFillsActions();
    const fill: GapFillRow | null = active
        ? {
              done: active.done ?? 0,
              finishedAt: active.finishedAt ?? 0,
              mp3WouldHelp: active.mp3WouldHelp ?? false,
              outcome: active.outcome ?? (active.settled ? 'gaveUp' : 'running'),
              reason: active.reason ?? '',
              settled: active.settled,
              total: active.total ?? 0,
          }
        : null;
    // One read when the page opens, then polls only while something moves or an open box has no
    // answer yet (`gapPolls`, review minor 6); failed reads give up after PROTOCOL 15.2's bounded
    // patience. A fill started elsewhere arrives by the hub's `fill` frame, which re-reads this
    // query; while this device has a ledger row, the app-root watcher keeps the same entry fresh.
    const {
        error: readError,
        failingSince,
        gap,
        readAt,
        refetch,
    } = useLbBotGap(groupId, true, (current, since) =>
        gapPolls({
            // Rows a summary did not carry are owed by a read (B-377): keep asking for them.
            answered: !!current && !gapRowsOwed(current),
            busy: gapIsBusy(current),
            committed,
            failingSince: since,
            fillRunning: !!active && !active.settled,
            now: Date.now(),
            searchAsked,
            view: shownView,
        }),
    );
    const readGaveUp = gapReadGaveUp(failingSince, readAt);
    const sourceFiles = useGapSourceFiles(groupId, gap?.sourcesFoundAt ?? 0);
    const webUrl = useLbBotWebUrl();
    const albumControls = useAlbumOverrideControls();
    const busy = gapIsBusy(gap);

    // When the box saw a fill land during this visit: the result row holds from here (the ledger's
    // settle lags the landing by a poll; before B-233 by up to a 90 s grace, walk finding R11 Task 4).
    const [landedAt, setLandedAt] = useState(0);
    // The box saw the record not landed during this visit and has not noted its landing yet. The
    // render between the landing and the note (a tick) counts it as landing now, so the transfer
    // turns straight into the result row instead of the box folding away for a frame (B-244).
    const [unlandedSeen, setUnlandedSeen] = useState(false);
    const landed = gap ? gapFillLanded(gap, fill) : false;
    const stage = gapStage({
        committed,
        fill,
        gap,
        landedAt: landed && unlandedSeen ? now : landedAt,
        mirroredMissing,
        now,
        readGaveUp,
        searchAsked,
        view: shownView,
    });

    // The result row holds for a few seconds after the finish (as the box saw it, else as the
    // ledger settled it), then the box folds away.
    const heldFrom =
        landedAt || (active?.settled && active.outcome === 'done' ? (active.finishedAt ?? 0) : 0);
    useEffect(() => {
        if (!heldFrom) return undefined;
        const left = heldFrom + GAP_RESULT_HOLD_MS - Date.now();
        if (left <= 0) return undefined;
        const timer = window.setTimeout(() => setNow(Date.now()), left + 50);
        return () => window.clearTimeout(timer);
    }, [heldFrom]);

    // A fetch is held as committed until lb-bot says it is busy, or for 30 s if it never does.
    useEffect(() => {
        if (!committed) return undefined;
        if (busy) {
            setCommitted(false);
            return undefined;
        }
        const timer = window.setTimeout(() => setCommitted(false), COMMIT_RELEASE_MS);
        return () => window.clearTimeout(timer);
    }, [committed, busy]);

    // The context menu's "Find N missing tracks" lands here with the box asked open. The ask is
    // taken once per history entry (review minor 10): Back to this album later finds the same
    // entry and its state, which must not reopen the box and scroll the page again.
    const location = useLocation();
    const asked = (location.state as GapBoxLocationState | null)?.lbGapView;
    useEffect(() => {
        if (!asked || consumedAsks.has(location.key)) return;
        consumedAsks.add(location.key);
        const next = gapViewOnAsk(gapViews.get(groupId) ?? 'folded', asked);
        gapViews.set(groupId, next);
        setViewState(next);
        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        root.current?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'nearest' });
    }, [asked, groupId, location.key]);

    // The tracklist follows a fill that lands during the visit (Worbus for Android's `watchGapLanding`): the
    // album is read again a few seconds on, and again while it holds fewer songs than lb-bot counts.
    // The re-reads are kept apart from the record (review minor 5): a later poll changing the gap
    // must not cancel them; only a new landing or leaving the page does, as Worbus for Android's job.
    const queryClient = useQueryClient();
    const server = useCurrentServer();
    const held = gap ? heldTracks(gap) : 0;
    const before = useRef<boolean | null>(null);
    const songs = useRef(songCount);
    const heldNow = useRef(held);
    const landing = useRef<number[]>([]);
    useEffect(() => {
        songs.current = songCount;
        heldNow.current = held;
    }, [songCount, held]);
    useEffect(() => {
        if (!gap) return;
        if (!landed && !unlandedSeen) setUnlandedSeen(true);
        const was = before.current;
        before.current = landed;
        if (was !== false || !landed) return;
        const queryKey = albumQueries.detail({
            query: { id: albumId },
            serverId: server.id,
        }).queryKey;
        landing.current.forEach((timer) => window.clearTimeout(timer));
        // The landing is noted on the next tick: the result row's hold starts here.
        const noted = window.setTimeout(() => {
            const at = Date.now();
            setLandedAt(at);
            setNow(at);
            setUnlandedSeen(false);
        }, 0);
        landing.current = [
            noted,
            ...LANDED_REFRESH_MS.map((ms) =>
                window.setTimeout(() => {
                    if (songs.current < heldNow.current) {
                        void queryClient.invalidateQueries({ queryKey });
                    }
                }, ms),
            ),
        ];
    }, [albumId, gap, landed, queryClient, server.id, unlandedSeen]);
    useEffect(() => {
        const timers = landing;
        return () => timers.current.forEach((timer) => window.clearTimeout(timer));
    }, []);

    /** Every write goes through here so a refusal is shown in the box, never swallowed. */
    const act = async (
        action: () => Promise<LbBotResult<boolean>>,
        after?: () => void,
    ): Promise<boolean> => {
        setWorking(true);
        setError('');
        try {
            const result = await action();
            if (!result.ok) {
                // Downloading turned out to be off: the mode flips and the box loses its fetching
                // controls, which says it; a red line would only repeat it.
                if (result.code !== 'downloads_off') {
                    setError(result.error || t('naviConnect.gapBox.refused'));
                }
                return false;
            }
            after?.();
            return true;
        } finally {
            setWorking(false);
        }
    };

    const search = async (press: 'allowMp3' | 'fillGaps' | 'searchAgain' = 'searchAgain') => {
        setView('sources');
        setSearchAsked(true);
        setPicked(null);
        try {
            let answer: LbBotGapAction | undefined;
            const ok = await act(async () => {
                answer = await searchGapSources(
                    groupId,
                    gapSearchForce(press, gap?.sources.length ?? 0),
                );
                return answer;
            });
            // A search makes the ledger row too, as Worbus for Android's does: waiting for a pick is worth
            // listing, and a search that ends with nothing is worth announcing.
            if (ok) startGapWatch(groupId, { album: gap?.album, artist: gap?.artist }, answer);
            await refetch();
        } finally {
            setSearchAsked(false);
        }
    };

    /** Fill gaps: the same box turns to the sources, asking only when lb-bot holds none and is not looking. */
    const fillGaps = () => {
        setView('sources');
        const looking =
            gap?.sourceTask?.status === 'queued' || gap?.sourceTask?.status === 'running';
        if (!gap || (gap.sources.length === 0 && !looking)) void search('fillGaps');
    };

    const choose = (source: LbBotGapSource) => {
        setPicked(source.id);
        setRefused(null);
        // A gap's listing is not on the poll (the hub strips it): fetched once, on the pick.
        void sourceFiles.open(source);
    };

    /** Request: a refusal stays with the card it was asked for, in lb-bot's words (B-238). */
    const request = async (source: LbBotGapSource) => {
        setWorking(true);
        setError('');
        setRefused(null);
        try {
            const result = await fetchGapSource(groupId, source.id);
            if (!result.ok) {
                if (result.code === 'downloads_off') return;
                setRefused({
                    message: result.error || t('naviConnect.gapBox.refused'),
                    sourceKey: sourceKey(source),
                    stale: refusalSaysListIsStale(result),
                });
                return;
            }
            startGapWatch(groupId, { album: gap?.album, artist: gap?.artist }, result);
            setCommitted(true);
            setFetched(source);
            setView('tracks');
        } finally {
            setWorking(false);
        }
    };

    const auto = () => {
        let answer: LbBotGapAction | undefined;
        void act(
            async () => {
                answer = await autoFillGap(groupId);
                return answer;
            },
            () => {
                startGapWatch(groupId, { album: gap?.album, artist: gap?.artist }, answer);
                setCommitted(true);
                setFetched(null);
                setView('tracks');
            },
        );
    };

    const cancel = () =>
        void act(
            async () => {
                const ok = await cancelFill({ isGap: true, key: groupId });
                return { data: ok, error: '', ok, status: 200 };
            },
            () => {
                setCommitted(false);
                setFetched(null);
                setView('tracks');
            },
        );

    const allowMp3 = async () => {
        setWorking(true);
        const ok = await allowMp3ForAlbum(groupId);
        setWorking(false);
        if (!ok) {
            setError(t('naviConnect.gapBox.mp3Refused'));
            return;
        }
        void search('allowMp3');
    };

    const recheck = () =>
        void act(
            () => rescanGapAlbum(groupId),
            () => void refetch(),
        );

    const dismissFill = () => {
        dismiss(groupId);
        setView('folded');
    };

    const openInLbBot = webUrl
        ? () => window.open(`${webUrl}/#/gaps/${encodeURIComponent(groupId)}`, '_blank')
        : null;
    const wrongEdition =
        albumControls && gap?.albumId
            ? () =>
                  openAlbumMatchModal({
                      albumId: gap.albumId,
                      artistId: gap.artistId || undefined,
                      title: gap.album || albumName,
                  })
            : null;

    // The tracks a search or fetch is for (B-231: less those a pending match holds downloaded).
    const missing = gap ? gapTracksToFetch(gap) : [];
    const showDisc = gapShowsDisc(missing);
    const progress = gapProgress(gap);
    const open = stage.kind === 'tracks';
    const family = gapStageFamily(stage);
    // B-236: Request swaps the tall sources for the short transfer while the page keeps its scroll;
    // the box's top comes back under the sticky bar, once, if it went above it.
    useKeepTopInView(root, family, gapBoxShrinks);
    const missingCount =
        stage.kind === 'folded' ? stage.missing : missing.length || mirroredMissing;
    const selected =
        stage.kind === 'choosing' ? shownSelection(stage.sources, picked, stage.preselected) : null;

    const matchNotice =
        !!gap &&
        gapMatchPending(gap) &&
        (stage.kind === 'folded' ||
            stage.kind === 'tracks' ||
            stage.kind === 'searching' ||
            stage.kind === 'choosing' ||
            stage.kind === 'noSources');

    let content: ReactNode = null;
    if (stage.kind === 'folded' || stage.kind === 'tracks') {
        content = (
            <>
                <div className={styles.line}>
                    <button
                        aria-expanded={open}
                        className={styles.toggle}
                        data-gap-toggle=""
                        onClick={() => setView(open ? 'folded' : 'tracks')}
                        type="button"
                    >
                        <Icon icon="search" />
                        <span className={styles.titles}>
                            <span className={styles.title}>
                                {t('naviConnect.gapBox.missing', { count: missingCount })}
                            </span>
                            <span className={styles.sub}>
                                {open
                                    ? t('naviConnect.gapBox.clickToFold')
                                    : t('naviConnect.gapBox.clickToSee')}
                            </span>
                        </span>
                    </button>
                    {/* Fill gaps stays beside the title, open or folded: always one click. */}
                    {downloadsShown && (
                        <Button
                            data-gap-fill=""
                            onClick={fillGaps}
                            size="compact-sm"
                            variant="filled"
                        >
                            {t('naviConnect.gapBox.fillGaps')}
                        </Button>
                    )}
                    <ActionIcon
                        aria-expanded={open}
                        aria-label={
                            open
                                ? t('naviConnect.gapBox.clickToFold')
                                : t('naviConnect.gapBox.clickToSee')
                        }
                        className={styles.chevron}
                        data-open={open ? 'true' : 'false'}
                        icon="arrowDownS"
                        onClick={() => setView(open ? 'folded' : 'tracks')}
                        variant="transparent"
                    />
                </div>
                <Fold name="gap-tracks" open={open}>
                    <div className={styles.unfolded}>
                        {/* B-071: a multi-disc gap numbers its rows "2-1". */}
                        <ol className={styles.tracks} data-gap-tracks="">
                            {missing.map((track) => (
                                <li
                                    className={styles.track}
                                    data-with-disc={showDisc ? 'true' : undefined}
                                    key={`${track.disc}-${track.position}-${track.title}`}
                                >
                                    <span className={styles.number}>
                                        {gapPositionLabel(track, showDisc)}
                                    </span>
                                    <span className={styles.trackTitle}>{track.title}</span>
                                    <ReleasePill tone={TRACK_TONE[track.state] ?? 'missing'}>
                                        {trackLabel(track.state)}
                                    </ReleasePill>
                                </li>
                            ))}
                        </ol>
                        {/* Which release the count comes from: lb-bot measures against the album's
                            own MusicBrainz tag, so a library tagged as a 17-track deluxe reports 17
                            slots when every pressing on offer has 12. No download fixes that. */}
                        {(gap?.total ?? 0) > 0 && (
                            <p className={styles.note}>
                                <Icon icon="info" size="sm" />
                                <span>
                                    {t('naviConnect.gapBox.measuredAgainst', {
                                        album: gap?.album || albumName,
                                        count: gap?.total ?? 0,
                                    })}{' '}
                                    {wrongEdition && (
                                        <button
                                            className={styles.link}
                                            data-gap-wrong-edition=""
                                            onClick={wrongEdition}
                                            type="button"
                                        >
                                            {t('naviConnect.gapBox.wrongEdition')}
                                        </button>
                                    )}
                                </span>
                            </p>
                        )}
                        <div className={styles.quiet}>
                            <Button
                                disabled={working}
                                onClick={recheck}
                                size="compact-sm"
                                variant="subtle"
                            >
                                {t('naviConnect.gapBox.recheck')}
                            </Button>
                            {openInLbBot && (
                                <Button onClick={openInLbBot} size="compact-sm" variant="subtle">
                                    {t('naviConnect.gapBox.openInLbBot')}
                                </Button>
                            )}
                        </div>
                    </div>
                </Fold>
            </>
        );
    } else if (stage.kind === 'loading') {
        content = (
            <>
                <p className={styles.busy}>
                    <span aria-hidden="true" className={scanStyles.spin} />
                    {t('naviConnect.gapBox.searching')}
                </p>
                {readError && <p className={styles.error}>{readError}</p>}
            </>
        );
    } else if (stage.kind === 'unreachable') {
        content = (
            <div className={styles.recovery} data-gap-unreachable="">
                <p className={styles.reason}>{readError || t('naviConnect.gapBox.noAnswer')}</p>
                <div>
                    <Button onClick={() => void refetch()} size="compact-sm" variant="default">
                        {t('naviConnect.albumPage.tryAgain')}
                    </Button>
                </div>
            </div>
        );
    } else if (
        stage.kind === 'searching' ||
        stage.kind === 'choosing' ||
        stage.kind === 'noSources'
    ) {
        const wanted = Math.max(missing.length, 1);
        content = (
            <>
                <div className={styles.sourcesHead}>
                    <ActionIcon
                        aria-label={t('naviConnect.gapBox.back')}
                        icon="arrowLeftS"
                        onClick={() => setView('tracks')}
                        variant="transparent"
                    />
                    <span className={styles.titles}>
                        <span className={styles.title}>{t('naviConnect.gapBox.findSources')}</span>
                        {missing.length > 0 && (
                            <span className={styles.sub}>
                                {t('naviConnect.gapBox.forMissingOnly', {
                                    count: missing.length,
                                })}
                            </span>
                        )}
                    </span>
                    <ActionIcon
                        aria-label={t('common.close')}
                        icon="x"
                        onClick={() => setView('folded')}
                        variant="transparent"
                    />
                </div>
                <div className={styles.sources} data-gap-sources={stage.kind}>
                    {stage.kind === 'searching' && (
                        <p className={styles.busy}>
                            <span aria-hidden="true" className={scanStyles.spin} />
                            {searchProgressLine(gap?.sourceTask) ||
                                t('naviConnect.gapBox.searching')}
                        </p>
                    )}
                    {stage.kind === 'noSources' && (
                        <>
                            <p className={styles.reason}>
                                {stage.reason || t('naviConnect.gapBox.noSources')}
                            </p>
                            <div className={styles.quiet}>
                                {stage.mp3WouldHelp && (
                                    <Button
                                        disabled={working}
                                        onClick={() => void allowMp3()}
                                        size="compact-sm"
                                        variant="filled"
                                    >
                                        {t('naviConnect.gapBox.allowMp3')}
                                    </Button>
                                )}
                                <Button
                                    disabled={working}
                                    onClick={() => void search()}
                                    size="compact-sm"
                                    variant="default"
                                >
                                    {t('naviConnect.gapBox.searchAgain')}
                                </Button>
                            </div>
                        </>
                    )}
                    {stage.kind === 'choosing' && (
                        <>
                            <h3 className={styles.label}>
                                {t('naviConnect.albumPage.sourcesBestFirst', {
                                    count: stage.sources.length,
                                })}
                            </h3>
                            {selected === null && (
                                <p className={styles.sub} data-gap-choose="">
                                    {t('naviConnect.albumPage.chooseSource')}
                                </p>
                            )}
                            <SourceCards
                                disabled={working}
                                files={sourceFiles.view}
                                onSelect={choose}
                                renderUnderSelected={(source) => {
                                    const refusal = refusalUnder(refused, source);
                                    return (
                                        <div className={styles.underCard}>
                                            <Button
                                                data-gap-request=""
                                                disabled={working}
                                                loading={working}
                                                onClick={() => void request(source)}
                                                variant="filled"
                                            >
                                                {t('naviConnect.gapBox.requestTracks', {
                                                    count: wanted,
                                                })}
                                            </Button>
                                            {refusal && (
                                                <SourceRefusal
                                                    message={refusal.message}
                                                    onSearchAgain={
                                                        refusal.stale
                                                            ? () => void search()
                                                            : undefined
                                                    }
                                                />
                                            )}
                                        </div>
                                    );
                                }}
                                selected={selected}
                                sources={stage.sources}
                            />
                            {gap?.mp3WouldHelp && !gap.allowMp3 && (
                                <div>
                                    <Button
                                        disabled={working}
                                        onClick={() => void allowMp3()}
                                        size="compact-sm"
                                        variant="default"
                                    >
                                        {t('naviConnect.gapBox.allowMp3')}
                                    </Button>
                                </div>
                            )}
                            <div className={styles.quiet}>
                                <Button
                                    disabled={working}
                                    onClick={() => void search()}
                                    size="compact-sm"
                                    variant="subtle"
                                >
                                    {t('naviConnect.gapBox.searchAgain')}
                                </Button>
                                <Button
                                    disabled={working}
                                    onClick={auto}
                                    size="compact-sm"
                                    variant="subtle"
                                >
                                    {t('naviConnect.albumPage.autoPick')}
                                </Button>
                            </div>
                        </>
                    )}
                </div>
            </>
        );
    } else if (stage.kind === 'active') {
        const folder = fetched ? fetched.folder.split(/[\\/]/).filter(Boolean).pop() : '';
        content = (
            <>
                <div className={styles.activeHead}>
                    <span aria-hidden="true" className={scanStyles.spin} />
                    <span className={styles.titles}>
                        <span className={styles.title}>
                            {t('naviConnect.gapBox.getting', { count: stage.wanted })}
                        </span>
                        {fetched && (
                            <span className={styles.sub}>
                                {[
                                    fetched.format,
                                    t('naviConnect.gapBox.from', {
                                        folder: folder || fetched.peer,
                                    }),
                                ]
                                    .filter(Boolean)
                                    .join(' · ')}
                            </span>
                        )}
                    </span>
                    {stage.wanted > 0 && (
                        <span className={styles.count}>
                            {t('naviConnect.gapBox.count', {
                                done: stage.done,
                                total: stage.wanted,
                            })}
                        </span>
                    )}
                </div>
                <div className={styles.activeBody}>
                    <div
                        aria-label={t('naviConnect.gapBox.getting', { count: stage.wanted })}
                        aria-valuemax={100}
                        aria-valuemin={0}
                        aria-valuenow={progress.percent}
                        className={styles.progress}
                        role="progressbar"
                    >
                        <i
                            className={styles.progressFill}
                            style={{ width: `${progress.percent}%` }}
                        />
                    </div>
                    <RequestSteps steps={stage.steps} />
                    {stage.failed > 0 && (
                        <p className={styles.reason}>
                            {t('naviConnect.gapBox.tracksFailed', { count: stage.failed })}
                        </p>
                    )}
                    {downloadsShown && (
                        <div>
                            <Button
                                data-gap-cancel=""
                                disabled={working}
                                onClick={cancel}
                                size="compact-sm"
                                variant="default"
                            >
                                {t('naviConnect.request.cancelRequest')}
                            </Button>
                        </div>
                    )}
                </div>
            </>
        );
    } else if (stage.kind === 'done') {
        content = (
            <div className={styles.result}>
                <ReleasePill tone="owned">{t('naviConnect.gapBox.inLibrary')}</ReleasePill>
                <span className={styles.titles}>
                    <span className={styles.title}>
                        {t('naviConnect.gapBox.added', { count: stage.added })}
                    </span>
                    {stage.total > 0 && (
                        <span className={styles.sub}>
                            {t('naviConnect.gapBox.inLibraryCount', {
                                present: stage.present,
                                total: stage.total,
                            })}
                        </span>
                    )}
                </span>
                <Icon icon="check" />
            </div>
        );
    } else if (stage.kind === 'failed' || stage.kind === 'attention') {
        // Why, in lb-bot's words, and one row per way on: chosen from the record's fields
        // (mp3WouldHelp, the stalled or awaiting files), never from its English.
        const ways: { key: string; label: string; run: () => void }[] =
            stage.kind === 'failed'
                ? [
                      ...(downloadsShown
                          ? [
                                {
                                    key: 'search',
                                    label: t('naviConnect.gapBox.searchAgain'),
                                    run: () => void search(),
                                },
                            ]
                          : []),
                      ...(stage.mp3WouldHelp && downloadsShown
                          ? [
                                {
                                    key: 'mp3',
                                    label: t('naviConnect.gapBox.allowMp3'),
                                    run: () => void allowMp3(),
                                },
                            ]
                          : []),
                      { key: 'dismiss', label: t('naviConnect.gapBox.dismiss'), run: dismissFill },
                  ]
                : [
                      ...(openInLbBot
                          ? [
                                {
                                    key: 'lbbot',
                                    label: t('naviConnect.gapBox.openInLbBot'),
                                    run: openInLbBot,
                                },
                            ]
                          : []),
                      { key: 'recheck', label: t('naviConnect.gapBox.recheck'), run: recheck },
                  ];
        content = (
            <div className={styles.recovery}>
                <ReleasePill tone={stage.kind === 'failed' ? 'failed' : 'partly'}>
                    {stage.kind === 'failed'
                        ? t('naviConnect.gapBox.failed')
                        : t('naviConnect.gapBox.needsLbBot')}
                </ReleasePill>
                {/* lb-bot's sentence; with none, the modal's fallback for the kind (minor 12). */}
                {(stage.reason || stage.kind === 'attention') && (
                    <p className={styles.reason}>
                        {stage.reason ||
                            (stage.kind === 'attention' && stage.cause === 'stalledPlacement'
                                ? t('naviConnect.gapBox.stalledPlacement')
                                : t('naviConnect.gapBox.awaitingMatch'))}
                    </p>
                )}
                <div className={styles.ways}>
                    {ways.map((way) => (
                        <button
                            className={styles.way}
                            data-gap-way={way.key}
                            disabled={working && way.key !== 'dismiss'}
                            key={way.key}
                            onClick={way.run}
                            type="button"
                        >
                            {way.label}
                            <Icon icon="arrowRightS" />
                        </button>
                    ))}
                </div>
            </div>
        );
    }

    return (
        <Fold name="gaps" open={stage.kind !== 'absent'}>
            <section
                aria-label={t('naviConnect.gapBox.label')}
                className={styles.wrap}
                data-gap-box=""
                data-gap-stage={stage.kind}
                ref={root}
            >
                {/* The surface is GrowBox's own element, so its edge moves with the rows below.
                    While the box folds away its last view stays drawn in it (B-244). */}
                <GrowBox
                    className={clsx(styles.box, stage.kind === 'failed' && styles.boxFailed)}
                    name="gaps"
                >
                    <HoldWhile hold={stage.kind === 'absent'}>
                        <div data-gap-stage={stage.kind}>
                            {/* Keyed by the stage's family: the line and its list are one, the
                                sources' three states share their header, and a progress tick never
                                fades. */}
                            {/* B-231, PROTOCOL 15.2: a pending match makes Open in lb-bot the
                                prominent way on, and the stages below still find the rest. */}
                            {matchNotice && (
                                <div className={styles.matchPending} data-gap-match-pending="">
                                    <p className={styles.reason}>
                                        {t('naviConnect.gapBox.matchPending')}
                                    </p>
                                    {openInLbBot && (
                                        <Button
                                            onClick={openInLbBot}
                                            size="compact-sm"
                                            variant="default"
                                        >
                                            {t('naviConnect.gapBox.openInLbBot')}
                                        </Button>
                                    )}
                                </div>
                            )}
                            <div className={styles.view} key={family}>
                                {content}
                            </div>
                            {error && (
                                <p className={styles.error} role="alert">
                                    {error}
                                </p>
                            )}
                            {/* Reads gave up over a record already shown: it may be stale, and
                                the box no longer asks on its own. */}
                            {readGaveUp && stage.kind !== 'unreachable' && (
                                <p className={styles.error} data-gap-unreachable="">
                                    {t('naviConnect.gapBox.unreachable')}{' '}
                                    <button
                                        className={styles.link}
                                        onClick={() => void refetch()}
                                        type="button"
                                    >
                                        {t('naviConnect.albumPage.tryAgain')}
                                    </button>
                                </p>
                            )}
                        </div>
                    </HoldWhile>
                </GrowBox>
                {/* Under the box: the fill goes on without the page. */}
                <Fold name="gap-leave" open={stage.kind === 'active'}>
                    <p className={styles.leave}>{t('naviConnect.request.leaveAnyTime')}</p>
                </Fold>
            </section>
        </Fold>
    );
};
