import assert from 'node:assert/strict';
import test from 'node:test';

import type { CoverSeed } from './cover-roles.ts';
import type { Oklch } from './oklch.ts';

import { chooseLight, deriveCoverSeed } from './cover-seed.ts';
import { oklchToRgb, rgbToOklch } from './oklch.ts';

/**
 * F2 Task 2:  node --test src/renderer/themes/cover/cover-seed.harness.ts
 *
 * Seed derivation from RGBA pixels (chromatic fraction, salient hue, mean lightness) and the
 * light or dark choice with hysteresis.
 */

const SIZE = 40;
const PIXELS = SIZE * SIZE;

type Fill = [fraction: number, rgba: [number, number, number, number]];

/** An image whose pixels are filled in order, each fill covering `fraction` of the image. */
const image = (...fills: Fill[]) => {
    const data = new Uint8ClampedArray(PIXELS * 4);
    let at = 0;
    for (const [fraction, rgba] of fills) {
        const end = at + Math.round(fraction * PIXELS);
        for (; at < end; at++) data.set(rgba, at * 4);
    }
    assert.equal(at, PIXELS, 'fills must cover the whole image');
    return data;
};

const rgba = (r: number, g: number, b: number, a = 255): [number, number, number, number] => [
    r,
    g,
    b,
    a,
];

/** A colour of the given OKLCH, as an opaque pixel. The fixture is checked to really have that chroma. */
const lch = (l: number, c: number, h: number): [number, number, number, number] => {
    const want: Oklch = { c, h, l };
    const [r, g, b] = oklchToRgb(want);
    const got = rgbToOklch([r, g, b]);
    assert.ok(Math.abs(got.c - c) < 0.01, `fixture chroma ${got.c.toFixed(3)}, wanted ${c}`);
    return rgba(Math.round(r * 255), Math.round(g * 255), Math.round(b * 255));
};

const GREY = rgba(128, 128, 128);
const WHITE = rgba(255, 255, 255);
const BLACK = rgba(0, 0, 0);
const RED = rgba(255, 0, 0);

const derive = (data: Uint8ClampedArray) => deriveCoverSeed(data, SIZE, SIZE);

/** Same seed, allowing for float summation order (the transparent pixels are skipped, not zero). */
const assertSameSeed = (a: CoverSeed | null, b: CoverSeed | null) => {
    assert.ok(a && b);
    assert.ok(Math.abs(a.hue - b.hue) < 1e-6, `hue ${a.hue} vs ${b.hue}`);
    assert.ok(Math.abs(a.meanL - b.meanL) < 1e-9, `meanL ${a.meanL} vs ${b.meanL}`);
    assert.equal(a.k, b.k);
};

const hueDistance = (a: number, b: number) => {
    const d = Math.abs(a - b) % 360;
    return d > 180 ? 360 - d : d;
};

test('aSolidRedGivesHueNear29AndFullChroma', () => {
    const seed = derive(image([1, RED]));
    assert.ok(seed);
    assert.ok(seed.hue >= 25 && seed.hue <= 34, `hue ${seed.hue}`);
    assert.equal(seed.k, 1);
});

test('greyBlackAndWhiteGiveNoChroma', () => {
    for (const fill of [GREY, BLACK, WHITE]) {
        const seed = derive(image([1, fill]));
        assert.ok(seed);
        assert.equal(seed.k, 0, `${fill.join(',')}`);
        assert.equal(seed.hue, 0);
    }
});

test('aTenthSaturatedOnGreyKeepsHalfChroma', () => {
    const seed = derive(image([0.1, lch(0.7, 0.15, 60)], [0.9, GREY]));
    assert.ok(seed);
    assert.equal(seed.k, 0.5);
    assert.ok(hueDistance(seed.hue, 60) < 10, `hue ${seed.hue}`);
});

test('theMoreSalientHueWins', () => {
    const orange = lch(0.7, 0.15, 60);
    // Pale blue under the chroma threshold is not chromatic at all.
    const flat = derive(image([0.7, lch(0.92, 0.03, 250)], [0.3, orange]));
    assert.ok(flat);
    assert.ok(hueDistance(flat.hue, 60) < 10, `hue ${flat.hue}`);
    // Even when it just clears the threshold, the c * c weight still prefers the orange.
    const faint = derive(image([0.7, lch(0.92, 0.045, 250)], [0.3, orange]));
    assert.ok(faint);
    assert.ok(hueDistance(faint.hue, 60) < 10, `hue ${faint.hue}`);
});

test('aMoreSalientSmallPatchBeatsALargeDullOne', () => {
    const seed = derive(image([0.6, lch(0.6, 0.05, 140)], [0.2, lch(0.6, 0.2, 330)], [0.2, GREY]));
    assert.ok(seed);
    assert.ok(hueDistance(seed.hue, 330) < 10, `hue ${seed.hue}`);
    assert.equal(seed.k, 1);
});

test('circularMeanDoesNotAverageRedWithRed', () => {
    const seed = derive(image([0.5, lch(0.6, 0.15, 355)], [0.5, lch(0.6, 0.15, 5)]));
    assert.ok(seed);
    assert.ok(hueDistance(seed.hue, 0) < 10, `hue ${seed.hue}`);
});

test('transparentPixelsAreIgnored', () => {
    const half = derive(image([0.5, rgba(255, 255, 255, 0)], [0.5, RED]));
    assertSameSeed(half, derive(image([1, RED])));
    // The cut is at 128: 127 is ignored, 128 counts.
    const edge = derive(image([0.5, rgba(255, 255, 255, 127)], [0.5, RED]));
    assertSameSeed(edge, derive(image([1, RED])));
    const counted = derive(image([0.5, rgba(255, 255, 255, 128)], [0.5, RED]));
    assert.ok(counted);
    assert.ok(counted.meanL > derive(image([1, RED]))!.meanL);
});

test('allTransparentGivesNull', () => {
    assert.equal(derive(image([1, rgba(10, 20, 30, 0)])), null);
    assert.equal(derive(image([1, rgba(10, 20, 30, 127)])), null);
});

test('meanLightnessIsReturned', () => {
    const white = derive(image([1, WHITE]));
    const black = derive(image([1, rgba(2, 2, 2)]));
    assert.ok(white && black);
    assert.ok(white.meanL > 0.95, `white ${white.meanL}`);
    assert.ok(black.meanL < 0.1, `black ${black.meanL}`);
});

test('chooseLightHasHysteresis', () => {
    assert.equal(chooseLight(0.8, false), true);
    assert.equal(chooseLight(0.8, true), true);
    assert.equal(chooseLight(0.55, true), false);
    assert.equal(chooseLight(0.55, false), false);
    assert.equal(chooseLight(0.68, true), true);
    assert.equal(chooseLight(0.68, false), false);
    // The edges themselves.
    assert.equal(chooseLight(0.74, false), true);
    assert.equal(chooseLight(0.62, true), false);
});
