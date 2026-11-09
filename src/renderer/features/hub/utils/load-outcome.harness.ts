import assert from 'node:assert/strict';
import test from 'node:test';

import type { PlayerLook } from './load-outcome.ts';

import { closeLoad, expectLoad, loadProven, reaimLoad } from './load-outcome.ts';

/**
 * B-111:  node --test src/renderer/features/hub/utils/load-outcome.harness.ts
 *
 * Once a pause no longer waits behind a load (directive-runner.ts), it is applied while the load
 * still waits for its proof. A transfer that asked to play, then paused by the user on another
 * device a second later, leaves a player that is rightly not playing. A proof still waiting for
 * the clock to run would answer `loaded {ok:false}` at the deadline and the hub would roll the
 * transfer back. So each later directive re-aims what the load waits for.
 *
 * What it drives: the real expectation, proof, re-aim and close (load-outcome.ts). What it does
 * not reach: use-hub's polling loop, the stores it reads (`PlayerLook` is given), and the hub.
 */

const look = (patch: Partial<PlayerLook> = {}): PlayerLook => ({
    playing: false,
    positionSec: 0,
    rolling: false,
    rowIndex: 0,
    storeIndex: 0,
    ...patch,
});

test('aPlayingLoadIsProvenByARunningClockOnTheTarget', () => {
    const exp = expectLoad(2, 120, false);
    assert.deepEqual(loadProven(exp, look({ storeIndex: 1 })), { ok: false, onTarget: false });
    assert.deepEqual(loadProven(exp, look({ playing: true, storeIndex: 2 })), {
        ok: false,
        onTarget: true,
    });
    assert.deepEqual(loadProven(exp, look({ playing: true, rolling: true, rowIndex: 2 })), {
        ok: true,
    });
});

test('aPauseDuringAPlayingLoadIsAnsweredOnceSettled', () => {
    const exp = expectLoad(2, 120, false);
    reaimLoad(exp, { cmd: 'pause' });
    assert.deepEqual(loadProven(exp, look({ positionSec: 120.6, storeIndex: 2 })), { ok: true });
    assert.equal(exp.overridden, true, 'its failure must not pause or report over the pause');
});

test('aPlayDuringAPausedLoadWaitsForTheClock', () => {
    const exp = expectLoad(2, 120, true);
    reaimLoad(exp, { cmd: 'play' });
    assert.equal(loadProven(exp, look({ positionSec: 120, storeIndex: 2 })).ok, false);
    assert.equal(loadProven(exp, look({ playing: true, rolling: true, storeIndex: 2 })).ok, true);
});

test('aSeekMovesWhereAPausedLoadMustSettle', () => {
    const exp = expectLoad(2, 120, true);
    reaimLoad(exp, { cmd: 'seek', positionMs: 30_000 });
    assert.equal(loadProven(exp, look({ positionSec: 120, storeIndex: 2 })).ok, false);
    assert.equal(loadProven(exp, look({ positionSec: 30.2, storeIndex: 2 })).ok, true);
    assert.equal(exp.overridden, false, 'a seek leaves the play state the load asked for');
});

test('aJumpMovesTheTargetRow', () => {
    const exp = expectLoad(2, 120, false);
    reaimLoad(exp, { cmd: 'jump', index: 5 });
    assert.equal(loadProven(exp, look({ rolling: true, storeIndex: 2 })).ok, false);
    assert.equal(loadProven(exp, look({ rolling: true, storeIndex: 5 })).ok, true);
});

test('otherDirectivesLeaveItAlone', () => {
    const exp = expectLoad(2, 120, false);
    for (const cmd of ['setRepeat', 'setShuffle', 'queueChanged', 'load', 'release']) {
        reaimLoad(exp, { cmd, index: 9, positionMs: 1 });
    }
    assert.deepEqual(exp, expectLoad(2, 120, false));
});

test('aClearClosesItWithWhatItHadReached', () => {
    const started = expectLoad(2, 120, false);
    closeLoad(started, look({ playing: true, rolling: true, storeIndex: 2 }));
    assert.deepEqual(started.verdict, { ok: true });
    const notYet = expectLoad(2, 120, false);
    closeLoad(notYet, look({ storeIndex: 2 }));
    assert.equal(notYet.verdict?.ok, false);
});
