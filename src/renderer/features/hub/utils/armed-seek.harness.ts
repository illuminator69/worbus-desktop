import assert from 'node:assert/strict';
import test from 'node:test';

import type { ArmedSeek } from './armed-seek.ts';

import { armedSeekOnTrack, seekOverArmedSeeks } from './armed-seek.ts';

/**
 * B-111 (review finding 1):  node --test src/renderer/features/hub/utils/armed-seek.harness.ts
 *
 * Since B-111 a `do:seek` is applied while a load still waits for its outcome. The load armed a
 * seek to ITS offset, which lands 150 ms after the player reports the new track. A seek applied
 * inside that window was undone when the armed one landed: on a paused transfer the load's proof
 * then waited for the new offset, never got there, and the hub rolled the transfer back.
 *
 * Replays use-hub's order: the load arms (`pendingSeek`), the player reports the track
 * (onCurrentSongChange takes it to `landingSeek`), the hub's seek is applied, and the 150 ms timer
 * seeks to the landing seek's `sec`. Not reached: the player, the timers and the hub.
 */

const TTL = 10_000;

const armed = (sec: number): ArmedSeek => ({ armedAt: 0, index: 2, pause: true, sec });

test('aSeekAppliedWhileTheArmedSeekLandsIsNotUndone', () => {
    let waiting: ArmedSeek | null = armed(120);
    const { keep, land } = armedSeekOnTrack(waiting, 2, 50, TTL);
    waiting = keep;
    assert.ok(land, 'the track is current, so the armed seek lands');
    // The phone seeks to 0:30 while the 150 ms timer runs.
    seekOverArmedSeeks(30, waiting, land);
    assert.equal(land.sec, 30, 'the armed seek put the player back at the load offset');
});

test('aSeekAppliedBeforeTheTrackArrivesMovesTheArmedSeek', () => {
    const waiting = armed(120);
    seekOverArmedSeeks(30, waiting, null);
    const { land } = armedSeekOnTrack(waiting, 2, 50, TTL);
    assert.equal(land?.sec, 30);
    assert.equal(land?.pause, true, 'a seek moves the offset, not the play state');
});

test('anArmedSeekLandsOnItsTrackOnlyAndExpires', () => {
    const waiting = armed(120);
    assert.deepEqual(armedSeekOnTrack(waiting, 1, 50, TTL), { keep: waiting, land: null });
    assert.deepEqual(armedSeekOnTrack(waiting, 2, TTL + 1, TTL), { keep: null, land: null });
    seekOverArmedSeeks(30, null, null); // nothing armed: nothing to move
});
