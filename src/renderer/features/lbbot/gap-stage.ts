import type {
    LbBotGap,
    LbBotGapSource,
    LbBotGapTrack,
    LbBotGapTrackState,
} from '/@/shared/types/lbbot-types';

import { initialGapSelection } from './components/source-cards-model.ts';
import { gapAwaitingMatch, gapFailReason } from './hooks/fill-announce-logic.ts';
import { type RequestStep, requestSteps } from './request-steps.ts';

/*
 * navi-connect R11 (B-223): the album page's gaps box, after Worbus for Android's `GapBox` (which retired its
 * `GapFillSheet`, as this retires Worbus for desktop's gap modal). The "N tracks missing" line unfolds to the
 * missing songs; Fill gaps turns the same box into the ranked sources for them; a request turns it
 * into the steps; the finish folds it to a result row and then to nothing. A failure keeps it open,
 * saying why.
 *
 * Which of those it shows is one function of what is known (lb-bot's gap record, this device's
 * ledger row for the group, where the user has the box, a tap in flight), so the box cannot be in
 * two states at once and every precedence is a case in `gap-stage.harness.ts`, ported from Worbus for Android's
 * `GapStageTest`. A transfer in flight is the truth whatever else is set: it may have been started
 * on another client. Pure: Worbus for Android's copy is `GapStage.kt`, written by hand (no shared build).
 */

/** Where the user has put the box. */
export type GapView = 'folded' | 'sources' | 'tracks';

/**
 * Where the box goes when the context menu's "Find N missing tracks" asks for a view: the asked
 * one, except that the box is never taken off the sources (a search the user left running, or the
 * cards being chosen from), review minor 10.
 */
export const gapViewOnAsk = (current: GapView, asked: GapView): GapView =>
    current === 'sources' ? current : asked;

/** How long the result row stays before the box folds away. */
export const GAP_RESULT_HOLD_MS = 6_000;

/** This device's ledger row for the group (`ActiveGap`), as the stage reads it. */
export interface GapFillRow {
    done: number;
    finishedAt: number;
    mp3WouldHelp: boolean;
    outcome: string;
    reason: string;
    settled: boolean;
    /** The ledger row's state: `needs_match` is the pending-match settle (Q-031), not a failure. */
    state?: string;
    total: number;
}

export interface GapInput {
    /** A fetch lb-bot accepted that its status does not show yet. */
    committed: boolean;
    fill: GapFillRow | null;
    /** lb-bot's record for the group; null until the first read lands. */
    gap: GapRecord | null;
    /** B-231: the pending match's downloaded tracks as this page last saw them (`heldForMatchNext`). */
    heldForMatch?: ReadonlySet<string>;
    /** When the box saw a fill land during this visit (`gapFillLanded` turning true), 0 if not. */
    landedAt: number;
    /** The index's count, for the folded line before `gap` lands. */
    mirroredMissing: number;
    now: number;
    /** Reads have failed for longer than `GAP_READ_PATIENCE_MS` and the box stopped asking. */
    readGaveUp: boolean;
    /** A search press whose answer, or the read that shows it running, has not come yet. */
    searchAsked: boolean;
    view: GapView;
}

/** The fields of lb-bot's gap record the stage reads. */
export type GapRecord = Pick<
    LbBotGap,
    | 'failDetail'
    | 'mp3WouldHelp'
    | 'noSourceReason'
    | 'present'
    | 'sources'
    | 'sourcesTotal'
    | 'sourceTask'
    | 'stalledPlacement'
    | 'status'
    | 'total'
    | 'tracks'
>;

/*
 * The members are kept in the order the linter sorts them (by their first field), so each comment
 * sits directly above the member it describes; the order says nothing about precedence, which is
 * `gapStage`'s.
 */
export type GapStage =
    /** A fill finished: its result row, held for `GAP_RESULT_HOLD_MS`, then the box goes. */
    | { added: number; kind: 'done'; present: number; total: number }
    /** Files that arrived and need filing in lb-bot (a stalled placement, or a match pending):
     *  why, in lb-bot's words or the cause's fallback, and its ways on. */
    | { cause: 'awaitingMatch' | 'stalledPlacement'; kind: 'attention'; reason: string }
    /** A transfer in flight, wherever it was started: the steps, the bar, the count, Cancel. */
    | { done: number; failed: number; kind: 'active'; steps: RequestStep[]; wanted: number }
    /** Nothing missing, or the result has been shown: the box folds away. */
    | { kind: 'absent' }
    /** The ranked sources as cards; `preselected` is a card lb-bot marks safe, else none. */
    | { kind: 'choosing'; preselected: null | number; sources: LbBotGapSource[] }
    /** A fill that failed: why, and a way on. */
    | { kind: 'failed'; mp3WouldHelp: boolean; reason: string }
    /** One line: how many are missing, Fill gaps, a chevron. */
    | { kind: 'folded'; missing: number }
    /** lb-bot's record has not come yet and the box is open. */
    | { kind: 'loading' }
    /** A search that ended with nothing; lb-bot's reason when it gave one. */
    | { kind: 'noSources'; mp3WouldHelp: boolean; reason: string }
    /** A search pressed here, or one lb-bot reports running. */
    | { kind: 'searching' }
    /** Unfolded to the missing songs and what they are measured against. */
    | { kind: 'tracks'; missing: LbBotGapTrack[]; total: number }
    /** The box is open, no record ever came, and failed reads ran out of patience. */
    | { kind: 'unreachable' };

/** Track states that mean "nothing further is coming for this slot". B-004: `cancelled` counts
 *  toward completion without counting as a success or a failure. */
const SETTLED_TRACK_STATES: ReadonlySet<LbBotGapTrackState> = new Set<LbBotGapTrackState>([
    'cancelled',
    'done',
    'downloaded',
    'skipped',
]);

/** Tracks that are no longer missing: in the library before, or put there by a fill. */
const HELD_TRACK_STATES: ReadonlySet<LbBotGapTrackState> = new Set<LbBotGapTrackState>([
    'done',
    'present',
]);

const SEARCH_IN_FLIGHT = new Set(['queued', 'running']);

/**
 * The searching stage's progress line: the record's source task's own line, only while that task
 * is still searching ('' for the box's own "Searching"). Right after Search again the record still
 * holds the previous, finished task until a read brings the new one, and its last line ("ranking
 * 3 peer(s)...") flashed as the new search's.
 */
export const searchProgressLine = (task: GapRecord['sourceTask'] | undefined): string =>
    task && SEARCH_IN_FLIGHT.has(task.status) ? task.current : '';

/** A gap track's identity across reads: disc and position (Android's key). */
export const gapTrackKey = (track: Pick<LbBotGapTrack, 'disc' | 'position'>): string =>
    `${track.disc}-${track.position}`;

/**
 * B-231 (fix round 5, Android's `heldForMatch`): what the pending match holds as `downloaded`, as
 * this page last saw it. Outside a fetch it is read off the record (empty when the gap is no
 * pending match); during a fetch it is kept, less any track no longer `downloaded` (the match took
 * it). A page first seeing a fetch already running remembers nothing.
 */
export const heldForMatchNext = (
    prev: ReadonlySet<string>,
    gap: GapRecord | null,
    transferring: boolean,
): ReadonlySet<string> => {
    if (!gap) return prev;
    const downloaded = new Set(
        gap.tracks.filter((track) => track.state === 'downloaded').map(gapTrackKey),
    );
    const next = transferring
        ? [...prev].filter((key) => downloaded.has(key))
        : gapMatchPending(gap)
          ? [...downloaded]
          : [];
    // The same set is the same object, so a caller holding it in state settles.
    return next.length === prev.size && next.every((key) => prev.has(key)) ? prev : new Set(next);
};

/** A transfer in flight for the gap, wherever it was started (the stage's `active`). */
export const gapTransferring = (gap: GapRecord, committed: boolean): boolean =>
    committed ||
    gap.status === 'downloading' ||
    gap.tracks.some((track) => track.state === 'queued' || track.state === 'downloading');

/**
 * Fill progress, counted off the tracks rather than off a task: a gap fill is per-track and has no
 * single transfer to report. Measured against the tracks being filled, not the album's length:
 * progress against 17 when only 12 were queued stalls at 12/17 and reads as a hang.
 */
export const gapProgress = (
    gap: null | Pick<LbBotGap, 'tracks'> | undefined,
    heldForMatch?: ReadonlySet<string>,
) => {
    const notPresent = (gap?.tracks ?? []).filter((track) => track.state !== 'present');
    // B-231 (fix round 5, Android's rule): on a fetch over a pending match, the tracks the match
    // held as downloaded when the fetch started (`heldForMatchNext`) are not the fetch's; only they
    // are left out, so a track this fetch has just downloaded still counts. Never zero: a set that
    // would leave nothing counts what the record says.
    const fetched = heldForMatch?.size
        ? notPresent.filter(
              (track) => !(track.state === 'downloaded' && heldForMatch.has(gapTrackKey(track))),
          )
        : notPresent;
    const wanted = fetched.length > 0 ? fetched : notPresent;
    const done = wanted.filter((track) => SETTLED_TRACK_STATES.has(track.state));
    const failed = wanted.filter((track) => track.state === 'failed');
    return {
        done: done.length,
        failed: failed.length,
        percent: wanted.length ? Math.round((done.length / wanted.length) * 100) : 0,
        wanted: wanted.length,
    };
};

/** The tracks the album still lacks, in tracklist order. */
export const missingTracks = (gap: Pick<LbBotGap, 'tracks'>): LbBotGapTrack[] =>
    gap.tracks.filter((track) => !HELD_TRACK_STATES.has(track.state));

/**
 * B-231, ruling (a): a pending match. lb-bot's `needs_match` bucket for a gap: `picking` with some
 * track `downloaded`, and not a stalled placement. PROTOCOL §15.2: the box makes Open in lb-bot
 * prominent (this predicate says when) and still offers search, fetch and Auto for the tracks
 * `gapTracksToFetch` names. Worbus for Android's `GapStage.kt` keeps the same rule.
 */
export const gapMatchPending = (
    gap: Pick<LbBotGap, 'stalledPlacement' | 'status' | 'tracks'>,
): boolean =>
    !gap.stalledPlacement &&
    gap.status === 'picking' &&
    gap.tracks.some((track) => track.state === 'downloaded');

/**
 * The tracks a search or fetch is for: the missing ones, less those a pending match already holds
 * as `downloaded` (they are on disk, waiting for lb-bot's match; fetching them again would only
 * bring the same files). Otherwise the same list as `missingTracks`.
 */
export const gapTracksToFetch = (
    gap: Pick<LbBotGap, 'stalledPlacement' | 'status' | 'tracks'>,
): LbBotGapTrack[] => {
    const missing = missingTracks(gap);
    return gapMatchPending(gap) ? missing.filter((track) => track.state !== 'downloaded') : missing;
};

/** The tracks the album holds by lb-bot's count: what a re-read tracklist should have at least. */
export const heldTracks = (gap: Pick<LbBotGap, 'tracks'>): number =>
    gap.tracks.filter((track) => HELD_TRACK_STATES.has(track.state)).length;

/**
 * A gap fill's tracks as the request's step names: one downloading is Downloading; queued ones
 * with none moving yet are Queued; all fetched and some not yet filed is Placing in your library.
 */
export const gapStepState = (gap: Pick<LbBotGap, 'tracks'>): string => {
    const wanted = gap.tracks.filter((track) => track.state !== 'present');
    if (wanted.some((track) => track.state === 'downloading')) return 'downloading';
    if (wanted.some((track) => track.state === 'queued' || track.state === 'picked'))
        return 'queued';
    if (wanted.some((track) => track.state === 'downloaded')) return 'placing';
    return 'queued';
};

/**
 * Why a gap fill ended, in lb-bot's own words: its sentence (never the machine `failReason` token,
 * B-044), then the search task's error for a search that itself broke.
 */
export const gapReason = (gap: GapRecord): string =>
    gapFailReason(gap) || gap.sourceTask?.error || '';

/**
 * B-377: lb-bot found sources this record does not list. The ledger's `/lb/fills` summary is the
 * gap view with its source rows dropped (`sourcesTotal` kept), and it is written over the cache as
 * a search ends; the full read with the rows follows. Until then the empty list is not an answer.
 */
export const gapRowsOwed = (gap: Pick<GapRecord, 'sources' | 'sourcesTotal'>): boolean =>
    gap.sources.length === 0 && (gap.sourcesTotal ?? 0) > 0;

export const gapStage = (input: GapInput): GapStage => {
    const { fill, gap } = input;
    if (!gap) {
        if (input.mirroredMissing <= 0) return { kind: 'absent' };
        if (input.view === 'folded') return { kind: 'folded', missing: input.mirroredMissing };
        return input.readGaveUp ? { kind: 'unreachable' } : { kind: 'loading' };
    }
    if (gapTransferring(gap, input.committed)) {
        const progress = gapProgress(gap, input.heldForMatch);
        return {
            done: progress.done,
            failed: progress.failed,
            kind: 'active',
            steps: requestSteps(gapStepState(gap), progress.done, progress.wanted),
            wanted: progress.wanted,
        };
    }
    const missing = missingTracks(gap);
    // The result row holds from the landing the box saw during the visit, else from this device's
    // ledger settle, which lags the landing by a poll (until B-233 by a 90 s grace from its start:
    // a short fill's record went complete well before it, and holding from the settle folded the
    // box away and brought the row back a minute later; walk finding, R11 Task 4).
    const settled = fill?.settled && fill.outcome === 'done' ? fill : null;
    const heldFrom = input.landedAt > 0 ? input.landedAt : (settled?.finishedAt ?? 0);
    if (heldFrom > 0 && gapFillLanded(gap, fill)) {
        if (input.now - heldFrom < GAP_RESULT_HOLD_MS) {
            const added = gap.tracks.filter((track) => track.state === 'done').length;
            return {
                added: settled && settled.done > 0 ? settled.done : added || (fill?.total ?? 0),
                kind: 'done',
                present: gap.present,
                total: gap.total,
            };
        }
        if (missing.length === 0) return { kind: 'absent' };
    }
    if (gap.status === 'complete' || (missing.length === 0 && gap.total > 0)) {
        return { kind: 'absent' };
    }
    const searching = input.searchAsked || SEARCH_IN_FLIGHT.has(gap.sourceTask?.status ?? '');
    // B-231, ruling (a): a pending match is lb-bot's alone only when nothing is left to fetch;
    // otherwise the stages below run over the tracks still to fetch (the box adds the notice).
    const toFetch = gapTracksToFetch(gap);
    const matchPending = gapMatchPending(gap);
    if (gap.stalledPlacement || (!searching && gapAwaitingMatch(gap) && toFetch.length === 0)) {
        return {
            cause: gap.stalledPlacement ? 'stalledPlacement' : 'awaitingMatch',
            kind: 'attention',
            reason: gapReason(gap),
        };
    }
    // A fill that failed keeps the box open, saying why, until it is dismissed or tried again,
    // also over the sources it was requested from (the summary drops the source rows, and the
    // sources view with none left and nothing searching read as searching for good). A new search
    // press is the way out.
    // The ledger settles a pending match as failed · needs_match (Q-031): that row is the match
    // pending, not a fill that failed, and does not take the box off the tracks. Any other failed
    // row is a failure, pending match or not (fix round 3, the ruling for both clients).
    const matchSettle = matchPending && fill?.state === 'needs_match';
    if (fill?.settled && fill.outcome === 'failed' && !input.searchAsked && !matchSettle) {
        return {
            kind: 'failed',
            mp3WouldHelp: gap.mp3WouldHelp || fill.mp3WouldHelp,
            reason: gapReason(gap) || fill.reason,
        };
    }
    if (input.view === 'sources') {
        if (searching) return { kind: 'searching' };
        // The rows of a finished search still on their way: still the search's, not "none";
        // when every read since has failed, the same answer as any failed read.
        if (gapRowsOwed(gap))
            return input.readGaveUp ? { kind: 'unreachable' } : { kind: 'searching' };
        if (gap.sources.length > 0) {
            return {
                kind: 'choosing',
                preselected: initialGapSelection(gap.sources),
                sources: gap.sources,
            };
        }
        if (gap.noSourceReason || gap.sourceTask) {
            return {
                kind: 'noSources',
                mp3WouldHelp: gap.mp3WouldHelp,
                reason: gap.noSourceReason,
            };
        }
        // Nothing asked and nothing found: a view restored on a return (nothing fires a search
        // then, review minor 7) shows the tracks, where Fill gaps asks. Fill gaps itself marks
        // its search as asked, so a press never lands here.
    }
    if (input.view !== 'folded') return { kind: 'tracks', missing: toFetch, total: gap.total };
    return {
        kind: 'folded',
        missing: toFetch.length > 0 ? toFetch.length : input.mirroredMissing,
    };
};

/**
 * How long failed reads of the gap are retried before the box stops asking: PROTOCOL 15.2's
 * bounded patience on the clock (two minutes continuous). A failed read is not an answer, so the
 * box keeps what it had; after this it says lb-bot cannot be reached and asks again on a press,
 * or when the hub's `fill` frame re-reads the group.
 */
export const GAP_READ_PATIENCE_MS = 120_000;

/** Reads have failed since `failingSince` (0: the last read answered) for the whole patience. */
export const gapReadGaveUp = (failingSince: number, now: number): boolean =>
    failingSince > 0 && now - failingSince >= GAP_READ_PATIENCE_MS;

/**
 * Whether the album page's box reads the gap again (review minor 6). It reads once as the page
 * opens; then only while something moves (a search or fetch pressed here and not yet showing, a
 * transfer or search lb-bot reports, this device's ledger row running) or an open box still has
 * no answer. The cards on screen with nothing searching are not something moving: the hub's
 * fast pool has two slots. Failed reads give up after the patience above, whatever else is set.
 */
export const gapPolls = (input: {
    /** A record has landed. */
    answered: boolean;
    /** `gapIsBusy` of the record: lb-bot reports a search or a transfer. */
    busy: boolean;
    committed: boolean;
    failingSince: number;
    /** This device's ledger row for the group is not settled. */
    fillRunning: boolean;
    now: number;
    searchAsked: boolean;
    view: GapView;
}): boolean => {
    if (gapReadGaveUp(input.failingSince, input.now)) return false;
    if (input.searchAsked || input.committed || input.fillRunning || input.busy) return true;
    return !input.answered && input.view !== 'folded';
};

/** Which stages share a header, so a change between them does not cross-fade the whole box. */
export const gapStageFamily = (stage: GapStage): string =>
    stage.kind === 'folded' || stage.kind === 'tracks'
        ? 'fold'
        : stage.kind === 'searching' || stage.kind === 'choosing' || stage.kind === 'noSources'
          ? 'sources'
          : stage.kind;

/**
 * A fill has put its tracks in the library: this device's ledger row settled done, or lb-bot counts
 * the album whole (a fill started on another client has no ledger row here). The album page re-reads
 * its tracklist when this turns true during the visit.
 */
export const gapFillLanded = (
    gap: Pick<LbBotGap, 'status' | 'total' | 'tracks'>,
    fill: GapFillRow | null,
): boolean =>
    (!!fill && fill.settled && fill.outcome === 'done') ||
    gap.status === 'complete' ||
    (gap.total > 0 && missingTracks(gap).length === 0);

/** The review group an album page's box is for, and the index's count of what it misses. */
export interface GapBoxGroup {
    albumId: string;
    groupId: string;
    mirroredMissing: number;
}

/**
 * Which group the album page's box is for. Once shown for an album it stays for the visit (review
 * I3): lb-bot flips the group's index row to `present` as a Fill-gaps completion lands, so the
 * mirror stops naming the album incomplete exactly when the box should show its result row. The
 * box then has nothing mirrored to count and `gapStage` decides when it goes. Another album on
 * the same page inherits nothing.
 */
export const gapBoxGroup = (
    kept: GapBoxGroup | null,
    albumId: string,
    release: null | { groupId: string; missing: number },
): GapBoxGroup | null => {
    if (release?.groupId) {
        return { albumId, groupId: release.groupId, mirroredMissing: release.missing };
    }
    if (kept && kept.albumId === albumId) return { ...kept, mirroredMissing: 0 };
    return null;
};
