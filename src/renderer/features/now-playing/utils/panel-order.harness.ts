import assert from 'node:assert/strict';
import test from 'node:test';

import { movePanel } from './panel-order.ts';

/**
 * R6 (B-207):  node --test src/renderer/features/now-playing/utils/panel-order.harness.ts
 *
 * With the queue in the panel, lyrics and the visualiser live in the strip at its bottom whatever the
 * saved order says, so moving lyrics "above the queue" did nothing. The arrows now order the two of
 * them only, and offer nothing when the other one is not there.
 */

test('lyricsMovesAboveTheVisualiserOnly', () => {
    assert.deepEqual(movePanel(['queue', 'visualizer', 'lyrics'], 'lyrics', 'up'), [
        'queue',
        'lyrics',
        'visualizer',
    ]);
    // The queue keeps its place: the move swaps the two, it does not step past the queue.
    assert.deepEqual(movePanel(['lyrics', 'queue', 'visualizer'], 'visualizer', 'up'), [
        'visualizer',
        'queue',
        'lyrics',
    ]);
});

test('noMovePastTheEnd', () => {
    assert.equal(movePanel(['queue', 'lyrics', 'visualizer'], 'lyrics', 'up'), null);
    assert.equal(movePanel(['queue', 'lyrics', 'visualizer'], 'visualizer', 'down'), null);
    assert.deepEqual(movePanel(['queue', 'lyrics', 'visualizer'], 'lyrics', 'down'), [
        'queue',
        'visualizer',
        'lyrics',
    ]);
});

test('lyricsAboveTheQueueIsNotAMove', () => {
    // The old arrows swapped lyrics with the queue here; the strip shows the same either way.
    assert.equal(movePanel(['queue', 'lyrics'], 'lyrics', 'up'), null);
    assert.equal(movePanel(['lyrics', 'queue'], 'lyrics', 'down'), null);
});
