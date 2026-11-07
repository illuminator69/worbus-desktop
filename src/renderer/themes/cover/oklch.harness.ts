import assert from 'node:assert/strict';
import test from 'node:test';

import type { Rgb } from './oklch.ts';

import { composite, contrast, oklchCss, oklchToRgb, rgbCss, rgbToOklch } from './oklch.ts';

/**
 * F2 Task 1:  node --test src/renderer/themes/cover/oklch.harness.ts
 *
 * OKLCH to gamma-encoded sRGB and back, gamut fitting by chroma reduction, CSS-style
 * compositing, WCAG 2.x contrast and the two CSS string formats.
 */

const hueDistance = (a: number, b: number) => {
    const d = Math.abs(a - b) % 360;
    return d > 180 ? 360 - d : d;
};

test('roundTripKeepsAColourInGamut', () => {
    const colours: Rgb[] = [
        [0, 0, 0],
        [1, 1, 1],
        [0.5, 0.5, 0.5],
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
        [0.2, 0.4, 0.6],
        [0.9, 0.7, 0.1],
        [0.33, 0.05, 0.72],
        [0.12, 0.85, 0.64],
    ];
    for (const rgb of colours) {
        const back = oklchToRgb(rgbToOklch(rgb));
        for (let i = 0; i < 3; i++) {
            assert.ok(
                Math.abs(back[i] - rgb[i]) <= 0.002,
                `${rgb.join(',')} came back as ${back.join(',')}`,
            );
        }
    }
});

test('highChromaIsReducedNotClipped', () => {
    const rgb = oklchToRgb({ c: 0.4, h: 28, l: 0.88 });
    for (const channel of rgb) {
        assert.ok(channel >= 0 && channel <= 1, `channel ${channel} out of range`);
    }
    const back = rgbToOklch(rgb);
    assert.ok(hueDistance(back.h, 28) <= 3, `hue drifted to ${back.h}`);
});

test('compositeIsGammaSpace', () => {
    assert.deepEqual(composite([1, 1, 1], [0, 0, 0], 0.5), [0.5, 0.5, 0.5]);
});

test('contrastOfBlackOnWhiteIs21', () => {
    assert.ok(Math.abs(contrast([0, 0, 0], [1, 1, 1]) - 21) < 1e-9);
    assert.ok(Math.abs(contrast([1, 1, 1], [0, 0, 0]) - 21) < 1e-9);
});

test('oklchCssFormats', () => {
    assert.equal(oklchCss({ c: 0.085, h: 28, l: 0.36 }), 'oklch(0.360 0.085 28)');
    assert.ok(oklchCss({ c: 0.085, h: 28, l: 0.36 }, 0.15).endsWith('/ 0.15)'));
});

test('rgbCssUsesCommas', () => {
    assert.equal(rgbCss([12 / 255, 34 / 255, 56 / 255]), 'rgb(12, 34, 56)');
});
