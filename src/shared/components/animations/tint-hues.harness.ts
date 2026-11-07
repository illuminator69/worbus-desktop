import assert from 'node:assert/strict';
import test from 'node:test';

import { tintHues } from './tint-hues.ts';

/**
 * F5:  node --test src/shared/components/animations/tint-hues.harness.ts
 *
 * A cover's placeholder tint: two hues from the item, stable, spread over the wheel, 40 to 100 degrees apart.
 */

const seeds = [
    ...Array.from({ length: 900 }, (_, i) => String(i)),
    ...Array.from({ length: 50 }, (_, i) => `al-${i * 7 + 3}`),
    ...Array.from({ length: 50 }, (_, i) => `song-${i * 131 + 4567}`),
];

test('theSameSeedGivesTheSamePair', () => {
    assert.deepEqual(tintHues('al-123'), tintHues('al-123'));
    assert.deepEqual(tintHues('song-4567'), tintHues('song-4567'));
});

test('huesAreIntegersOnTheWheelAndApart', () => {
    for (const s of seeds) {
        const [a, b] = tintHues(s);
        assert.ok(Number.isInteger(a) && a >= 0 && a <= 359, `${s}: ${a}`);
        assert.ok(Number.isInteger(b) && b >= 0 && b <= 359, `${s}: ${b}`);
        const gap = (((b - a) % 360) + 360) % 360;
        assert.ok(gap >= 40 && gap <= 100, `${s}: gap ${gap}`);
    }
});

test('firstHuesSpreadOverTheWheel', () => {
    const buckets = Array.from({ length: 12 }, () => 0);
    for (const s of seeds) buckets[Math.floor(tintHues(s)[0] / 30)] += 1;
    console.log('buckets', buckets.join(' '));
    assert.ok(buckets.every((n) => n > 0));
    assert.ok(buckets.every((n) => n <= seeds.length * 0.2));
});

test('shortSeedsAreValid', () => {
    for (const s of ['', 'a']) {
        const [a, b] = tintHues(s);
        assert.ok(a >= 0 && a <= 359 && b >= 0 && b <= 359);
    }
});

// Neighbouring ids sit side by side in a grid (al-15, al-16): their tints must not look alike.
// Random hues would put about 5.6% of pairs within 10 degrees; allow up to 10%.
test('neighbouringIdsGetDifferentTints', () => {
    const dist = (x: number, y: number) => Math.min((x - y + 360) % 360, (y - x + 360) % 360);
    let close = 0;
    const n = 1000;
    for (let i = 1; i <= n; i++) {
        if (dist(tintHues(`al-${i}`)[0], tintHues(`al-${i + 1}`)[0]) < 10) close += 1;
    }
    console.log('neighbours within 10 degrees', close, 'of', n);
    assert.ok(close <= n * 0.1, `${close} of ${n} neighbouring pairs within 10 degrees`);
});
