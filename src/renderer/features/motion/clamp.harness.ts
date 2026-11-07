import assert from 'node:assert/strict';
import test from 'node:test';

import { ABOUT_LINES, closeScroll, foldAt, foldProgress, halfLeading, lineBoxes } from './clamp.ts';

/**
 * R13 (B-243): the About text folds to whole lines, with an arrow only when it runs past them.
 *
 *     node --test src/renderer/features/motion/clamp.harness.ts
 */

test('one line count on every page', () => {
    assert.equal(ABOUT_LINES, 5);
});

/*
 * Review M1: the fold cuts on a whole line. The lines are the text's own line boxes (each glyph
 * run's rect with its half-leading added), not a line height times five, so a paragraph gap or a
 * second line height inside the text cannot slice a line.
 */

test('glyph runs on one line merge into one line box; lines that only touch stay apart', () => {
    const lh = 21.7;
    const runs = [
        // Line 1 in two runs (a link inside it), line 2, then line 3 after an 8 px paragraph gap.
        { bottom: lh, top: 0 },
        { bottom: lh, top: 0.2 },
        { bottom: 2 * lh, top: lh },
        { bottom: 3 * lh + 8, top: 2 * lh + 8 },
    ];
    assert.deepEqual(
        lineBoxes(runs).map((line) => line.top),
        [0, lh, 2 * lh + 8],
    );
    assert.deepEqual(lineBoxes([{ bottom: 5, top: 5 }]), []);
});

test('the cut is the bottom of the last whole line, never inside a paragraph gap', () => {
    const lh = 21.7;
    const lines = (count: number, gapAfter = -1, gap = 0) =>
        Array.from({ length: count }, (_, i) => {
            const shift = gapAfter >= 0 && i > gapAfter ? gap : 0;
            return { bottom: (i + 1) * lh + shift, top: i * lh + shift };
        });
    // Seven even lines: five shown.
    assert.equal(foldAt(lines(7), 5), 5 * lh);
    // A paragraph break after line 5: the cut stays on line 5's bottom, not in the gap.
    assert.equal(foldAt(lines(7, 4, 8), 5), 5 * lh);
    // A paragraph break after line 3: line 5 is lower by the gap, and the cut follows it.
    assert.equal(foldAt(lines(7, 2, 8), 5), 5 * lh + 8);
    // Exactly five lines (or fewer): nothing folds, whatever trails the last line.
    assert.equal(foldAt(lines(5), 5), null);
    assert.equal(foldAt(lines(3), 5), null);
    // Six lines: one whole line is hidden.
    assert.equal(foldAt(lines(6), 5), 5 * lh);
});

test('half-leading: what a glyph run adds above and below to fill its line box', () => {
    assert.equal(halfLeading('21.7px', 16.7), 2.5);
    // `normal` and anything unparsed: the run is the line.
    assert.equal(halfLeading('normal', 17), 0);
    // A run taller than the line height never shrinks it.
    assert.equal(halfLeading('14px', 20), 0);
});

/*
 * Review M3 and its follow-up: closing scrolls the page only when the arrow, rising by the shrink,
 * would end above the bar's bottom; then the About's top (its label) settles a panel gap under the
 * bar, so the folded lines are what the reader sees. The scroll is spread over the fold.
 */

test('closing: nothing moves while the arrow ends below the bar', () => {
    // Pressed at 900 under a 147 px bar, the text shrinks by 596: the arrow ends at 304.
    assert.equal(closeScroll({ aboutTop: 200, arrowTop: 900, barBottom: 147, shrink: 596 }), 0);
    // Exactly on the bar: still in view.
    assert.equal(closeScroll({ aboutTop: 200, arrowTop: 743, barBottom: 147, shrink: 596 }), 0);
});

test('closing from deep in a long About: its top settles a panel gap under the bar', () => {
    // Pressed at 400 with the About's top 330 px above the window: the page scrolls up by 485, so the
    // top lands at 147 + 8 and the five folded lines show under it.
    assert.equal(closeScroll({ aboutTop: -330, arrowTop: 400, barBottom: 147, shrink: 596 }), -485);
    assert.equal(
        closeScroll({ aboutTop: 120, arrowTop: 300, barBottom: 147, gap: 8, shrink: 596 }),
        -35,
    );
    // Never a scroll down: a top already under the line stays.
    assert.equal(closeScroll({ aboutTop: 160, arrowTop: 100, barBottom: 147, shrink: 596 }), 0);
});

test('the close scroll follows the fold: none at the start, all of it when the height settles', () => {
    assert.equal(foldProgress({ end: 116, height: 712, start: 712 }), 0);
    assert.equal(foldProgress({ end: 116, height: 414, start: 712 }), 0.5);
    assert.equal(foldProgress({ end: 116, height: 116, start: 712 }), 1);
    // The ease overshoots nothing, but a subpixel past either end is clamped.
    assert.equal(foldProgress({ end: 116, height: 115.6, start: 712 }), 1);
    assert.equal(foldProgress({ end: 300, height: 300, start: 300 }), 1);
});
