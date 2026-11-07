import assert from 'node:assert/strict';
import test from 'node:test';

import { createArtCache } from './cover-art-cache.ts';

/**
 * node --test src/renderer/themes/cover/cover-art-cache.harness.ts
 *
 * The window wash changes its colours and its artwork together: the artwork is loaded alongside the
 * cover's seed, and a change waits for both. Before, the colours changed as soon as the seed was known
 * (at once when cached) and the artwork's own load only started then, so it popped in up to a second
 * later on a slow server.
 */

const deferred = () => {
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<void>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, reject, resolve };
};

test('oneLoadPerCoverHoweverManyAsk', async () => {
    const loads: string[] = [];
    const pending = deferred();
    const cache = createArtCache((src) => {
        loads.push(src);
        return pending.promise;
    }, 4);
    const a = cache.preload('a');
    const b = cache.preload('a');
    assert.deepEqual(loads, ['a']);
    assert.equal(cache.isReady('a'), false);
    pending.resolve();
    await Promise.all([a, b]);
    assert.equal(cache.isReady('a'), true);
    await cache.preload('a');
    assert.deepEqual(loads, ['a']);
});

test('aCoverThatFailsIsReadyAsAnEmptyLayer', async () => {
    const cache = createArtCache(() => Promise.reject(new Error('404')), 4);
    await cache.preload('broken');
    assert.equal(cache.isReady('broken'), true);
});

test('onlyTheLatestCoversStayReady', async () => {
    const cache = createArtCache(() => Promise.resolve(), 2);
    for (const src of ['a', 'b', 'c']) await cache.preload(src);
    assert.equal(cache.isReady('a'), false);
    assert.equal(cache.isReady('b'), true);
    assert.equal(cache.isReady('c'), true);
    // Asking again counts as use: `b` is kept over `c`.
    await cache.preload('b');
    await cache.preload('d');
    assert.equal(cache.isReady('b'), true);
    assert.equal(cache.isReady('c'), false);
});
