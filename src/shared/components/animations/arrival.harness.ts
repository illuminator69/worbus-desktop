import assert from 'node:assert/strict';
import test from 'node:test';

import {
    ARRIVAL_SETTLE_MS,
    arrivalDelayMs,
    arrivalFor,
    type ArrivalWindow,
    openArrival,
} from './arrival.ts';

/**
 * F5:  node --test src/shared/components/animations/arrival.harness.ts
 *
 * The arrival grammar's timing: the first five rows or tiles follow one another 30 ms apart, the rest
 * arrive together at 150 ms, and a list's window closes 900 ms after it opened so nothing replays.
 */

test('delaysFollowTheLeadThenTheRest', () => {
    const at = [0, 1, 2, 3, 4, 5, 6, 50, 400].map(arrivalDelayMs);
    assert.deepEqual(at, [0, 30, 60, 90, 120, 150, 150, 150, 150]);
});

test('oddIndicesAreSafe', () => {
    assert.equal(arrivalDelayMs(-3), 0);
    assert.equal(arrivalDelayMs(Number.NaN), 0);
    assert.equal(arrivalDelayMs(2.9), 60);
});

test('theWindowOpensOnceWhenReady', () => {
    assert.deepEqual(openArrival({ openedAt: null }, 1000, false), { openedAt: null });
    assert.deepEqual(openArrival({ openedAt: null }, 1000, true), { openedAt: 1000 });
    assert.deepEqual(openArrival({ openedAt: 1000 }, 5000, true), { openedAt: 1000 });
    assert.deepEqual(openArrival({ openedAt: 1000 }, 5000, false), { openedAt: 1000 });
});

test('anItemArrivesOnlyWhileTheWindowIsOpen', () => {
    const w: ArrivalWindow = { openedAt: 1000 };
    assert.deepEqual(arrivalFor(w, 1000, 0), { delayMs: 0 });
    assert.deepEqual(arrivalFor(w, 1899, 7), { delayMs: 150 });
    assert.equal(arrivalFor(w, 1900, 0), null);
    assert.equal(arrivalFor({ openedAt: null }, 1000, 0), null);
    assert.equal(ARRIVAL_SETTLE_MS, 900);
});

test('aVirtualisedListDoesNotReplay', () => {
    // 12 items mounted with the window at 0, then 300 more mounted one every 50 ms (a scroll).
    let w: ArrivalWindow = { openedAt: null };
    w = openArrival(w, 0, true);
    const mounts: number[] = [...Array.from({ length: 12 }, () => 0)];
    for (let i = 0; i < 300; i++) mounts.push(50 + i * 50);
    const animated = mounts.filter((at, i) => arrivalFor(w, at, i) !== null);
    const expected = mounts.filter((at) => at < 900);
    assert.equal(animated.length, expected.length);
    assert.equal(
        mounts.every((at, i) => (arrivalFor(w, at, i) !== null) === at < 900),
        true,
    );
});
