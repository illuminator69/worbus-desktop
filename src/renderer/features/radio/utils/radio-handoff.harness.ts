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
    const none = radioStopPlan(0);
    assert.deepEqual(
        { handoffSeekSec: none.handoffSeekSec, queue: none.queue },
        {
            handoffSeekSec: -1,
            queue: 'pause',
        },
    );
});

test('the_radio_store_stops_by_the_plan', () => {
    const store = readFileSync(new URL('../hooks/use-radio-player.ts', import.meta.url), 'utf8');
    const at = store.indexOf('stop: () => {');
    const stop = store.slice(at, store.indexOf('\n    },\n', at));
    assert.match(stop, /radioStopPlan\(/, 'the radio stop resets the queue');
    assert.match(stop, /playerHandoff\.pendingLocalSeek = plan\.handoffSeekSec/);
});

test('no_report_says_the_queue_plays_while_a_station_stops', async () => {
    // Fix round 6 (2026-11-12), from the re-walk: stopping a station sent the hub isPlaying=True for
    // ~5 ms. The stop cleared the radio state before pausing the queue, so for one report the
    // store still read PLAYING with no station active: the queue playing, by the hub layer's rule.
    const { queuePlaysHere } = await import('../../hub/utils/queue-playing.ts');
    for (const web of [true, false]) {
        const plan = radioStopPlan(63.1, web);
        let status = 'playing';
        let radio = true;
        const reports: boolean[] = [];
        for (const step of plan.steps) {
            if (step === 'clear') radio = false;
            if (step === 'queue') status = plan.queue === 'pause' ? 'paused' : 'stopped';
            // The hub layer reports on every status change and on every radio change.
            if (step !== 'handoff') reports.push(queuePlaysHere(status, radio));
        }
        assert.deepEqual(reports, [false, false], `web=${web}: a report says the queue plays`);
        // The handoff is written before the radio state clears (that mounts the queue's player).
        assert.ok(plan.steps.indexOf('handoff') < plan.steps.indexOf('clear'));
    }
});

/**
 * B-401 (owner walk, 2026-11-13): after a station FAILS to play, the queue resumes from 0:00.
 * A station whose element fails (a dead stream answers MEDIA_ERR_SRC_NOT_SUPPORTED, which the
 * engine skips as an end; a network failure past its retries pauses) ended the radio through
 * `onEndedPlayer1`, which cleared the radio state by hand: no handoff, and the player store left
 * PLAYING (the station's play set it). The queue's web player then remounted playing, from 0 s.
 * Ended or failed, a station stops by the plan, as the Stop button does.
 */
test('a_station_that_fails_stops_by_the_plan', () => {
    const player = readFileSync(
        new URL('../components/radio-web-player.tsx', import.meta.url),
        'utf8',
    );
    const at = player.indexOf('const onEndedPlayer1');
    const ended = player.slice(at, player.indexOf('}, [', at));
    assert.match(ended, /\bstop\(\)/, 'a failed or ended station clears the radio by hand');
    assert.doesNotMatch(
        ended,
        /setCurrentStreamUrl\(null\)/,
        'the queue comes back playing at 0 s, with no handoff',
    );
    assert.doesNotMatch(
        player,
        /onErrorPause=\{\(\) => \{\}\}/,
        'a station that cannot play after its retries is left playing silence',
    );
});
