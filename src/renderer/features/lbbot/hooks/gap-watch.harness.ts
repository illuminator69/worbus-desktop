import type { LbBotGap, LbBotGapTask } from '/@/shared/types/lbbot-types';

import assert from 'node:assert/strict';
import test from 'node:test';

import { gapReadCounts, gapWatchVerdict } from './gap-watch.ts';

/**
 * B-233:  node --test src/renderer/features/lbbot/hooks/gap-watch.harness.ts
 *
 * The album page's gaps box shows "Couldn't get these tracks" when the ledger's gap watch settles
 * `failed`. A fill lb-bot failed 6 s after Request showed it 96 s after Request: the watch refused
 * to settle for a flat 90 s after it started, because "the POST returns before lb-bot's worker has
 * written anything". That is not what lb-bot does (phase A sources lane, RESULTS § B-233):
 *   - `fetch` is synchronous: its answer's `gap` is already `downloading` (or terminal);
 *   - `auto`/`search` answer `task_id`, and `/lb/gap`'s `sourceTask` is that task, `running`,
 *     from the moment the POST returns;
 *   - the only stale read is one SENT before the action's answer arrived.
 * So a watch settles on the first read that counts and is terminal, and a read counts when it was
 * sent after the answer arrived (or names the watch's own task).
 *
 * Replays the watch's rules (gap-watch.ts) on a timeline in ms: the action's answer arrives and
 * the watch starts at 1000. Not reached: the store, the 5 s poll, the hub and lb-bot.
 */

const TIMEOUT = 20 * 60 * 1000;

const task = (patch: Partial<LbBotGapTask> = {}): LbBotGapTask => ({
    current: '',
    error: '',
    id: 'k1',
    label: '',
    status: 'complete',
    summary: '',
    ...patch,
});

const gap = (patch: Partial<LbBotGap> = {}): LbBotGap =>
    ({
        sources: [],
        sourcesFoundAt: 100,
        sourceTask: null,
        status: 'ready',
        tracks: [],
        ...patch,
    }) as LbBotGap;

const failed = gap({
    sourceTask: task({ id: 'old' }),
    status: 'failed',
    tracks: [{ state: 'failed' } as LbBotGap['tracks'][number]],
});

test('aFillLbBotFailedSettlesOnTheFirstReadAfterTheAnswer', () => {
    const watch = { startedAt: 1000 };
    assert.equal(gapReadCounts(watch, failed, 6000), true);
    assert.equal(
        gapWatchVerdict(watch, failed, { now: 7000, timeoutMs: TIMEOUT }),
        'settle',
        'the failed card waited for the 90 s grace',
    );
});

test('aReadSentBeforeTheAnswerArrivedIsNotTheFills', () => {
    // A 5 s poll sent before the tap, answered after it, still shows the previous attempt's
    // `failed`. Told apart by request order, not by a clock.
    const watch = { startedAt: 1000 };
    assert.equal(gapReadCounts(watch, failed, 900), false, 'a stale read settled the new fill');
});

test('anAutoRunWaitsWhileItsTaskRunsAndSettlesWhenItEnds', () => {
    const watch = { startedAt: 1000, taskId: 'k1' };
    const running = gap({ sourceTask: task({ status: 'running' }), status: 'picking' });
    assert.equal(gapReadCounts(watch, running, 3000), true);
    assert.equal(gapWatchVerdict(watch, running, { now: 4000, timeoutMs: TIMEOUT }), 'wait');
    const ended = gap({
        sourceTask: task({ error: 'No source found on slskd', status: 'error' }),
        status: 'failed',
    });
    assert.equal(gapReadCounts(watch, ended, 20_000), true);
    assert.equal(gapWatchVerdict(watch, ended, { now: 21_000, timeoutMs: TIMEOUT }), 'settle');
});

test('aReadNamingTheWatchsOwnTaskCountsWhenEverItWasSent', () => {
    // lb-bot registers the task before it answers, so a read that names it cannot predate it.
    const watch = { startedAt: 1000, taskId: 'k1' };
    const running = gap({ sourceTask: task({ status: 'running' }), status: 'picking' });
    assert.equal(gapReadCounts(watch, running, 900), true);
    assert.equal(gapReadCounts(watch, failed, 900), false, 'another task, sent before: stale');
});

test('aSearchThatFoundSourcesSettlesAsYourMoveAtOnce', () => {
    const watch = { startedAt: 1000, taskId: 'k1' };
    const picking = gap({ sourcesTotal: 4, sourceTask: task(), status: 'picking' });
    assert.equal(gapWatchVerdict(watch, picking, { now: 9000, timeoutMs: TIMEOUT }), 'settle');
});

test('aFetchAnswerSeedsTheWatchAsBusy', () => {
    // The fetch answer's `gap` (read under lb-bot's lock after the enqueue) is the watch's first read.
    const watch = { startedAt: 1000 };
    const seed = gap({ sourceTask: task({ id: 'old' }), status: 'downloading' });
    assert.equal(gapReadCounts(watch, seed, 1000), true);
    assert.equal(gapWatchVerdict(watch, seed, { now: 1000, timeoutMs: TIMEOUT }), 'wait');
});

test('aWatchWithNoProgressStillGivesUpAfterTheTimeout', () => {
    const watch = { lastProgressAt: 1000, startedAt: 1000 };
    const idle = gap({ status: 'ready' });
    assert.equal(
        gapWatchVerdict(watch, idle, { now: 1000 + TIMEOUT + 1, timeoutMs: TIMEOUT }),
        'gaveUp',
    );
});

test('aReadSentBeforeACancelsAnswerDoesNotReopenTheWatch', () => {
    // VM walk (B-233): Cancel request settles the watch `cancelled`, and a settled watch re-opens on
    // a busy read (a fill started from another device). A read sent before the cancel's answer
    // arrived still shows the transfer the user just cancelled; it re-opened the watch as running.
    const watch = { finishedAt: 5000, settled: true, startedAt: 1000 };
    const downloading = gap({ status: 'downloading' });
    assert.equal(gapReadCounts(watch, downloading, 4900), false, 'a stale read undid the cancel');
    assert.equal(gapReadCounts(watch, downloading, 5100), true, 'restarted elsewhere: re-opens');
});
