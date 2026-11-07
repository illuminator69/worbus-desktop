import assert from 'node:assert/strict';
import test from 'node:test';

import { HYSTERESIS, QUEUE_RAIL_BELOW, shellFit, SIDEBAR_RAIL_BELOW } from './shell-fit.ts';

/**
 * R6 Task 1 (B-207, B-198):  node --test src/renderer/layouts/default-layout/shell-fit.harness.ts
 *
 * At 1100 x 700 with the queue open the Tracks title column was one letter wide, and at 800 px the
 * page got 176 px. The board's Narrow frame folds the queue to its 44 px rail at 1100 and keeps the
 * sidebar; below 900 the sidebar goes to its rail too. A fold happens below a threshold and undoes
 * only 24 px above it, so dragging the window edge across the line cannot flip it back and forth.
 */

test("the thresholds are the plan's", () => {
    assert.equal(QUEUE_RAIL_BELOW, 1180);
    assert.equal(SIDEBAR_RAIL_BELOW, 900);
    assert.equal(HYSTERESIS, 24);
});

test('wideIsFull: 1440 shows the panel and the full sidebar', () => {
    assert.deepEqual(shellFit({ previous: null, width: 1440 }), {
        queue: 'panel',
        sidebar: 'full',
    });
});

test('boardNarrow: 1100 folds the queue to its rail and keeps the sidebar', () => {
    assert.deepEqual(shellFit({ previous: null, width: 1100 }), { queue: 'rail', sidebar: 'full' });
});

test('tiny: 800 folds both', () => {
    assert.deepEqual(shellFit({ previous: null, width: 800 }), { queue: 'rail', sidebar: 'rail' });
});

test('hysteresisHolds: a folded queue unfolds only at threshold + 24', () => {
    const folded = shellFit({ previous: null, width: 1100 });
    assert.equal(shellFit({ previous: folded, width: 1190 }).queue, 'rail');
    assert.equal(shellFit({ previous: folded, width: 1203 }).queue, 'rail');
    assert.equal(shellFit({ previous: folded, width: 1204 }).queue, 'panel');
    // Unfolded, the plain threshold applies on the way down.
    const open = shellFit({ previous: null, width: 1190 });
    assert.equal(open.queue, 'panel');
    assert.equal(shellFit({ previous: open, width: 1180 }).queue, 'panel');
    assert.equal(shellFit({ previous: open, width: 1179 }).queue, 'rail');
});

test('sidebarHysteresis: a folded sidebar unfolds only at threshold + 24', () => {
    const folded = shellFit({ previous: null, width: 800 });
    assert.equal(shellFit({ previous: folded, width: 910 }).sidebar, 'rail');
    assert.equal(shellFit({ previous: folded, width: 924 }).sidebar, 'full');
    const full = shellFit({ previous: null, width: 910 });
    assert.equal(shellFit({ previous: full, width: 899 }).sidebar, 'rail');
});

test('a drag across the line and back, 8 px at a time, flips once each way', () => {
    let fit = shellFit({ previous: null, width: 1260 });
    const flips: string[] = [];
    const step = (width: number) => {
        const next = shellFit({ previous: fit, width });
        if (next.queue !== fit.queue) flips.push(`${next.queue}@${width}`);
        fit = next;
    };
    for (let width = 1260; width >= 1100; width -= 8) step(width);
    for (let width = 1100; width <= 1260; width += 8) step(width);
    assert.deepEqual(flips, ['rail@1172', 'panel@1204']);
});
