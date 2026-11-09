import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

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
 * stand-in for handleDo shaped as use-hub's is (read 2026-11-09): a load whose outcome is never
 * proven ends at 8.5 s; a pause is applied at once. What it does not reach: the player, the
 * stores and the hub.
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

test('aPauseIsNotHeldBehindALoadsProofOfPlayback', async () => {
    const applied: { at: number; cmd: string }[] = [];
    const ended: { at: number; cmd: string }[] = [];
    const run = createDirectiveRunner<{ cmd: string }, string>({
        fallback: 'echo',
        onError: () => {},
    });
    const handle = async (msg: { cmd: string }): Promise<string> => {
        applied.push({ at: Date.now(), cmd: msg.cmd });
        if (msg.cmd === 'load') {
            // awaitLoadOutcome, never proven: the deadline ends it.
            await new Promise((r) => setTimeout(r, OUTCOME_BUDGET_MS));
        }
        return 'echo';
    };
    void run({ cmd: 'load' }, handle, () => ended.push({ at: Date.now(), cmd: 'load' }));
    await advance(100);
    void run({ cmd: 'pause' }, handle, () => ended.push({ at: Date.now(), cmd: 'pause' }));
    await advance(10_000);
    const pause = applied.find((a) => a.cmd === 'pause');
    assert.ok(pause, 'the pause ran');
    assert.ok(pause.at - 100 < 500, `the pause waited ${pause.at - 100} ms behind the load`);
});
