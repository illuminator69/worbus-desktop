import assert from 'node:assert/strict';
import test from 'node:test';

import {
    createStartupSeek,
    engineTakesSeekNow,
    setEngineSeekProbe,
} from '../../player/hooks/startup-seek.ts';
import { armSeekStep } from '../utils/arm-seek.ts';

/**
 * B-339:  node --test src/renderer/features/hub/hooks/startup-seek.harness.ts
 *
 * A fresh start, replayed in the order watched over the debug port on 2026-11-07 (packaged
 * 0.5.0): the persisted queue hydrates and use-queue-restore arms its startup seek (where this
 * device closed); the hub's orphaned-session adopt takes the `align` path at t (same track
 * current) and calls armSeek; the web player mounts at t+5 ms; the user presses play (first
 * PLAYING). A seek sent to the engine before it is up goes to a null ref and is dropped
 * (web-player-engine's `player1Ref.current?.seekTo`); `writes` is every `currentTime` write the
 * element got.
 */

const HUB_SEC = 86.683; // the hub's positionMs 86683, as seen in B-339
const CLOSED_SEC = 80.2; // where this device was when it closed (the persisted timestamp)

const startup = (current = { index: 3, uniqueId: 'u3' }) => {
    const seek = createStartupSeek();
    const engine = { ready: false };
    const writes: number[] = [];
    const pending: Array<{ index: number; pause: boolean; sec: number }> = [];
    const shown: number[] = [];
    setEngineSeekProbe(() => engine.ready);

    // web-player.tsx onPlayerSeekToTimestamp -> the ReactPlayer ref; null before the mount.
    const engineSeek = (sec: number) => {
        if (engine.ready) writes.push(sec);
    };

    const armSeek = (targetIndex: number, sec: number) =>
        armSeekStep(targetIndex, sec, true, {
            armPending: (index, at, pause) => pending.push({ index, pause, sec: at }),
            currentIndex: current.index,
            engineTakesSeek: engineTakesSeekNow(),
            pauseSoon: () => {},
            retargetStartupSeek: (at) => seek.retarget(at, current.uniqueId),
            seekNow: (at) => {
                shown.push(at);
                engineSeek(at);
            },
            showPosition: (at) => shown.push(at),
            withdrawStartupSeek: () => seek.withdraw(),
        });

    // use-queue-restore's applyStartupSeek: on PLAYING, then mediaSeekToTimestamp 100 ms later
    // (by then the engine is up: the user pressed play on a mounted player).
    const playing = () => {
        const at = seek.takeOnPlaying(current.uniqueId);
        if (at !== null) engineSeek(at);
    };

    return { armSeek, current, engine, pending, playing, seek, shown, writes };
};

test('alignBeforeMountLandsAtHubPosition', () => {
    const s = startup();
    s.seek.arm(CLOSED_SEC, 'u3'); // hydrated: the startup seek is armed
    s.armSeek(3, HUB_SEC); // t: the adopt's align path, engine not mounted
    s.engine.ready = true; // t+5 ms: FilePlayer mounts and reports ready
    s.playing(); // first PLAYING
    assert.equal(s.writes[0], HUB_SEC, 'the first currentTime write is the hub position');
    assert.deepEqual(s.writes, [HUB_SEC]);
    assert.equal(s.shown.at(-1), HUB_SEC, 'the app shows the hub position meanwhile');
});

test('alignAfterMountSeeksAtOnce', () => {
    const s = startup();
    s.seek.arm(CLOSED_SEC, 'u3');
    s.engine.ready = true; // the engine is up before the adopt
    assert.equal(s.armSeek(3, HUB_SEC), 'seeked');
    assert.deepEqual(s.writes, [HUB_SEC], 'seeked at once');
    s.playing();
    assert.deepEqual(s.writes, [HUB_SEC], 'the startup seek was withdrawn');
});

test('differentTrackAdoptUnchanged', () => {
    const s = startup({ index: 2, uniqueId: 'u2' });
    s.seek.arm(CLOSED_SEC, 'u2');
    assert.equal(s.armSeek(3, HUB_SEC), 'pending');
    assert.deepEqual(s.pending, [{ index: 3, pause: true, sec: HUB_SEC }]);
    assert.deepEqual(s.writes, [], 'nothing sought now: the seek waits for the song change');
    s.engine.ready = true;
    s.playing();
    assert.deepEqual(s.writes, [], 'and the startup seek is withdrawn, as before');
});

test('noHubRestoreSeekStillApplies', () => {
    const s = startup();
    s.seek.arm(CLOSED_SEC, 'u3');
    s.engine.ready = true;
    s.playing();
    assert.deepEqual(s.writes, [CLOSED_SEC], 'where this device closed, on first PLAYING');
});

test('oneSeekOnly', () => {
    const s = startup();
    s.seek.arm(CLOSED_SEC, 'u3');
    s.armSeek(3, 85); // two session frames before the mount: the later one wins
    s.armSeek(3, HUB_SEC);
    s.engine.ready = true;
    s.playing();
    s.playing(); // pause and play again
    assert.deepEqual(s.writes, [HUB_SEC], 'no second write after the retargeted one');
    // Once applied there is no startup seek left to retarget: a later align seeks at once.
    assert.equal(s.armSeek(3, 120), 'seeked');
    assert.deepEqual(s.writes, [HUB_SEC, 120]);
});

test('adoptBeforeTheQueueHydratesKeepsHubPosition', () => {
    const s = startup();
    s.armSeek(3, HUB_SEC); // the hub's frame came before use-queue-restore armed
    s.seek.arm(CLOSED_SEC, 'u3');
    s.engine.ready = true;
    s.playing();
    assert.deepEqual(s.writes, [HUB_SEC]);
});

test('alignToAnotherRowKeepsTheSeek', () => {
    // align with the same queue but the hub on another row: setQueue moves to it first, so the
    // song is already the hub's when armSeek runs, and the startup seek follows it.
    const s = startup();
    s.seek.arm(CLOSED_SEC, 'u3');
    s.current.index = 4;
    s.current.uniqueId = 'u4';
    s.armSeek(4, HUB_SEC);
    s.seek.noteCurrentSong('u4'); // use-queue-restore's song-change effect, after the render
    s.engine.ready = true;
    s.playing();
    assert.deepEqual(s.writes, [HUB_SEC]);
});

test('noProbeReadsAsNotUp', () => {
    setEngineSeekProbe(null);
    assert.equal(engineTakesSeekNow(), false);
    setEngineSeekProbe(() => {
        throw new Error('unmounted');
    });
    assert.equal(engineTakesSeekNow(), false);
    setEngineSeekProbe(null);
});
