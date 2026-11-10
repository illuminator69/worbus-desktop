import assert from 'node:assert/strict';
import test from 'node:test';

import { createHubDrivenWindow } from './hub-driven-window.ts';

/**
 * W1 review (5):  node --test src/renderer/features/hub/utils/hub-driven-window.harness.ts
 *
 * While the window is open the player's events publish nothing, so a change made inside it (a
 * play order this device built because the hub's did not fit, a shuffle toggle a second after a
 * `do:seek`) reached the hub only at the next track or status change, and the hub stepped the old
 * order meanwhile. When the window lapses it says so once (`onLapse`), and use-hub publishes if
 * what it holds differs from what it last published.
 */

const clock = () => {
    let now = 1000;
    const timers: { at: number; fn: () => void; id: number }[] = [];
    let next = 1;
    return {
        advance: (ms: number) => {
            now += ms;
            for (const timer of [...timers].sort((a, b) => a.at - b.at)) {
                if (timer.at <= now && timers.includes(timer)) {
                    timers.splice(timers.indexOf(timer), 1);
                    timer.fn();
                }
            }
        },
        clearTimer: (id: unknown) => {
            const at = timers.findIndex((timer) => timer.id === id);
            if (at >= 0) timers.splice(at, 1);
        },
        now: () => now,
        setTimer: (fn: () => void, ms: number) => {
            timers.push({ at: now + ms, fn, id: next });
            return next++;
        },
    };
};

test('the window says once that it lapsed, after the last hold', () => {
    const c = clock();
    let lapses = 0;
    const w = createHubDrivenWindow({ ...c, onLapse: () => (lapses += 1) } as never);
    w.hold(2000);
    c.advance(1500);
    assert.equal(w.isOpen(), true);
    w.hold(2000); // a second directive keeps it open
    c.advance(1000);
    assert.equal(lapses, 0, 'still open');
    c.advance(1100);
    assert.equal(w.isOpen(), false);
    assert.equal(lapses, 1, 'one lapse, after the later hold');
    c.advance(5000);
    assert.equal(lapses, 1);
});

test('a shorter hold never shortens it; close() shuts it without a lapse', () => {
    const c = clock();
    let lapses = 0;
    const w = createHubDrivenWindow({ ...c, onLapse: () => (lapses += 1) } as never);
    w.hold(2000);
    w.hold(1000);
    assert.equal(w.until(), 3000);
    w.close();
    assert.equal(w.isOpen(), false);
    c.advance(5000);
    assert.equal(lapses, 0, 'a dropped socket is not a lapse to publish into');
});
