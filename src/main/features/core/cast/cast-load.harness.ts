import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

import type { LoadAnswer } from './cast-load.ts';

import { castHelloFrame } from './cast-hello.ts';
import { ACK_RESERVE_MS, createCastLoader } from './cast-load.ts';

/**
 * B-106:  node --test src/main/features/core/cast/cast-load.harness.ts
 *
 * The hub commits a transfer to a cast speaker, sends `do:load {transferId, timeoutMs: 10000}`
 * and rolls the active slot back if no `loaded` matching that id arrives in 10 s (PROTOCOL
 * §7.1-7.2, hub.py `_settle_load_ack`). The receiver must answer inside that budget, reserving
 * time for the ack's own trip, echo the id, and "guarantee that an attempt abandoned on expiry
 * cannot still start playback afterwards". The bridge used to give a LOAD 10 s, then 1.2 s, a
 * fresh session and 10 s more, with no cancel: a speaker slow to answer started playing after
 * the hub had rolled back, audio no client shows as active.
 *
 * What it drives: the real loader (cast-load.ts) and the real cast `hello` frame, against a fake
 * speaker on node's mocked clock. A LOAD the speaker takes starts playing (the bridge sends
 * `autoplay: true` for a playing transfer); a pause after it stops it. What it does not reach:
 * castv2 and the socket (`ensureCast` is a stand-in that answers at once), the hub itself, and
 * the speaker's real answer times (a walk with a speaker: unplug its network mid-transfer).
 */

const BUDGET_MS = 10_000;
const RESERVE_MS = ACK_RESERVE_MS;

interface Speaker {
    /** The media the speaker is playing, by the label of the LOAD that put it there. */
    playing: null | string;
    /** When each LOAD was sent (ms on the mocked clock), and for which load. */
    sent: { at: number; label: string }[];
}

/**
 * A speaker scripted per LOAD, in the order they are sent: answer after `ms` (ok or an error),
 * or `never`. Like a receiver it takes LOADs in order, so an answer never overtakes an earlier
 * one; the media it plays is the last LOAD it took. `pauses` counts the loader's undo of a LOAD
 * that landed for an attempt nobody wanted any more (a pause on that player).
 */
const setup = (script: Array<'never' | { error?: string; ms: number }>) => {
    const speaker: Speaker = { playing: null, sent: [] };
    const frames: { at: number; frame: Record<string, unknown> }[] = [];
    const counts = { pauses: 0 };
    let lastAnswerAt = 0;
    const loader = createCastLoader<Speaker>({
        ensureCast: async () => speaker,
        log: () => {},
        pauseLanded: (target: Speaker) => {
            counts.pauses += 1;
            target.playing = null;
        },
        sendLoaded: (frame) => frames.push({ at: Date.now(), frame }),
        teardown: () => {},
    } as Parameters<typeof createCastLoader<Speaker>>[0]);
    const sender =
        (label: string) =>
        (target: Speaker, answer: LoadAnswer): void => {
            const step = script[target.sent.length] ?? 'never';
            target.sent.push({ at: Date.now(), label });
            if (step === 'never') return;
            const at = Math.max(Date.now() + step.ms, lastAnswerAt + 1);
            lastAnswerAt = at;
            setTimeout(() => {
                if (step.error) {
                    answer(new Error(step.error));
                    return;
                }
                target.playing = label; // autoplay: the speaker starts on its own
                answer(null);
            }, at - Date.now());
        };
    return { counts, frames, loader, sender, speaker };
};

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

test('helloAdvertisesTransferAckV2', () => {
    const hello = castHelloFrame({
        bridgedBy: 'desktop-1',
        castId: 'abc',
        credential: { token: 't' },
        kind: 'speaker',
        name: 'Kitchen',
    });
    assert.ok(hello.device.caps.includes('transferAckV2'));
    assert.ok(hello.device.caps.includes('loadAck'));
});

test('aQuickLoadIsAnsweredWithItsTransferId', async () => {
    const { frames, loader, sender, speaker } = setup([{ ms: 300 }]);
    void loader.hubLoad({ timeoutMs: BUDGET_MS, transferId: 't7' }, sender('load'));
    await advance(1000);
    assert.deepEqual(
        frames.map((f) => f.frame),
        [{ error: undefined, ok: true, t: 'loaded', transferId: 't7' }],
    );
    assert.equal(speaker.playing, 'load');
});

test('aSpeakerThatNeverAnswersIsAnsweredForInsideTheBudget', async () => {
    // The first LOAD is never answered; a second would be answered at once.
    const { frames, loader, sender, speaker } = setup(['never', { ms: 300 }]);
    void loader.hubLoad({ timeoutMs: BUDGET_MS, transferId: 't7' }, sender('load'));
    await advance(15_000);
    assert.equal(frames.length, 1, 'one answer');
    assert.equal(frames[0].frame.ok, false);
    assert.equal(frames[0].frame.transferId, 't7');
    assert.ok(
        frames[0].at <= BUDGET_MS - RESERVE_MS,
        `answered at ${frames[0].at} ms, past the budget less the reserve`,
    );
    const late = speaker.sent.filter((s) => s.at > BUDGET_MS - RESERVE_MS);
    assert.deepEqual(late, [], 'no LOAD is sent once the hub has given up');
    assert.equal(speaker.playing, null, 'nothing plays on a speaker the hub rolled back');
});

test('aLoadThatLandsAfterTheDeadlineIsUndone', async () => {
    // The speaker takes the LOAD at 9.7 s: after the deadline, before the hub's 10 s.
    const { counts, frames, loader, sender, speaker } = setup([{ ms: 9_700 }]);
    void loader.hubLoad({ timeoutMs: BUDGET_MS, transferId: 't7' }, sender('load'));
    await advance(12_000);
    assert.equal(frames.length, 1);
    assert.equal(frames[0].frame.ok, false);
    assert.ok(frames[0].at <= BUDGET_MS - RESERVE_MS);
    assert.equal(counts.pauses, 1, 'the late landing is paused');
    assert.equal(speaker.playing, null);
});

test('aReleaseEndsTheLoadWithoutAnAnswer', async () => {
    // The hub moved the session on (do:release) while the LOAD was out.
    const { frames, loader, sender, speaker } = setup([{ ms: 3_000 }]);
    void loader.hubLoad({ timeoutMs: BUDGET_MS, transferId: 't7' }, sender('load'));
    await advance(1_000);
    loader.release();
    await advance(5_000);
    assert.deepEqual(frames, [], 'the hub is no longer waiting for this one');
    assert.equal(speaker.playing, null, 'released: the late LOAD must not play');
});

test('aJumpDuringATransferLoadAnswersForIt', async () => {
    // The user skips right after the transfer: the jump's LOAD replaces the load's.
    const { counts, frames, loader, sender, speaker } = setup([{ ms: 2_000 }, { ms: 500 }]);
    void loader.hubLoad({ timeoutMs: BUDGET_MS, transferId: 't7' }, sender('load'));
    await advance(500);
    void loader.reload(sender('jump'));
    await advance(5_000);
    assert.equal(frames.length, 1, 'exactly one answer to the transfer');
    assert.equal(frames[0].frame.ok, true);
    assert.equal(frames[0].frame.transferId, 't7');
    assert.equal(counts.pauses, 0, 'a replaced LOAD is not paused: the newer one plays');
    assert.equal(speaker.playing, 'jump');
});

test('aSecondTransferSupersedesTheFirst', async () => {
    // t7's LOAD is slow; the hub transfers again (t8), cancelling its waiter for t7.
    const { counts, frames, loader, sender, speaker } = setup([{ ms: 4_000 }, { ms: 300 }]);
    void loader.hubLoad({ timeoutMs: BUDGET_MS, transferId: 't7' }, sender('t7'));
    await advance(1_000);
    void loader.hubLoad({ timeoutMs: BUDGET_MS, transferId: 't8' }, sender('t8'));
    await advance(6_000);
    assert.deepEqual(
        frames.map((f) => f.frame.transferId),
        ['t8'],
        'only the transfer still pending is answered',
    );
    assert.equal(frames[0].frame.ok, true);
    assert.equal(counts.pauses, 0);
    assert.equal(speaker.playing, 't8');
});

test('aLoadWithNoBudgetKeepsTheOldTimings', async () => {
    // A `do:load` that is no transfer's (no timeoutMs: an older hub, a setQueue on this
    // speaker) has nobody rolling it back: the old 10 s per LOAD, 1.2 s, and one retry.
    const { frames, loader, sender, speaker } = setup(['never', { ms: 300 }]);
    void loader.hubLoad({}, sender('load'));
    await advance(13_000);
    assert.equal(speaker.sent.length, 2);
    assert.equal(speaker.playing, 'load');
    assert.deepEqual(
        frames.map((f) => f.frame.ok),
        [true],
    );
});

// Review finding 3: the reserve was 1.5 s, copied from the renderer, which checks its proof on a
// 100 ms poll. The bridge answers from the LOAD's own callback: one WebSocket frame on the LAN, the
// same few ms the hub's `do:load` took to arrive (its clock started before that trip). A cold
// speaker (LAUNCH + LOAD) that took 9 s used to be answered `ok:true` in time; with 1.5 s kept back
// it was refused at 8.5 s and its LOAD paused when it landed.
test('aColdSpeakerThatStartsAt9sIsAnsweredOk', async () => {
    const { counts, frames, loader, sender, speaker } = setup([{ ms: 9000 }]);
    void loader.hubLoad({ timeoutMs: BUDGET_MS, transferId: 't7' }, sender('load'));
    await advance(12_000);
    assert.deepEqual(
        frames.map((f) => f.frame),
        [{ error: undefined, ok: true, t: 'loaded', transferId: 't7' }],
    );
    assert.ok(frames[0].at < BUDGET_MS, 'inside the hub budget');
    assert.equal(speaker.playing, 'load');
    assert.equal(counts.pauses, 0);
});
