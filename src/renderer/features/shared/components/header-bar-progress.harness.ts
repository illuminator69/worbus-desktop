import assert from 'node:assert/strict';
import test from 'node:test';

import { BAR_FADE_SPAN, headerBarLine, headerBarProgress } from './header-bar-progress.ts';

/**
 * Sticky headers, Task 2:  node --test src/renderer/features/shared/components/header-bar-progress.harness.ts
 *
 * The album and artist pages' sticky bar takes its opacity from the hero title's position: 0 while the
 * title's bottom is more than `span` below the bar's bottom, 1 once it is at or above it, linear in
 * between (B-220: it used to flip from 0 to 1 at a fixed 200 px of scroll). All positions are viewport
 * px, as getBoundingClientRect gives them.
 */

test('belowSpanIsHidden', () => {
    assert.equal(headerBarProgress({ barBottom: 147, span: 64, titleBottom: 211 }), 0);
    assert.equal(headerBarProgress({ barBottom: 147, span: 64, titleBottom: 400 }), 0);
});

test('atBarIsShown', () => {
    assert.equal(headerBarProgress({ barBottom: 147, span: 64, titleBottom: 147 }), 1);
});

test('halfway', () => {
    assert.equal(headerBarProgress({ barBottom: 147, span: 64, titleBottom: 179 }), 0.5);
    // A 20 px scroll step moves the bar by about 0.3, never 0 then 1.
    const a = headerBarProgress({ barBottom: 147, span: 64, titleBottom: 200 });
    const b = headerBarProgress({ barBottom: 147, span: 64, titleBottom: 180 });
    assert.ok(Math.abs(b - a - 20 / 64) < 1e-9, `${a} -> ${b}`);
});

test('pastBarStaysOne', () => {
    assert.equal(headerBarProgress({ barBottom: 147, span: 64, titleBottom: 100 }), 1);
    assert.equal(headerBarProgress({ barBottom: 147, span: 64, titleBottom: -900 }), 1);
});

test('zeroSpanSteps', () => {
    // Reduced motion: the bar is simply there once the title is under it.
    assert.equal(headerBarProgress({ barBottom: 147, span: 0, titleBottom: 148 }), 0);
    assert.equal(headerBarProgress({ barBottom: 147, span: 0, titleBottom: 147 }), 1);
    assert.equal(headerBarProgress({ barBottom: 147, span: 0, titleBottom: 20 }), 1);
});

test('lineIsTheBarWhenTheTitleRestsFarBelow', () => {
    // The title rests 120 px under the bar: the whole span fits, the bar's bottom is the line.
    assert.equal(headerBarLine({ barBottom: 147, restTitleBottom: 267, span: 64 }), 147);
});

test('lineRisesWhenTheTitleRestsInsideTheSpan', () => {
    // The artist page at 1440 x 900 on the VM: the title rests at 184, 37 px under the bar's bottom.
    // With the bar's bottom as the line the page would open with the bar at 0.42; the line moves up so
    // the page opens at 0 and the fade still takes the full span of scroll.
    const line = headerBarLine({ barBottom: 147, restTitleBottom: 184, span: 64 });
    assert.equal(line, 120);
    assert.equal(headerBarProgress({ barBottom: line, span: 64, titleBottom: 184 }), 0);
    assert.equal(headerBarProgress({ barBottom: line, span: 64, titleBottom: 184 - 64 }), 1);
});

test('lineWithZeroSpanIsTheBar', () => {
    assert.equal(headerBarLine({ barBottom: 147, restTitleBottom: 184, span: 0 }), 147);
});

test('theSpanIsSpotifys', () => {
    assert.equal(BAR_FADE_SPAN, 64);
});
