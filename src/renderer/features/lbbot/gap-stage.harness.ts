import type { LbBotGapSource, LbBotGapTask, LbBotGapTrackState } from '/@/shared/types/lbbot-types';

import assert from 'node:assert/strict';
import test from 'node:test';

import {
    GAP_READ_PATIENCE_MS,
    GAP_RESULT_HOLD_MS,
    gapBoxGroup,
    gapFillLanded,
    type GapFillRow,
    type GapInput,
    gapPolls,
    gapReadGaveUp,
    type GapRecord,
    gapRowsOwed,
    gapStage,
    gapViewOnAsk,
    heldTracks,
    searchProgressLine,
} from './gap-stage.ts';
import { currentStep } from './request-steps.ts';

/**
 * R11 (B-223): which state the album page's gaps box is in, ported case for case from Worbus for Android's
 * `GapStageTest`. A transfer in flight beats everything; a finished fill shows its result for a few
 * seconds and then the box goes; files waiting on lb-bot's workspace are their own state; the
 * sources view searches, chooses or says nothing was found; a failed fill keeps the box open;
 * otherwise it is the user's fold.
 *
 *     node --test src/renderer/features/lbbot/gap-stage.harness.ts
 */

const track = (position: number, state: LbBotGapTrackState, disc = 1) => ({
    disc,
    downloadError: '',
    position,
    state,
    title: `T${position}`,
});

const task = (status: string): LbBotGapTask => ({
    current: '',
    error: '',
    id: 't',
    label: '',
    status,
    summary: '',
});

const gap = (over: Partial<GapRecord> = {}): GapRecord => {
    const tracks = over.tracks ?? [
        track(1, 'present'),
        track(2, 'present'),
        track(3, 'missing'),
        track(4, 'missing'),
    ];
    return {
        failDetail: '',
        mp3WouldHelp: false,
        noSourceReason: '',
        sources: [],
        sourcesTotal: 0,
        sourceTask: null,
        stalledPlacement: false,
        status: 'ready',
        ...over,
        present: tracks.filter((t) => t.state === 'present').length,
        total: tracks.length,
        tracks,
    };
};

const fill = (outcome: string, over: Partial<GapFillRow> = {}): GapFillRow => ({
    done: 2,
    finishedAt: 0,
    mp3WouldHelp: false,
    outcome,
    reason: "lb-bot's own words",
    settled: true,
    total: 2,
    ...over,
});

const input = (over: Partial<GapInput> = {}): GapInput => ({
    committed: false,
    fill: null,
    gap: gap(),
    landedAt: 0,
    mirroredMissing: 2,
    now: 100_000,
    readGaveUp: false,
    searchAsked: false,
    view: 'folded',
    ...over,
});

const source = (over: Partial<LbBotGapSource> = {}): LbBotGapSource => ({
    albumMatch: 1,
    albumMatchOk: true,
    artistVerified: true,
    bitrate: '',
    coverage: '',
    coverageDetail: { haveTracks: 2, totalTracks: 2, unmatched: [] },
    // lb-bot's gap sources (`_source_view`) carry no coverageFull, so it always parses false here.
    coverageFull: false,
    fileCount: 2,
    files: [],
    filesTruncated: false,
    flags: [],
    folder: 'f',
    format: 'FLAC',
    freeSlot: true,
    id: 0,
    peer: 'p',
    queueLength: 0,
    rank: 1,
    recommendation: '',
    recommended: true,
    score: 1,
    size: '',
    speedMbps: 0,
    ...over,
});

const good = source();
const unverified = source({ artistVerified: false, id: 1, peer: 'q' });

test('beforeLbBotAnswersTheMirrorCountFoldsAndAnOpenBoxWaits', () => {
    assert.deepEqual(gapStage(input({ gap: null, mirroredMissing: 3 })), {
        kind: 'folded',
        missing: 3,
    });
    assert.deepEqual(gapStage(input({ gap: null, mirroredMissing: 3, view: 'tracks' })), {
        kind: 'loading',
    });
    assert.deepEqual(gapStage(input({ gap: null, mirroredMissing: 0 })), { kind: 'absent' });
});

test('foldedCountsTheTracksStillMissing', () => {
    assert.deepEqual(gapStage(input()), { kind: 'folded', missing: 2 });
});

test('unfoldedListsOnlyTheMissingTracksAgainstTheReleaseLength', () => {
    const stage = gapStage(input({ view: 'tracks' }));
    assert.equal(stage.kind, 'tracks');
    if (stage.kind !== 'tracks') return;
    assert.deepEqual(
        stage.missing.map((t) => t.position),
        [3, 4],
    );
    assert.equal(stage.total, 4);
});

test('aTransferInFlightBeatsTheFoldAndTheSources', () => {
    // Review Focus 1: a fill started on another client shows its steps whatever the box was showing.
    const moving = gap({
        tracks: [track(1, 'present'), track(2, 'done'), track(3, 'downloading')],
    });
    for (const view of ['folded', 'tracks', 'sources'] as const) {
        const stage = gapStage(input({ gap: moving, view }));
        assert.equal(stage.kind, 'active');
        if (stage.kind !== 'active') return;
        assert.equal(stage.done, 1);
        assert.equal(stage.wanted, 2);
    }
    // Over a failed ledger row too.
    assert.equal(gapStage(input({ fill: fill('failed'), gap: moving })).kind, 'active');
});

test('aFetchLbBotAcceptedIsActiveBeforeItsStatusMoves', () => {
    assert.equal(gapStage(input({ committed: true, view: 'sources' })).kind, 'active');
});

test('theStepsFollowTheTracks', () => {
    const now = (...states: LbBotGapTrackState[]) => {
        const stage = gapStage(
            input({
                gap: gap({
                    status: 'downloading',
                    tracks: states.map((state, i) => track(i + 1, state)),
                }),
            }),
        );
        assert.equal(stage.kind, 'active');
        return stage.kind === 'active' ? currentStep(stage.steps) : -1;
    };
    assert.equal(now('present', 'queued', 'queued'), 1);
    assert.equal(now('present', 'downloaded', 'downloading'), 2);
    assert.equal(now('present', 'downloaded', 'downloaded'), 3);
});

test('aFinishedFillShowsItsResultForAFewSecondsThenTheBoxGoes', () => {
    const filled = gap({
        status: 'complete',
        tracks: [track(1, 'present'), track(2, 'done'), track(3, 'done')],
    });
    const done = fill('done', { finishedAt: 100_000 });
    assert.deepEqual(gapStage(input({ fill: done, gap: filled, now: 101_000 })), {
        added: 2,
        kind: 'done',
        present: 1,
        total: 3,
    });
    assert.deepEqual(
        gapStage(input({ fill: done, gap: filled, now: 100_000 + GAP_RESULT_HOLD_MS })),
        { kind: 'absent' },
    );
});

test('aCompleteAlbumHasNoBox', () => {
    const whole = gap({ status: 'complete', tracks: [track(1, 'present'), track(2, 'present')] });
    assert.deepEqual(gapStage(input({ gap: whole, view: 'tracks' })), { kind: 'absent' });
});

test('filesWaitingOnLbBotsWorkspaceAreAttentionWhateverTheView', () => {
    const stalled = gap({
        failDetail: 'Reconcile in lb-bot',
        stalledPlacement: true,
        status: 'failed',
    });
    assert.deepEqual(gapStage(input({ gap: stalled, view: 'sources' })), {
        cause: 'stalledPlacement',
        kind: 'attention',
        reason: 'Reconcile in lb-bot',
    });
    // B-231: a pending match is attention only with nothing left to fetch (cases below).
    const awaiting = gap({
        status: 'picking',
        tracks: [track(1, 'present'), track(2, 'downloaded')],
    });
    // Review minor 12: with no sentence from lb-bot the stage says which kind, so the box can say
    // why in its own fallback words instead of showing a pill alone.
    assert.deepEqual(gapStage(input({ gap: awaiting })), {
        cause: 'awaitingMatch',
        kind: 'attention',
        reason: '',
    });
});

test('theSourcesViewSearchesThenChoosesPreselectingOnlyASafeSource', () => {
    assert.deepEqual(gapStage(input({ searchAsked: true, view: 'sources' })), {
        kind: 'searching',
    });
    assert.deepEqual(
        gapStage(input({ gap: gap({ sourceTask: task('running') }), view: 'sources' })),
        { kind: 'searching' },
    );
    assert.deepEqual(
        gapStage(input({ gap: gap({ sources: [good], status: 'picking' }), view: 'sources' })),
        { kind: 'choosing', preselected: 0, sources: [good] },
    );
    // Review Focus 2: no safe source, no card chosen, so no Request button until a tap.
    assert.deepEqual(
        gapStage(
            input({ gap: gap({ sources: [unverified], status: 'picking' }), view: 'sources' }),
        ),
        { kind: 'choosing', preselected: null, sources: [unverified] },
    );
});

test('aSearchTapInFlightSearchesEvenOverOldSources', () => {
    assert.deepEqual(
        gapStage(
            input({
                gap: gap({ sources: [good], status: 'picking' }),
                searchAsked: true,
                view: 'sources',
            }),
        ),
        { kind: 'searching' },
    );
});

test('aSearchThatEndedWithNothingSaysSoWithLbBotsReason', () => {
    const none = gap({
        mp3WouldHelp: true,
        noSourceReason: 'No FLAC',
        sourceTask: task('complete'),
        status: 'picking',
    });
    assert.deepEqual(gapStage(input({ gap: none, view: 'sources' })), {
        kind: 'noSources',
        mp3WouldHelp: true,
        reason: 'No FLAC',
    });
});

test('B-377: a finished search whose rows have not arrived waits for them, never "No sources"', () => {
    // The ledger's /lb/fills summary is the gap view without its source rows (sourcesTotal kept);
    // applyGapSummary writes it over the cache as the search ends, and the full read with the
    // rows lands ~100 ms later. Read as an answer, that frame said "No sources found".
    const owed = gap({
        sourcesTotal: 3,
        sourceTask: task('complete'),
        status: 'picking',
    } as Partial<GapRecord>);
    assert.deepEqual(gapStage(input({ gap: owed, view: 'sources' })), { kind: 'searching' });
});

test('B-377: rows are owed only while lb-bot counts sources the record does not list', () => {
    assert.equal(gapRowsOwed({ sources: [], sourcesTotal: 3 }), true);
    assert.equal(gapRowsOwed({ sources: [], sourcesTotal: 0 }), false, 'nothing found: an answer');
    const done = gap({ sourceTask: task('complete'), status: 'picking' });
    assert.equal(gapRowsOwed(done), false);
    // Nothing found really says so.
    assert.equal(gapStage(input({ gap: done, view: 'sources' })).kind, 'noSources');
});

test('B-377: rows still owed when the reads give up end in "cannot be reached", not searching', () => {
    const owed = gap({
        sourcesTotal: 3,
        sourceTask: task('complete'),
        status: 'picking',
    } as Partial<GapRecord>);
    assert.deepEqual(gapStage(input({ gap: owed, readGaveUp: true, view: 'sources' })), {
        kind: 'unreachable',
    });
});

test('aFailedFillKeepsTheBoxOpenUntilTheSourcesAreAskedAgain', () => {
    // Review Focus 3: the box stays open saying why, in lb-bot's words.
    const failed = gap({ failDetail: 'The download itself failed', status: 'failed' });
    const entry = fill('failed');
    assert.deepEqual(gapStage(input({ fill: entry, gap: failed })), {
        kind: 'failed',
        mp3WouldHelp: false,
        reason: 'The download itself failed',
    });
    assert.deepEqual(
        gapStage(input({ fill: entry, gap: failed, searchAsked: true, view: 'sources' })),
        { kind: 'searching' },
    );
});

test('aFailedFillShowsOverTheSourcesItWasRequestedFrom', () => {
    const failed = gap({ failDetail: 'The peer went offline', status: 'failed' });
    assert.deepEqual(gapStage(input({ fill: fill('failed'), gap: failed, view: 'sources' })), {
        kind: 'failed',
        mp3WouldHelp: false,
        reason: 'The peer went offline',
    });
});

test('a failed fill with no sentence from lb-bot falls back to the ledger row, and offers MP3 from either', () => {
    const failed = gap({ status: 'failed' });
    assert.deepEqual(
        gapStage(input({ fill: fill('failed', { mp3WouldHelp: true }), gap: failed })),
        { kind: 'failed', mp3WouldHelp: true, reason: "lb-bot's own words" },
    );
});

test('aCancelledFillIsJustTheFold', () => {
    assert.deepEqual(gapStage(input({ fill: fill('cancelled') })), { kind: 'folded', missing: 2 });
});

test('aFillHasLandedOnceItsRowSettlesDoneOrTheAlbumIsWhole', () => {
    const moving = gap({
        status: 'downloading',
        tracks: [track(1, 'present'), track(2, 'downloading')],
    });
    assert.equal(gapFillLanded(moving, fill('done', { settled: false })), false);
    assert.equal(gapFillLanded(gap(), fill('done')), true);
    // Started on another client: no ledger row here, and lb-bot's record says it all.
    assert.equal(gapFillLanded(gap({ status: 'complete' }), null), true);
    assert.equal(
        gapFillLanded(gap({ tracks: [track(1, 'present'), track(2, 'done')] }), null),
        true,
    );
    assert.equal(gapFillLanded(gap(), fill('failed')), false);
});

test('heldTracksCountWhatTheLibraryHasBeforeAndAfterTheFill', () => {
    assert.equal(
        heldTracks(
            gap({
                tracks: [
                    track(1, 'present'),
                    track(2, 'done'),
                    track(3, 'done'),
                    track(4, 'failed'),
                ],
            }),
        ),
        3,
    );
});

test('the box stays for the visit once shown, when the index flips the album to present as the fill lands', () => {
    // Review I3: lb-bot marks the group present on a Fill-gaps completion and the mirror follows,
    // so the page stops naming the album incomplete at the moment the box should show its result.
    const shown = gapBoxGroup(null, 'al-1', { groupId: 'g-1', missing: 2 });
    assert.deepEqual(shown, { albumId: 'al-1', groupId: 'g-1', mirroredMissing: 2 });
    assert.deepEqual(gapBoxGroup(shown, 'al-1', null), {
        albumId: 'al-1',
        groupId: 'g-1',
        mirroredMissing: 0,
    });
    // Another album on the same page component inherits nothing.
    assert.equal(gapBoxGroup(shown, 'al-2', null), null);
    // Never shown: nothing.
    assert.equal(gapBoxGroup(null, 'al-1', null), null);
    // And the stage still holds the result row once the count goes to nothing.
    const filled = gap({ status: 'complete', tracks: [track(1, 'present'), track(2, 'done')] });
    assert.equal(
        gapStage(
            input({
                fill: fill('done', { finishedAt: 100_000 }),
                gap: filled,
                mirroredMissing: 0,
                now: 101_000,
            }),
        ).kind,
        'done',
    );
});

test('a sources view restored with nothing asked and nothing found falls back to the tracks', () => {
    // Review minor 7: coming back to a box left on the sources, when lb-bot holds no sources and
    // no search, used to say "Searching" for good (nothing fires a search on a return).
    const stage = gapStage(input({ view: 'sources' }));
    assert.equal(stage.kind, 'tracks');
    if (stage.kind !== 'tracks') return;
    assert.deepEqual(
        stage.missing.map((t) => t.position),
        [3, 4],
    );
});

const polls = (over: Partial<Parameters<typeof gapPolls>[0]> = {}) =>
    gapPolls({
        answered: true,
        busy: false,
        committed: false,
        failingSince: 0,
        fillRunning: false,
        now: 1_000_000,
        searchAsked: false,
        view: 'folded',
        ...over,
    });

test('the box polls only while something moves or an open box has no answer yet', () => {
    // Review minor 6: the cards on screen with nothing searching are not something moving.
    assert.equal(polls(), false);
    assert.equal(polls({ view: 'sources' }), false);
    assert.equal(polls({ view: 'tracks' }), false);
    assert.equal(polls({ busy: true, view: 'sources' }), true);
    assert.equal(polls({ searchAsked: true }), true);
    assert.equal(polls({ committed: true }), true);
    assert.equal(polls({ fillRunning: true }), true);
    // An open box still waiting on its first answer keeps asking; a folded one reads once.
    assert.equal(polls({ answered: false, view: 'sources' }), true);
    assert.equal(polls({ answered: false, view: 'tracks' }), true);
    assert.equal(polls({ answered: false }), false);
});

test('failed reads are retried for two minutes on the clock, then the box stops asking', () => {
    // PROTOCOL 15.2: a failed poll is not an answer, and patience is bounded on the clock.
    const since = 1_000_000 - GAP_READ_PATIENCE_MS;
    assert.equal(polls({ answered: false, failingSince: since + 1, view: 'tracks' }), true);
    assert.equal(polls({ answered: false, failingSince: since, view: 'tracks' }), false);
    assert.equal(polls({ failingSince: since, fillRunning: true }), false);
    assert.equal(gapReadGaveUp(0, 5_000_000), false);
    assert.equal(gapReadGaveUp(1_000, 1_000 + GAP_READ_PATIENCE_MS - 1), false);
    assert.equal(gapReadGaveUp(1_000, 1_000 + GAP_READ_PATIENCE_MS), true);
});

test('an open box whose reads gave up says lb-bot cannot be reached, instead of loading for good', () => {
    assert.deepEqual(
        gapStage(input({ gap: null, mirroredMissing: 3, readGaveUp: true, view: 'tracks' })),
        { kind: 'unreachable' },
    );
    // Folded, the mirror's count still stands.
    assert.deepEqual(gapStage(input({ gap: null, mirroredMissing: 3, readGaveUp: true })), {
        kind: 'folded',
        missing: 3,
    });
});

test("the menu's ask opens the tracks but never takes the box off the sources", () => {
    // Review minor 10: a search the user left running, or cards being chosen, stay put.
    assert.equal(gapViewOnAsk('folded', 'tracks'), 'tracks');
    assert.equal(gapViewOnAsk('tracks', 'tracks'), 'tracks');
    assert.equal(gapViewOnAsk('sources', 'tracks'), 'sources');
});

test('the result row holds from the landing the box saw, not from the ledger settle that lags it', () => {
    // Walk finding (R11 Task 4): lb-bot's record went complete 13 s after Request, the box folded
    // away, and the ledger row (90 s settle grace) settled done 80 s later, so the result row came
    // back for 6 s on a box that had gone. The hold now starts when the box saw the fill land.
    const filled = gap({
        status: 'complete',
        tracks: [track(1, 'present'), track(2, 'done'), track(3, 'done')],
    });
    const running = fill('running', { settled: false, total: 2 });
    assert.deepEqual(
        gapStage(input({ fill: running, gap: filled, landedAt: 100_000, now: 101_000 })),
        // `present` is lb-bot's own count, which this fixture derives from the `present` rows.
        { added: 2, kind: 'done', present: 1, total: 3 },
    );
    assert.equal(
        gapStage(
            input({
                fill: running,
                gap: filled,
                landedAt: 100_000,
                now: 100_000 + GAP_RESULT_HOLD_MS,
            }),
        ).kind,
        'absent',
    );
    // The ledger settling long after does not bring the row back.
    const late = fill('done', { finishedAt: 180_000 });
    assert.equal(
        gapStage(input({ fill: late, gap: filled, landedAt: 100_000, now: 181_000 })).kind,
        'absent',
    );
    // A fill started on another client (no ledger row here) shows its result too.
    assert.equal(
        gapStage(input({ fill: null, gap: filled, landedAt: 100_000, now: 101_000 })).kind,
        'done',
    );
});

test('searchAgainNeverShowsTheFinishedSearchsLine', () => {
    // VM walk: the first frame after Search again (~100 ms, before the new task reached the cache)
    // showed the previous, finished task's "ranking 3 peer(s)...". Only a task still searching
    // speaks; until the new one arrives the box says its own "Searching".
    const task = (status: string, current: string) => ({ current, status }) as LbBotGapTask;
    assert.equal(
        searchProgressLine(task('complete', 'ranking 3 peer(s)...')),
        '',
        'old line shown',
    );
    assert.equal(searchProgressLine(task('error', 'ranking 3 peer(s)...')), '');
    assert.equal(
        searchProgressLine(task('running', '0 peer(s), 0 file(s)')),
        '0 peer(s), 0 file(s)',
    );
    assert.equal(searchProgressLine(null), '');
});

/*
 * B-231, ruling (a) (2026-11-10; built here in the fix round 2026-11-12): PROTOCOL §15.2 is right.
 * A pending match (`picking`, some track `downloaded`, no stalled placement) makes Open in lb-bot
 * prominent but, unlike a stalled placement, still offers search, fetch and Auto for the tracks
 * that are neither in the library nor `downloaded`. With none of those left, it is lb-bot's to sort
 * out (attention), as before. Worbus for Android's `GapStageTest` carries the same vectors.
 */
test('aPendingMatchStillOffersSearchFetchAndAutoForTheTracksNotDownloaded', async () => {
    const tracks = [track(1, 'present'), track(2, 'downloaded'), track(3, 'missing')];
    const awaiting = gap({ status: 'picking', tracks });
    assert.deepEqual(
        gapStage(input({ gap: awaiting })),
        { kind: 'folded', missing: 1 },
        'a pending match is attention: no search or fetch for the track still missing',
    );
    assert.deepEqual(gapStage(input({ gap: awaiting, view: 'tracks' })), {
        kind: 'tracks',
        missing: [track(3, 'missing')],
        total: 3,
    });
    assert.deepEqual(gapStage(input({ gap: awaiting, searchAsked: true, view: 'sources' })), {
        kind: 'searching',
    });
    assert.deepEqual(
        gapStage(
            input({ gap: gap({ sources: [good], status: 'picking', tracks }), view: 'sources' }),
        ),
        { kind: 'choosing', preselected: 0, sources: [good] },
    );
    // The ledger settles a pending match as failed · needs_match (Q-031): that is the match
    // pending, not a fill that failed, so it does not take the box off the tracks.
    assert.deepEqual(
        gapStage(
            input({
                fill: fill('failed', { state: 'needs_match' }),
                gap: awaiting,
                view: 'tracks',
            }),
        ).kind,
        'tracks',
    );
    // Amendment (fix round 3, 2026-11-12, the coordinator's ruling for both clients): a PLAIN
    // failed fill over a pending match is a failure, and shows Failed, as on Android.
    assert.equal(
        gapStage(
            input({
                fill: fill('failed', { state: 'failed' }),
                gap: awaiting,
                view: 'tracks',
            }),
        ).kind,
        'failed',
        'a plain failed fill on a pending match shows the tracks; Android shows Failed',
    );
    // The box shows the prominent Open in lb-bot over those stages: one predicate says when.
    const mod = (await import('./gap-stage.ts')) as Record<string, unknown>;
    assert.equal(typeof mod.gapMatchPending, 'function', 'no notice predicate for the box');
    const pending = mod.gapMatchPending as (g: GapRecord) => boolean;
    assert.equal(pending(awaiting), true);
    assert.equal(pending(gap({ status: 'picking' })), false, 'nothing downloaded: a plain pick');
    assert.equal(pending(gap({ stalledPlacement: true, status: 'failed', tracks })), false);
});

test('aPendingMatchWithNothingLeftToFetchIsLbBotsToSortOut', () => {
    const allHere = gap({
        status: 'picking',
        tracks: [track(1, 'present'), track(2, 'downloaded')],
    });
    for (const view of ['folded', 'tracks', 'sources'] as const) {
        assert.deepEqual(gapStage(input({ gap: allHere, view })), {
            cause: 'awaitingMatch',
            kind: 'attention',
            reason: '',
        });
    }
});
