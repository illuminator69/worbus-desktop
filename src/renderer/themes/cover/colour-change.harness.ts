import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
    artOpacity,
    COLOUR_FADE_MS,
    flipLayers,
    type LayerPair,
    ROLE_SWITCH_MS,
    switchDelayMs,
    toneVars,
    windowLight,
} from './colour-change.ts';
import { NEUTRAL_SEED, rolesFor } from './cover-roles.ts';

/**
 * R1 Task 1:  node --test src/renderer/themes/cover/colour-change.harness.ts
 *
 * A cover change cross-fades the wash's backdrop on two layers and switches the page's roles once, at
 * the fade's midpoint (audit A-01: easing 22 inherited colours restyled every element per frame).
 */

const eq = (a: string, b: string) => a === b;
const seed = { hue: 30, k: 0.8, meanL: 0.4 };
const TONE_KEYS = [
    '--tone-bar',
    '--tone-bot',
    '--tone-mid',
    '--tone-ov1',
    '--tone-ov2',
    '--tone-top',
];

test('theFadeIs300ms', () => {
    assert.equal(COLOUR_FADE_MS, 300);
});

/** Progress of a CSS `cubic-bezier(x1, y1, x2, y2)` at time fraction `t`. */
const bezierAt = ([x1, y1, x2, y2]: number[], t: number) => {
    const at = (p1: number, p2: number, s: number) =>
        3 * (1 - s) ** 2 * s * p1 + 3 * (1 - s) * s ** 2 * p2 + s ** 3;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) / 2;
        if (at(x1, x2, mid) < t) lo = mid;
        else hi = mid;
    }
    return at(y1, y2, lo);
};

// The page's roles switch when the backdrop is half-way, on the curve the backdrop actually fades with
// (`--fold-ease` in global.css). On that curve 150 ms is already 92 % of the way.
test('rolesSwitchWhenTheBackdropIsHalfWay', () => {
    const css = readFileSync(new URL('../../../shared/styles/global.css', import.meta.url), 'utf8');
    const curve = /--fold-ease:\s*cubic-bezier\(([^)]*)\)/.exec(css)?.[1].split(',').map(Number);
    assert.equal(curve?.length, 4);
    const progress = bezierAt(curve!, ROLE_SWITCH_MS / COLOUR_FADE_MS);
    assert.ok(progress >= 0.45 && progress <= 0.6, `${ROLE_SWITCH_MS} ms: ${progress.toFixed(3)}`);
});

test('rolesSwitchAtTheMidpointExceptFirstAndReduced', () => {
    assert.equal(switchDelayMs({ first: true, reduced: false }), 0);
    assert.equal(switchDelayMs({ first: false, reduced: true }), 0);
    assert.equal(switchDelayMs({ first: true, reduced: true }), 0);
    assert.equal(switchDelayMs({ first: false, reduced: false }), ROLE_SWITCH_MS);
});

test('toneVarsCarryTheBackdropAndTheVeilPerMode', () => {
    const dark = toneVars(rolesFor(seed, false), 'dark');
    assert.deepEqual(Object.keys(dark).sort(), TONE_KEYS);
    assert.equal(dark['--tone-ov1'], '78%');
    assert.equal(dark['--tone-ov2'], '86%');

    const light = toneVars(rolesFor(seed, true), 'light');
    assert.deepEqual(Object.keys(light).sort(), TONE_KEYS);
    assert.equal(light['--tone-ov1'], '50%');
    assert.equal(light['--tone-ov2'], '60%');

    const neutral = toneVars(rolesFor(NEUTRAL_SEED, false), 'neutral');
    assert.deepEqual(Object.keys(neutral).sort(), TONE_KEYS);
    assert.equal(neutral['--tone-ov1'], '100%');
    assert.equal(neutral['--tone-ov2'], '100%');
});

test('toneVarsAreFixedColoursNotReferences', () => {
    for (const [mode, light] of [
        ['dark', false],
        ['light', true],
        ['neutral', false],
    ] as const) {
        const vars = toneVars(rolesFor(seed, light), mode);
        for (const [key, value] of Object.entries(vars)) {
            assert.ok(!value.includes('var('), `${mode} ${key}: ${value}`);
        }
        // The bar keeps its alpha (0.94 dark, 0.97 light), as `--wash-bar` had it.
        assert.match(vars['--tone-bar'], light ? / \/ 0\.97\)$/ : / \/ 0\.94\)$/);
        assert.match(vars['--tone-top'], /^oklch\(/);
    }
});

test('flipLayersKeepsTheSameItem', () => {
    const pair: LayerPair<string> = { front: 0, items: ['a', null] };
    assert.equal(flipLayers(pair, 'a', eq), pair);
});

test('flipLayersPutsTheNewItemOnTheOtherSlot', () => {
    assert.deepEqual(flipLayers({ front: 0, items: ['a', null] }, 'b', eq), {
        front: 1,
        items: ['a', 'b'],
    });
});

test('aBurstAlwaysKeepsTheShownItemUnderTheNewOne', () => {
    let pair: LayerPair<string> = { front: 0, items: ['a', null] };
    pair = flipLayers(pair, 'b', eq);
    assert.deepEqual(pair, { front: 1, items: ['a', 'b'] });
    pair = flipLayers(pair, 'c', eq);
    assert.deepEqual(pair, { front: 0, items: ['c', 'b'] });
    pair = flipLayers(pair, 'd', eq);
    assert.deepEqual(pair, { front: 1, items: ['c', 'd'] });
    // Back to what is under: it comes in on top again, it is not just re-fronted.
    pair = flipLayers(pair, 'c', eq);
    assert.deepEqual(pair, { front: 0, items: ['c', 'd'] });
});

// The mode is the user's: a pale cover never turns the window light (a sudden light window strained the
// eyes), and the cover only tints the dark or the light palette.
test('theModeIsTheUsersNotTheCovers', () => {
    assert.equal(windowLight({ followSystemTheme: false, mode: 'dark' }, false), false);
    assert.equal(windowLight({ followSystemTheme: false, mode: 'dark' }, true), false);
    assert.equal(windowLight({ followSystemTheme: false, mode: 'light' }, true), true);
    assert.equal(windowLight({ followSystemTheme: true, mode: 'dark' }, false), true);
    assert.equal(windowLight({ followSystemTheme: true, mode: 'light' }, true), false);
});

test('aPalerCoverGlowsLessOnADarkWindow', () => {
    // Covers that kept the window dark before (mean lightness up to 0.62) glow exactly as before.
    for (const l of [0, 0.2, 0.4, 0.5, 0.62]) assert.equal(artOpacity(l, 'dark'), 0.55);
    let previous = 1;
    for (let l = 0; l <= 1.0001; l += 0.01) {
        const value = artOpacity(l, 'dark');
        assert.ok(value <= previous + 1e-9, `${l.toFixed(2)}: ${value} after ${previous}`);
        assert.ok(value > 0.1, `${l.toFixed(2)}: a pale cover still glows (${value})`);
        previous = value;
    }
    assert.ok(artOpacity(1, 'dark') < 0.25);
    assert.equal(artOpacity(0.9, 'light'), 0.85);
    assert.equal(artOpacity(0.1, 'light'), 0.85);
    assert.equal(artOpacity(0.5, 'neutral'), 0);
});
