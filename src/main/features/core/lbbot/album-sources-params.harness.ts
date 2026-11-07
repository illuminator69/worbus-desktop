import assert from 'node:assert/strict';
import test from 'node:test';

import { albumSourcesParams } from './album-sources-params.ts';

/**
 * R12 (review F4): the query `/lb/album/sources` is asked with. Search again after a refusal must
 * ask lb-bot to search afresh (`refresh=1`, its own escape hatch), as the gaps box's Search again
 * does (`force`); without it the hub's one-minute cache hands back the same cards.
 *
 *     node --test src/main/features/core/lbbot/album-sources-params.harness.ts
 */

test('anOrdinaryReadAsksNoRefresh', () => {
    assert.deepEqual(albumSourcesParams({ rgid: 'rg' }), { rgid: 'rg' });
    assert.equal('refresh' in albumSourcesParams({ refresh: false, rgid: 'rg' }), false);
});

test('searchAgainAsksAfresh', () => {
    assert.equal(albumSourcesParams({ refresh: true, rgid: 'rg' }).refresh, '1');
});

test('theResolvedEditionRidesAlong', () => {
    assert.deepEqual(
        albumSourcesParams({
            album: 'A',
            artist: 'B',
            refresh: true,
            releaseMbid: 'rel',
            rgid: 'rg',
            total: 12,
        }),
        { album: 'A', artist: 'B', refresh: '1', release_mbid: 'rel', rgid: 'rg', total: '12' },
    );
});
