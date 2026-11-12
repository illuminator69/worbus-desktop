import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { radioStopPlan } from './radio-handoff.ts';

/**
 * Fix round 4 (2026-11-12), the VM walk's FAILED B-349 step:
 *   node --test src/renderer/features/radio/utils/radio-handoff.harness.ts
 *
 * Fresh start, the queue paused at 63.1 s (its element already there, the startup seek done);
 * play a radio station; stop it; press Play: the queue started at 0 s. The radio takes the web
 * player's place, so the queue's elements are unmounted, and stopping the station reset the
 * queue's position to 0 and left nothing for the remounted player to seek to.
 */

/** The swap, modelled: the store's position, the remounted element, Play. */
const walk = (positionSec: number) => {
    const store = { position: positionSec, status: 'paused' };
    let handoff = -1;
    // The station starts: the store reads PLAYING, the queue's player unmounts; its position stays.
    store.status = 'playing';
    // The station stops.
    const plan = radioStopPlan(store.position);
    if (plan.queue === 'stop-and-reset') {
        store.status = 'stopped';
        store.position = 0;
    } else {
        store.status = 'paused';
    }
    handoff = plan.handoffSeekSec;
    // The queue's player remounts: its element starts at 0 and, when it reports ready, applies
    // the handoff seek (web-player.tsx `applyPendingSeekIfNeeded`).
    let element = 0;
    if (handoff > 0) element = handoff;
    // Play: the element plays from where it is.
    return { barShows: store.position, playsFrom: element, status: store.status };
};

test('stopping_a_station_gives_the_queue_back_at_its_position', () => {
    const after = walk(63.1);
    assert.equal(after.playsFrom, 63.1, 'the queue starts at 0 s after the station');
    assert.equal(after.barShows, 63.1, "the bar loses the queue's position");
    assert.equal(after.status, 'paused');
    // At 0 s there is nothing to hand over.
    assert.deepEqual(radioStopPlan(0), { handoffSeekSec: -1, queue: 'pause' });
});

test('the_radio_store_stops_by_the_plan', () => {
    const store = readFileSync(new URL('../hooks/use-radio-player.ts', import.meta.url), 'utf8');
    const at = store.indexOf('stop: () => {');
    const stop = store.slice(at, store.indexOf('\n    },\n', at));
    assert.match(stop, /radioStopPlan\(/, 'the radio stop resets the queue');
    assert.match(stop, /playerHandoff\.pendingLocalSeek = plan\.handoffSeekSec/);
});
