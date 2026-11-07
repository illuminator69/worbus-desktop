import assert from 'node:assert/strict';
import test from 'node:test';

import { remoteNextIndex } from './remote-next.ts';

/**
 * B-227 (I-2):  node --test src/renderer/features/hub/utils/remote-next.harness.ts
 *
 * The queue index that plays after `index` in a hub session, as the local player answers it for
 * its own queue: play order when the session shuffles (`order` lists queue indexes), repeat-all
 * wraps to the first song in play order, repeat-one gives the same song, and the end without
 * repeat gives null.
 */

test('queue order: the next index, and null at the end without repeat', () => {
    assert.equal(remoteNextIndex({ index: 0, length: 4, order: null, repeat: 'none' }), 1);
    assert.equal(remoteNextIndex({ index: 3, length: 4, order: null, repeat: 'none' }), null);
});

test('shuffled: the next song in play order, not in queue order', () => {
    const order = [2, 0, 3, 1];
    assert.equal(remoteNextIndex({ index: 2, length: 4, order, repeat: 'none' }), 0);
    assert.equal(remoteNextIndex({ index: 0, length: 4, order, repeat: 'none' }), 3);
    // Queue index 3 is not last in the queue's order but is third in play order.
    assert.equal(remoteNextIndex({ index: 3, length: 4, order, repeat: 'none' }), 1);
    // The last in play order (queue index 1) ends the session without repeat.
    assert.equal(remoteNextIndex({ index: 1, length: 4, order, repeat: 'none' }), null);
});

test('repeat-all wraps to the first song, in play order when shuffled', () => {
    assert.equal(remoteNextIndex({ index: 3, length: 4, order: null, repeat: 'all' }), 0);
    assert.equal(remoteNextIndex({ index: 1, length: 4, order: [2, 0, 3, 1], repeat: 'all' }), 2);
});

test('repeat-one plays the same song again', () => {
    assert.equal(remoteNextIndex({ index: 2, length: 4, order: [2, 0, 3, 1], repeat: 'one' }), 2);
    assert.equal(remoteNextIndex({ index: 3, length: 4, order: null, repeat: 'one' }), 3);
});

test('an order that does not cover the queue is ignored, as remainingRemote ignores it', () => {
    assert.equal(remoteNextIndex({ index: 1, length: 4, order: [3, 1], repeat: 'none' }), 2);
    // The index missing from a full-length order falls back to queue order too.
    assert.equal(remoteNextIndex({ index: 1, length: 3, order: [2, 0, 0], repeat: 'none' }), 2);
});

test('an empty queue or an index outside it has no next song', () => {
    assert.equal(remoteNextIndex({ index: 0, length: 0, order: null, repeat: 'all' }), null);
    assert.equal(remoteNextIndex({ index: 5, length: 4, order: null, repeat: 'one' }), null);
});
