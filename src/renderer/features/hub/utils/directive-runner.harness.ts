import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

import type { Handled } from './directive-runner.ts';

import { createDirectiveRunner } from './directive-runner.ts';

/**
 * B-111:  node --test src/renderer/features/hub/utils/directive-runner.harness.ts
 *
 * A transfer's `do:load` to this device, then the user presses pause on another device while
 * the engine is still warming up. use-hub's handleDo('load') issues its commands (setQueue,
 * mediaPlay) and then waits for proof that playback started (awaitLoadOutcome: the target
 * track current and the clock advancing) for up to the hub's budget less 1.5 s, 8.5 s, inside
 * runDirective's chain. The pause waits behind it.
 *
 * What it drives: the real runner (directive-runner.ts) on node's mocked clock. `handle` is a
 * stand-in for handleDo shaped as use-hub's is: a load issues its commands, then its outcome (never
 * proven here) ends at 8.5 s; a pause is applied at once. On the base (1d7f56de) handleDo awaited
 * the outcome inside the handler, and this case went red with "the pause waited 8450 ms behind the
 * load"; since the fix the handler hands the outcome back as `later`. What it does not reach: the
 * player, the stores and the hub (use-hub's awaitLoadOutcome and the re-aim are in
 * load-outcome.harness.ts).
 */

const OUTCOME_BUDGET_MS = 8500;

const flush = async () => {
    for (let n = 0; n < 20; n += 1) await Promise.resolve();
};

const advance = async (ms: number) => {
    for (let t = 0; t < ms; t += 50) {
        mock.timers.tick(50);
        await flush();
    }
};

test.beforeEach(() => mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 }));
test.afterEach(() => mock.timers.reset());

const scenario = () => {
    const applied: { at: number; cmd: string }[] = [];
    const ended: { at: number; cmd: string; exit: string }[] = [];
    const errors: string[] = [];
    const run = createDirectiveRunner<{ cmd: string }, string>({
        fallback: 'echo',
        onError: (msg) => errors.push(msg.cmd),
    });
    const handle = async (msg: { cmd: string }): Promise<Handled<string>> => {
        applied.push({ at: Date.now(), cmd: msg.cmd });
        if (msg.cmd === 'load') {
            // Commands issued; awaitLoadOutcome, never proven, ends at the deadline.
            return {
                later: new Promise<string>((r) => setTimeout(() => r('echo'), OUTCOME_BUDGET_MS)),
            };
        }
        if (msg.cmd === 'throws') throw new Error('boom');
        if (msg.cmd === 'loadThatThrowsLater') {
            return {
                later: new Promise<string>((_r, reject) =>
                    setTimeout(() => reject(new Error('late boom')), 1000),
                ),
            };
        }
        return 'echo';
    };
    const send = (cmd: string) =>
        run({ cmd }, handle, (exit) => ended.push({ at: Date.now(), cmd, exit }));
    return { applied, ended, errors, send };
};

test('aPauseIsNotHeldBehindALoadsProofOfPlayback', async () => {
    const { applied, send } = scenario();
    void send('load');
    await advance(100);
    void send('pause');
    await advance(10_000);
    const pause = applied.find((a) => a.cmd === 'pause');
    assert.ok(pause, 'the pause ran');
    assert.ok(pause.at - 100 < 500, `the pause waited ${pause.at - 100} ms behind the load`);
});

test('theLoadStillEndsAtItsOutcome', async () => {
    // I-031: a load's number is applied when it has ENDED, not when its commands left: a
    // report read before the engine started would move the session back to "not playing".
    const { ended, send } = scenario();
    void send('load');
    await advance(100);
    void send('pause');
    await advance(10_000);
    assert.deepEqual(
        ended.map((e) => e.cmd),
        ['pause', 'load'],
    );
    const load = ended.find((e) => e.cmd === 'load');
    assert.ok(load && load.at >= OUTCOME_BUDGET_MS, `the load ended at ${load?.at} ms`);
});

test('directivesAreStillAppliedInArrivalOrder', async () => {
    const { applied, send } = scenario();
    void send('load');
    void send('seek');
    void send('pause');
    void send('play');
    await advance(200);
    assert.deepEqual(
        applied.map((a) => a.cmd),
        ['load', 'seek', 'pause', 'play'],
    );
});

test('aThrowEndsTheDirectiveAndTheChainGoesOn', async () => {
    const { applied, ended, errors, send } = scenario();
    void send('throws');
    void send('loadThatThrowsLater');
    void send('pause');
    await advance(2_000);
    assert.deepEqual(
        applied.map((a) => a.cmd),
        ['throws', 'loadThatThrowsLater', 'pause'],
    );
    assert.deepEqual(
        ended.map((e) => `${e.cmd}:${e.exit}`),
        ['throws:echo', 'pause:echo', 'loadThatThrowsLater:echo'],
    );
    assert.deepEqual(errors, ['throws', 'loadThatThrowsLater']);
});
