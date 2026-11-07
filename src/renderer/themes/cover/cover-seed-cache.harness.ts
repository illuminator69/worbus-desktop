import assert from 'node:assert/strict';
import test from 'node:test';

import type { CoverSeed } from './cover-roles.ts';

import { createSeedCache, seedKey } from './cover-seed-cache.ts';

/**
 * F2 Task 3:  node --test src/renderer/themes/cover/cover-seed-cache.harness.ts
 *
 * The in-memory seed cache: least recently used dropped over the limit, rows that round-trip.
 */

const seed = (hue: number): CoverSeed => ({ hue, k: 1, meanL: 0.5 });

test('getReturnsWhatWasSet', () => {
    const cache = createSeedCache(4);
    cache.set('a', seed(10));
    assert.deepEqual(cache.get('a'), seed(10));
    assert.equal(cache.get('missing'), undefined);
    assert.equal(cache.size(), 1);
});

test('overTheLimitTheLeastRecentlyUsedGoes', () => {
    const cache = createSeedCache(3);
    cache.set('a', seed(1));
    cache.set('b', seed(2));
    cache.set('c', seed(3));
    cache.get('a');
    cache.set('d', seed(4));
    assert.equal(cache.size(), 3);
    assert.equal(cache.get('b'), undefined);
    assert.deepEqual(cache.get('a'), seed(1));
    assert.deepEqual(cache.get('c'), seed(3));
    assert.deepEqual(cache.get('d'), seed(4));
});

test('rowsRoundTrip', () => {
    const cache = createSeedCache(3);
    cache.set('a', seed(1));
    cache.set('b', seed(2));
    cache.set('c', seed(3));
    cache.get('a');
    const copy = createSeedCache(3, cache.toRows());
    assert.deepEqual(copy.toRows(), cache.toRows());
    // Recency survives the trip: b is still the least recently used.
    copy.set('d', seed(4));
    assert.equal(copy.get('b'), undefined);
    assert.deepEqual(copy.get('a'), seed(1));
});

test('seedKeyJoinsServerAndImage', () => {
    assert.equal(seedKey('server-1', 'al-42'), 'server-1:al-42');
});
