import assert from 'node:assert/strict';
import test from 'node:test';

import type { StationResult } from '../../../../shared/types/station-types.ts';

import { latchesAutoDj } from './station-logic.ts';

/**
 * B-268 (Phase B, W7):
 *   node --test src/renderer/features/player/station/latch-fallback.harness.ts
 *
 * A failed `station/start` or `next` latches the whole engine to Auto DJ for 60 s, and the queue's
 * station chips go with it. Only an answer that says the engine cannot serve (PROTOCOL §18: `503
 * {fallback: true}`, no tier answered or stations disabled) may do that. The hub's own pool being
 * full is `503 {fallback: true, busy: true}` (§18.4); the hub's `_tier2_verdict` says that "says
 * nothing about AudioMuse", so it must not flip every desktop's autoplay for a minute.
 */

const failed = (extra: Partial<StationResult<unknown>>): StationResult<unknown> => ({
    data: null,
    error: 'x',
    ok: false,
    status: 503,
    ...extra,
});

test('the_hubs_busy_503_does_not_latch_auto_dj', () => {
    assert.equal(
        latchesAutoDj({ ...failed({ fallback: true }), busy: true } as StationResult<unknown>),
        false,
    );
});

test('no_tier_answered_latches_auto_dj', () => {
    assert.equal(latchesAutoDj(failed({ fallback: true })), true);
});

test('answers_that_say_nothing_about_the_engine_do_not_latch', () => {
    // A 503 with no `fallback` is not the station engine's answer (a proxy in front, the §14 pool).
    assert.equal(latchesAutoDj(failed({})), false);
    assert.equal(latchesAutoDj(failed({ code: 'seed_unknown', status: 404 })), false);
    assert.equal(latchesAutoDj(failed({ status: 0 })), false);
    assert.equal(latchesAutoDj({ data: {}, error: '', ok: true, status: 200 }), false);
});
