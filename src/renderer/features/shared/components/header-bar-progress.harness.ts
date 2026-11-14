import assert from 'node:assert/strict';
import test from 'node:test';

import {
    BAR_FADE_SPAN,
    headerBarLine,
    headerBarProgress,
    KICKER_FADE_SPAN,
    kickerOpacity,
} from './header-bar-progress.ts';
import { readFileSync } from 'node:fs';

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

/**
 * B-235 (the owner, 2026-11-14: fade the "ALBUM" kicker before the sticky header reaches it). Measured
 * on the workstation 2026-10-28: the bar's box ends at 147, the kicker rests at 134..152, so at scroll
 * 20 / 40 / 60 the kicker sat under a bar at 0.31 / 0.63 / 0.94, two labels on screen for 60 px. The
 * kicker now fades out over KICKER_FADE_SPAN (half the bar's span) before its bottom reaches the line
 * the bar measures against, so it is gone while the bar is still at half.
 */
const albumPage = (scroll: number) => ({
    barBottom: 147,
    kickerBottom: 152 - scroll,
    restKickerBottom: 152,
    span: KICKER_FADE_SPAN,
});

test('the_kicker_is_whole_at_rest_and_gone_before_the_bar_is', () => {
    assert.equal(KICKER_FADE_SPAN, BAR_FADE_SPAN / 2);
    assert.equal(kickerOpacity(albumPage(0)), 1);
    assert.equal(kickerOpacity(albumPage(16)), 0.5);
    assert.equal(kickerOpacity(albumPage(KICKER_FADE_SPAN)), 0);
    assert.equal(kickerOpacity(albumPage(60)), 0);
    // The bar at the scroll where the kicker is gone (the title rests at 216): under half.
    const bar = headerBarProgress({
        barBottom: headerBarLine({ barBottom: 147, restTitleBottom: 216, span: BAR_FADE_SPAN }),
        span: BAR_FADE_SPAN,
        titleBottom: 216 - KICKER_FADE_SPAN,
    });
    assert.ok(bar <= 0.5, `bar ${bar}`);
});

test('a_kicker_far_below_the_bar_fades_just_before_it', () => {
    // A tall window: the kicker rests 300 px under the bar's bottom.
    const page = (scroll: number) => ({
        barBottom: 147,
        kickerBottom: 447 - scroll,
        restKickerBottom: 447,
        span: KICKER_FADE_SPAN,
    });
    assert.equal(kickerOpacity(page(200)), 1);
    assert.equal(kickerOpacity(page(300 - 16)), 0.5);
    assert.equal(kickerOpacity(page(300)), 0);
});

test('reduced_motion_steps', () => {
    const step = (kickerBottom: number) =>
        kickerOpacity({ barBottom: 147, kickerBottom, restKickerBottom: 152, span: 0 });
    assert.equal(step(152), 1);
    assert.equal(step(147), 0);
});

test('the_page_header_fades_the_heros_kicker', () => {
    const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
    assert.match(read('./library-header.tsx'), /data-hero-kicker/);
    assert.match(read('../../../components/page-header/page-header.tsx'), /kickerOpacity\(/);
});
