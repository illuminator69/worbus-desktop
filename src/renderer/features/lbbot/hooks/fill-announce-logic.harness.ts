import type { LbBotGap } from '/@/shared/types/lbbot-types';

import assert from 'node:assert/strict';
import test from 'node:test';

import {
    announcementKindFor,
    announcementLinkPathFor,
    gapAwaitingMatch,
    gapFailReason,
    gapSettleOutcome,
    mergeGapSummary,
} from './fill-announce-logic.ts';

/**
 * B-026 (Worbus for desktop half): pure-function coverage for the settled-row decision, run
 * the same way as `../index-mirror/mirror-logic.harness.ts` (Node 24 strips
 * TypeScript's erasable syntax natively — no build step, no devDependency):
 *
 *     node --test src/renderer/features/lbbot/hooks/fill-announce-logic.harness.ts
 *
 * (a `MODULE_TYPELESS_PACKAGE_JSON` warning on stderr is expected and
 * harmless — this repo's package.json has no "type" field and none should be
 * added just for this file; it does not affect the exit code.)
 */

test('a real failure (no stall, no needs_match) still reads couldntGet', () => {
    assert.equal(
        announcementKindFor({ isGap: false, outcome: 'failed', state: 'failed' }),
        'couldntGet',
    );
});

test('a stalled gap placement reads needsSorting, not couldntGet', () => {
    // lb-bot only ever sets `stalledPlacement` alongside `state: 'failed'` — it
    // never pairs it with `'picking'` (Worbus for desktop's gap watcher settles a `picking`
    // row as `needsPick`, not `failed`, before `stalledPlacement` would matter).
    assert.equal(
        announcementKindFor({
            isGap: true,
            outcome: 'failed',
            stalledPlacement: true,
            state: 'failed',
        }),
        'needsSorting',
    );
});

test('an album fill in needs_match reads needsSorting, not couldntGet', () => {
    assert.equal(
        announcementKindFor({ isGap: false, outcome: 'failed', state: 'needs_match' }),
        'needsSorting',
    );
});

test('done stays done', () => {
    assert.equal(announcementKindFor({ isGap: false, outcome: 'done' }), 'done');
});

test('cancelled announces nothing here', () => {
    assert.equal(announcementKindFor({ isGap: false, outcome: 'cancelled' }), null);
});

test('needsPick and gaveUp announce nothing here either', () => {
    assert.equal(announcementKindFor({ isGap: true, outcome: 'needsPick' }), null);
    assert.equal(announcementKindFor({ isGap: false, outcome: 'gaveUp' }), null);
});

test('running (mid-flight) announces nothing', () => {
    assert.equal(announcementKindFor({ isGap: false, outcome: 'running' }), null);
});

// --- announcementLinkPathFor -----------------------------------------------
//
// Final-review fix: an album fill's `groupId` at `needs_match` is an
// import-recovery record id (`rec<N>`), not a review-group id — lb-bot's
// `#/gaps/<id>` route 404s on it ("Group not found"). Only a gap's `groupId`
// is a real review group.

test('an album fill never gets a #/gaps link, even when it happens to carry a groupId', () => {
    assert.equal(announcementLinkPathFor({ groupId: 'rec17', isGap: false }), '#/downloads');
    assert.equal(announcementLinkPathFor({ isGap: false }), '#/downloads');
});

test('a stalled gap gets #/gaps/<groupId>', () => {
    assert.equal(announcementLinkPathFor({ groupId: 'grp-1', isGap: true }), '#/gaps/grp-1');
});

test('a gap with no groupId yet gets no link', () => {
    assert.equal(announcementLinkPathFor({ isGap: true }), '');
});

test('a groupId with characters that need escaping is encoded', () => {
    assert.equal(announcementLinkPathFor({ groupId: 'a b/c', isGap: true }), '#/gaps/a%20b%2Fc');
});

// --- gapAwaitingMatch --------------------------------------------------------
//
// Q-031: `picking` with a `downloaded` track is lb-bot's needs_match bucket
// (files already downloaded, waiting on a manual match lb-bot's own workspace
// does), not "your move" — the shared predicate behind both the settle and the
// gaps box's attention stage.

test('picking with a downloaded track is awaiting a match', () => {
    assert.equal(
        gapAwaitingMatch({
            sourceTask: null,
            status: 'picking',
            tracks: [{ downloadError: '', position: 1, state: 'downloaded', title: 'A' }],
        }),
        true,
    );
});

test('picking with no downloaded track is not awaiting a match (the ordinary picker)', () => {
    assert.equal(
        gapAwaitingMatch({
            sourceTask: null,
            status: 'picking',
            tracks: [{ downloadError: '', position: 1, state: 'picked', title: 'A' }],
        }),
        false,
    );
});

test('a running search is never read as awaiting a match, even with a downloaded track', () => {
    assert.equal(
        gapAwaitingMatch({
            sourceTask: {
                current: '',
                error: '',
                id: 't1',
                label: '',
                status: 'running',
                summary: '',
            },
            status: 'picking',
            tracks: [{ downloadError: '', position: 1, state: 'downloaded', title: 'A' }],
        }),
        false,
    );
    assert.equal(
        gapAwaitingMatch({
            sourceTask: {
                current: '',
                error: '',
                id: 't1',
                label: '',
                status: 'queued',
                summary: '',
            },
            status: 'picking',
            tracks: [{ downloadError: '', position: 1, state: 'downloaded', title: 'A' }],
        }),
        false,
    );
});

test('a non-picking status is never awaiting a match', () => {
    assert.equal(
        gapAwaitingMatch({
            sourceTask: null,
            status: 'failed',
            tracks: [{ downloadError: '', position: 1, state: 'downloaded', title: 'A' }],
        }),
        false,
    );
});

// --- gapSettleOutcome --------------------------------------------------------
//
// Q-031: the settle mapping `applyGapSummary` writes for a gap that just
// stopped being busy.

test('a picking gap with a downloaded track settles failed/needs_match, not needsPick', () => {
    assert.deepEqual(
        gapSettleOutcome({
            sourceTask: null,
            status: 'picking',
            tracks: [{ downloadError: '', position: 1, state: 'downloaded', title: 'A' }],
        }),
        { outcome: 'failed', state: 'needs_match' },
    );
});

test('a picking gap with no downloaded track still settles needsPick — your move, unchanged', () => {
    assert.deepEqual(
        gapSettleOutcome({
            sourceTask: null,
            status: 'picking',
            tracks: [{ downloadError: '', position: 1, state: 'picked', title: 'A' }],
        }),
        { outcome: 'needsPick', state: 'picking' },
    );
});

test('a complete gap settles done', () => {
    assert.deepEqual(gapSettleOutcome({ sourceTask: null, status: 'complete', tracks: [] }), {
        outcome: 'done',
        state: 'complete',
    });
});

test('an ordinary failed gap settles failed with its own state, not needs_match', () => {
    assert.deepEqual(
        gapSettleOutcome({
            sourceTask: null,
            status: 'failed',
            tracks: [{ downloadError: 'no peers', position: 1, state: 'failed', title: 'A' }],
        }),
        { outcome: 'failed', state: 'failed' },
    );
});

// B-044: the gap's "why" sentence — never the token, never a stale detail over
// the current verdict.

test('a no-source verdict wins over a failDetail left over from an older search', () => {
    assert.equal(
        gapFailReason({
            failDetail: 'No usable source: 7 peer(s) offered 17 file(s)',
            noSourceReason: '9 peer(s) offered 32 file(s), but none in FLAC, OPUS',
            stalledPlacement: false,
        }),
        '9 peer(s) offered 32 file(s), but none in FLAC, OPUS',
    );
});

test('a stalled placement reads its own sentence, not a no-source verdict', () => {
    assert.equal(
        gapFailReason({
            failDetail: 'Some tracks downloaded but were never filed',
            noSourceReason: 'older verdict',
            stalledPlacement: true,
        }),
        'Some tracks downloaded but were never filed',
    );
});

test('with no verdict, the detail is still better than nothing', () => {
    assert.equal(
        gapFailReason({ failDetail: 'detail', noSourceReason: '', stalledPlacement: false }),
        'detail',
    );
    assert.equal(
        gapFailReason({ failDetail: '', noSourceReason: '', stalledPlacement: false }),
        '',
    );
});

// B-042: a `/lb/fills` summary (no source rows) must not blank the dialog's list.

const gapWith = (over: Partial<LbBotGap>): LbBotGap =>
    ({
        sources: [],
        sourcesFoundAt: 100,
        sourcesPage: 0,
        sourcesPages: 1,
        sourcesTotal: 0,
        status: 'picking',
        ...over,
    }) as LbBotGap;
const rows = [{ id: 1 }, { id: 2 }] as unknown as LbBotGap['sources'];

test('a summary of the same result set keeps the rows the cache holds', () => {
    const prev = gapWith({ sources: rows, sourcesPages: 2, sourcesTotal: 12 });
    const summary = gapWith({ sourcesTotal: 12, status: 'downloading' });
    const merged = mergeGapSummary(prev, summary);
    assert.equal(merged.sources, rows);
    assert.equal(merged.sourcesPages, 2);
    // Everything else is the summary's: it is the newer read.
    assert.equal(merged.status, 'downloading');
});

test('a new search (new sourcesFoundAt) does not keep the old rows', () => {
    const prev = gapWith({ sources: rows, sourcesTotal: 12 });
    const merged = mergeGapSummary(prev, gapWith({ sourcesFoundAt: 200, sourcesTotal: 9 }));
    assert.equal(merged.sources.length, 0);
});

test('with nothing cached, or a full view in hand, the incoming gap stands', () => {
    const summary = gapWith({ sourcesTotal: 12 });
    assert.equal(mergeGapSummary(undefined, summary), summary);
    const full = gapWith({ sources: rows, sourcesTotal: 12 });
    assert.equal(mergeGapSummary(gapWith({ sources: [] }), full), full);
});
