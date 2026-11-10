import assert from 'node:assert/strict';
import test from 'node:test';

import {
    createStartupSeek,
    engineTakesSeekNow,
    setEngineSeekProbe,
} from '../../player/hooks/startup-seek.ts';
import { armSeekStep, sameQueueLoadStep, seekDirectiveStep } from '../utils/arm-seek.ts';

/**
 * B-339:  node --test src/renderer/features/hub/hooks/startup-seek.harness.ts
 *
 * A fresh start, replayed in the order watched over the debug port on 2026-11-07 (packaged
 * 0.5.0): the persisted queue hydrates and use-queue-restore arms its startup seek (where this
 * device closed); the hub's orphaned-session adopt takes the `align` path at t (same track
 * current) and calls armSeek; the web player mounts at t+5 ms; the user presses play (first
 * PLAYING). A seek sent to the web engine before it is up goes to a null ref and is dropped
 * (web-player-engine's `player1Ref.current?.seekTo`); the mpv, DLNA and jukebox engines take a
 * seek at any time. `writes` is the seeks this model of the engine accepts.
 *
 * What it drives: the real `createStartupSeek`, `armSeekStep` and `engineTakesSeekNow`. What it
 * does not reach: the hooks' wiring (use-hub's armSeek, useInitialTimestampRestore's effects),
 * `retargetStartupSeek`'s read of the player store, the 100 ms timer before the startup seek is
 * sent, the playback-type setting read, and the web engine's own ready flags. The model's
 * `engine.ready` is both what the probe returns and what decides whether a seek lands, so a probe
 * that disagrees with the real element would pass here; only the walk (F3) sees the element.
 */

const HUB_SEC = 86.683; // the hub's positionMs 86683, as seen in B-339
const CLOSED_SEC = 80.2; // where this device was when it closed (the persisted timestamp)

const startup = (
    current = { index: 3, uniqueId: 'u3' },
    kind: 'mpv' | 'web' = 'web', // mpv stands for every engine but the web player
) => {
    const seek = createStartupSeek();
    const engine = { ready: kind !== 'web' };
    const writes: number[] = [];
    const pending: Array<{ index: number; pause: boolean; sec: number }> = [];
    const shown: number[] = [];
    // Only the web engine registers a probe (web-player-engine.tsx).
    setEngineSeekProbe(kind === 'web' ? () => engine.ready : null);

    // web-player.tsx onPlayerSeekToTimestamp -> the ReactPlayer ref; null before the mount.
    const engineSeek = (sec: number) => {
        if (engine.ready) writes.push(sec);
    };

    const armSeek = (targetIndex: number, sec: number) =>
        armSeekStep(targetIndex, sec, true, {
            armPending: (index, at, pause) => pending.push({ index, pause, sec: at }),
            currentIndex: current.index,
            engineTakesSeek: engineTakesSeekNow(kind === 'web'),
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

    const played: number[] = [];
    const deps = () => ({
        armPending: (index: number, at: number, pause: boolean) =>
            pending.push({ index, pause, sec: at }),
        currentIndex: current.index,
        engineTakesSeek: engineTakesSeekNow(kind === 'web'),
        pauseSoon: () => {},
        playByIndex: (index: number) => played.push(index),
        retargetStartupSeek: (at: number) => seek.retarget(at, current.uniqueId),
        seekNow: (at: number) => {
            shown.push(at);
            engineSeek(at);
        },
        showPosition: (at: number) => shown.push(at),
        withdrawStartupSeek: () => seek.withdraw(),
    });
    // B-348: use-hub's `load` of the queue already here, and its `seek` directive.
    const load = (targetIndex: number, sec: number, pause = false) =>
        sameQueueLoadStep(targetIndex, sec, pause, deps());
    const seekTo = (sec: number) => seekDirectiveStep(sec, deps());

    return { armSeek, current, engine, load, pending, played, playing, seek, seekTo, shown, writes };
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
    assert.equal(engineTakesSeekNow(true), false);
    setEngineSeekProbe(() => {
        throw new Error('unmounted');
    });
    assert.equal(engineTakesSeekNow(true), false);
    setEngineSeekProbe(null);
});

test('nonWebEngineAlignSeeksAtOnce', () => {
    // mpv (and DLNA, jukebox): no probe, and a seek reaches it at any time, as on the base.
    const s = startup({ index: 3, uniqueId: 'u3' }, 'mpv');
    s.seek.arm(CLOSED_SEC, 'u3');
    assert.equal(s.armSeek(3, HUB_SEC), 'seeked');
    assert.deepEqual(s.writes, [HUB_SEC], 'sought at once');
    assert.equal(engineTakesSeekNow(false), true, 'every engine but the web player is up');
    s.playing();
    assert.deepEqual(s.writes, [HUB_SEC], 'the startup seek was withdrawn');
});

test('nonWebEngineMidSessionSeeksAtOnce', () => {
    // The review's run: closed at 0 s, played, then a same-track align (the phone force-stopped,
    // play pressed here). The seek goes to the engine now; nothing waits for a later PLAYING.
    const s = startup({ index: 3, uniqueId: 'u3' }, 'mpv');
    s.seek.arm(0, 'u3');
    s.playing();
    assert.equal(s.armSeek(3, HUB_SEC), 'seeked');
    assert.deepEqual(s.writes, [HUB_SEC]);
    s.playing();
    assert.deepEqual(s.writes, [HUB_SEC], 'no late jump on the next PLAYING');
});

test('retargetAfterFirstPlayWithNothingArmedSeeks', () => {
    // Closed at 0 s: nothing to restore. The first PLAYING closes the startup seek, so a later
    // same-track align while the web player is not up (remounted after the radio, say) seeks as
    // the base did, instead of arming a seek for some later PLAYING.
    const s = startup();
    s.seek.arm(0, 'u3');
    s.engine.ready = true;
    s.playing();
    assert.deepEqual(s.writes, []);
    s.engine.ready = false;
    assert.equal(s.seek.retarget(HUB_SEC, 'u3'), false, 'no startup seek pending');
    assert.equal(s.armSeek(3, HUB_SEC), 'seeked');
    s.engine.ready = true;
    s.playing();
    assert.deepEqual(s.writes, [], 'no seek carried to a later PLAYING');
});

test('retargetIsFalseOnceAppliedOrWithdrawn', () => {
    const applied = startup();
    applied.seek.arm(CLOSED_SEC, 'u3');
    applied.engine.ready = true;
    applied.playing();
    assert.deepEqual(applied.writes, [CLOSED_SEC]);
    assert.equal(applied.seek.retarget(HUB_SEC, 'u3'), false, 'applied');

    const withdrawn = startup();
    withdrawn.seek.arm(CLOSED_SEC, 'u3');
    withdrawn.seek.withdraw();
    assert.equal(withdrawn.seek.retarget(HUB_SEC, 'u3'), false, 'withdrawn');
});

test('alignBeforeMountClosedAtZeroLandsAtHubPosition', () => {
    // Closed at 0 s, the hub at 86.683 s: until the first PLAYING the startup seek ("start where
    // this device closed", 0 s) is still the one the first play carries, so it takes the hub's.
    const s = startup();
    s.seek.arm(0, 'u3');
    assert.equal(s.armSeek(3, HUB_SEC), 'retargeted');
    s.engine.ready = true;
    s.playing();
    assert.deepEqual(s.writes, [HUB_SEC]);
});

/**
 * B-348: a hub `load` of the queue already here (same queue, same row) or a `seek`, before the web
 * player has mounted at a fresh start. Both used to withdraw the startup seek and seek the engine
 * directly, past armSeekStep's engine gate: the seek went to a null ref and the restore seek was
 * gone, so the first play started at 0 s (or the closed position) instead of the hub's.
 */
test('sameRowLoadBeforeMountLandsAtHubPosition', () => {
    const s = startup();
    s.seek.arm(CLOSED_SEC, 'u3');
    assert.equal(s.load(3, HUB_SEC), 'retargeted');
    s.engine.ready = true;
    s.playing();
    assert.deepEqual(s.writes, [HUB_SEC]);
});

test('seekDirectiveBeforeMountLandsAtItsPosition', () => {
    const s = startup();
    s.seek.arm(CLOSED_SEC, 'u3');
    assert.equal(s.seekTo(HUB_SEC), 'retargeted');
    s.engine.ready = true;
    s.playing();
    assert.deepEqual(s.writes, [HUB_SEC]);
});

test('loadAndSeekAfterMountSeekAtOnce', () => {
    const s = startup();
    s.seek.arm(CLOSED_SEC, 'u3');
    s.engine.ready = true;
    assert.equal(s.load(3, HUB_SEC), 'seeked');
    assert.equal(s.seekTo(120), 'seeked');
    assert.deepEqual(s.writes, [HUB_SEC, 120]);
    s.playing();
    assert.deepEqual(s.writes, [HUB_SEC, 120], 'the startup seek was withdrawn');
});

test('loadToAnotherRowArmsAndChangesRow', () => {
    const s = startup({ index: 2, uniqueId: 'u2' });
    s.seek.arm(CLOSED_SEC, 'u2');
    assert.equal(s.load(3, HUB_SEC, true), 'pending');
    assert.deepEqual(s.pending, [{ index: 3, pause: true, sec: HUB_SEC }]);
    assert.deepEqual(s.played, [3]);
    s.engine.ready = true;
    s.playing();
    assert.deepEqual(s.writes, [], 'the startup seek is withdrawn: the row changed');
});
