import assert from 'node:assert/strict';
import test from 'node:test';

import { albumBoxView, requestStage } from './request-stage.ts';

/**
 * F7 Task 7: the request box's stage, read from the ledger row and never inferred from the page.
 *
 *     node --test src/renderer/features/discography/request-stage.harness.ts
 */

const stage = (
    row: null | { outcome?: string; settled: boolean; state?: string; verifyGaveUp?: boolean },
    over = {},
) =>
    requestStage({
        indexRowOwned: false,
        ownedAlbumId: null,
        row: row ? { outcome: 'running', state: '', ...row } : null,
        ...over,
    });

test('no row is none', () => {
    assert.equal(stage(null), 'none');
});

test('unsettled is active', () => {
    assert.equal(stage({ settled: false, state: 'searching' }), 'active');
    assert.equal(stage({ settled: false, state: 'downloading' }), 'active');
    assert.equal(stage({ settled: false, state: 'placing' }), 'active');
});

test('placed is syncing, never in the library', () => {
    assert.equal(stage({ settled: false, state: 'placed' }), 'syncing');
});

test('the settled outcomes', () => {
    assert.equal(stage({ outcome: 'failed', settled: true, state: 'failed' }), 'failed');
    assert.equal(stage({ outcome: 'cancelled', settled: true, state: 'cancelled' }), 'cancelled');
    assert.equal(stage({ outcome: 'needsPick', settled: true }), 'needsPick');
    assert.equal(stage({ outcome: 'failed', settled: true, state: 'needs_match' }), 'needsMatch');
    assert.equal(stage({ outcome: 'gaveUp', settled: true }), 'gaveUp');
    assert.equal(
        stage({ outcome: 'done', settled: true, state: 'verified', verifyGaveUp: true }),
        'syncing',
    );
    assert.equal(stage({ outcome: 'done', settled: true, state: 'verified' }), 'inLibrary');
});

test('an index row that names the album wins over an old failed row', () => {
    assert.equal(
        stage(
            { outcome: 'failed', settled: true, state: 'failed' },
            { indexRowOwned: true, ownedAlbumId: 'al-1' },
        ),
        'inLibrary',
    );
    assert.equal(stage(null, { indexRowOwned: true, ownedAlbumId: 'al-1' }), 'inLibrary');
    // Owned without an album id to open is not in the library yet.
    assert.equal(stage(null, { indexRowOwned: true, ownedAlbumId: null }), 'none');
});

const view = (over: Partial<Parameters<typeof albumBoxView>[0]> = {}) =>
    albumBoxView({
        fillFinishedAt: 0,
        searchStartedAt: 0,
        searchState: 'idle',
        stage: 'none',
        starting: false,
        ...over,
    });

test('R11: nothing asked, nothing shown', () => {
    assert.equal(view(), 'none');
});

test('R11: a search turns the box into the sources', () => {
    assert.equal(view({ searchStartedAt: 5, searchState: 'waiting' }), 'sources');
    assert.equal(view({ searchStartedAt: 5, searchState: 'ready' }), 'sources');
    assert.equal(view({ searchStartedAt: 5, searchState: 'empty' }), 'sources');
});

test('R11: a fill in flight is the truth over the sources, wherever it was started', () => {
    for (const searchState of ['idle', 'waiting', 'ready'] as const) {
        assert.equal(view({ searchStartedAt: 5, searchState, stage: 'active' }), 'fill');
        assert.equal(view({ searchStartedAt: 5, searchState, stage: 'syncing' }), 'fill');
    }
    assert.equal(view({ stage: 'active', starting: true }), 'fill');
});

test('R11: a request on its way keeps the cards it was made from', () => {
    assert.equal(view({ searchStartedAt: 5, searchState: 'ready', starting: true }), 'sources');
});

test('R11: a finished fill stays until sources are asked for after it', () => {
    assert.equal(view({ fillFinishedAt: 10, stage: 'failed' }), 'fill');
    assert.equal(
        view({ fillFinishedAt: 10, searchStartedAt: 5, searchState: 'ready', stage: 'failed' }),
        'fill',
    );
    assert.equal(
        view({
            fillFinishedAt: 10,
            searchStartedAt: 20,
            searchState: 'waiting',
            stage: 'cancelled',
        }),
        'sources',
    );
    assert.equal(view({ fillFinishedAt: 10, stage: 'inLibrary' }), 'fill');
});
