import assert from 'node:assert/strict';
import test from 'node:test';

import type { AdoptClaimState, PlayRequest } from './play-request.ts';
import type { PlayheadRun } from './playhead-run.ts';

import {
    adoptClaimDelay,
    isGuardOpen,
    isRunaway,
    lastPlayRequest,
    notePauseRequest,
    notePlayRequest,
    resetPlayRequests,
} from './play-request.ts';
import { isPlayheadRolling, notePlayheadStep } from './playhead-run.ts';

/**
 * B-058:  node --test src/renderer/features/hub/utils/play-request.harness.ts
 *
 * use-hub's three guards against a runaway, replayed over a timeline (ms from the load/adopt):
 *   - the armed-seek re-check: a paused load's pendingSeek fires at the song change + 150 ms, and
 *     re-checks 1200 ms later -> `hardPause('armed seek, 1200 ms re-check')`. Armed at
 *     `pendingSeek.armedAt`, i.e. the load (the adopt's `load` path arms one too);
 *   - the adopt's 400 ms re-check -> `hardPause('adopt, 400 ms re-check')`;
 *   - the adopt window: every progress event for 3 s -> `hardPause('adopt guard, progress watchdog')`.
 * "Rolling" is use-hub's audioIsRolling(): the store reads PLAYING, or the engine's own ticks
 * (web engine, every 250 ms) make a playhead run (playhead-run.ts, the real thing). Plays and
 * pauses are marked through the real module, in time order, and every check reads
 * lastPlayRequest() as use-hub does.
 */

interface Segment {
    /** The engine starts advancing at this ms... */
    from: number;
    /**
     * ...with the player store reading PLAYING (a requested play, or mpv's own `resumed` echo -
     * a startup auto-resume) or PAUSED (a load whose play() beat its pause).
     */
    store: 'paused' | 'playing';
    /** ...and stops at this ms (never, if absent). */
    to?: number;
}

interface Timeline {
    /** An orphaned-session adopt (the `load` path) armed its guards at this ms. */
    adoptAt?: number;
    audio?: Segment[];
    /** A paused hub load (do:load play=false) armed its seek at this ms; the song changes then. */
    pausedLoadAt?: number;
    /** Pauses somebody asked for, marked at their source. */
    pauses?: number[];
    /** Plays somebody asked for, marked at their source. */
    plays?: PlayRequest[];
}

const TICK_MS = 250;
const END_MS = 6000;
const ADOPT_GUARD_MS = 3000;

/** The engine advancing from `from` (until `to`), the store reading `store`. */
const rolls = (from: number, store: Segment['store'], to?: number): Segment => ({
    from,
    store,
    to,
});

/** The first hardPause the three guards make over the timeline, or null. */
const firstGuardPause = (tl: Timeline): null | { at: number; why: string } => {
    resetPlayRequests();
    const segments = tl.audio ?? [];
    const ticks: number[] = [];
    for (const seg of segments) {
        for (let at = seg.from + TICK_MS; at <= (seg.to ?? END_MS); at += TICK_MS) ticks.push(at);
    }
    ticks.sort((a, b) => a - b);
    /** The playhead at `at`: 30 s plus every ms the engine has advanced so far. */
    const playheadSec = (at: number) =>
        30 +
        segments.reduce(
            (ms, seg) => ms + Math.max(0, Math.min(at, seg.to ?? Infinity) - seg.from),
            0,
        ) /
            1000;
    const rollingAt = (t: number) => {
        const storePlaying = segments.some(
            (seg) => seg.store === 'playing' && seg.from <= t && t < (seg.to ?? Infinity),
        );
        let run: null | PlayheadRun = null;
        let prev = 30;
        for (const at of ticks) {
            if (at > t) break;
            const sec = playheadSec(at);
            run = notePlayheadStep(run, prev, sec, at);
            prev = sec;
        }
        return storePlaying || isPlayheadRolling(run, t);
    };

    // Marks sort before checks at the same ms (`order`), and apply to the module.
    type Event = { at: number; order: number; run: (t: number) => null | string };
    const events: Event[] = [];
    for (const play of tl.plays ?? []) {
        events.push({
            at: play.at,
            order: 0,
            run: () => (notePlayRequest(play.source, play.at), null),
        });
    }
    for (const at of tl.pauses ?? []) {
        events.push({ at, order: 0, run: () => (notePauseRequest(at), null) });
    }
    const check = (at: number, run: Event['run']) => events.push({ at, order: 1, run });
    const armedSeek = (armedAt: number) =>
        check(armedAt + 150 + 1200, (t) =>
            isRunaway(rollingAt(t), armedAt, lastPlayRequest())
                ? 'armed seek, 1200 ms re-check'
                : null,
        );
    if (tl.pausedLoadAt !== undefined) armedSeek(tl.pausedLoadAt);
    if (tl.adoptAt !== undefined) {
        const guard = { armedAt: tl.adoptAt, until: tl.adoptAt + ADOPT_GUARD_MS };
        check(tl.adoptAt + 400, (t) =>
            isRunaway(rollingAt(t), guard.armedAt, lastPlayRequest())
                ? 'adopt, 400 ms re-check'
                : null,
        );
        armedSeek(tl.adoptAt);
        for (const at of ticks) {
            check(at, (t) =>
                isGuardOpen(guard, t, lastPlayRequest()) && rollingAt(t)
                    ? 'adopt guard, progress watchdog'
                    : null,
            );
        }
    }
    events.sort((a, b) => a.at - b.at || a.order - b.order);
    let result: null | { at: number; why: string } = null;
    for (const event of events) {
        const why = event.run(event.at);
        if (why) {
            result = { at: event.at, why };
            break;
        }
    }
    resetPlayRequests();
    return result;
};

const user = (at: number): PlayRequest => ({ at, source: 'user' });
const hub = (at: number): PlayRequest => ({ at, source: 'hub' });

// --- The incident (2026-10-03 17:46:19Z, transfer t3 -> Worbus for desktop @ index 43, 35707 ms) -----

test('B-058: a play pressed ~0.16 s after a paused transfer is not paused by the re-check', () => {
    // Song change at 17:46:20.357 (= the hardPause at 21.707 - 1350 ms). The play's unpause
    // scrobble at 20.514 (+157 ms); the run the hardPause logged began 937 ms before it (+413).
    const tl: Timeline = { audio: [rolls(413, 'playing')], pausedLoadAt: 0, plays: [user(157)] };
    assert.equal(firstGuardPause(tl), null);
});

test('B-058: a play pressed anywhere inside the 1.35 s re-check window is not paused', () => {
    for (const at of [1, 300, 600, 900, 1200, 1340]) {
        const tl: Timeline = {
            audio: [rolls(at + 40, 'playing')],
            pausedLoadAt: 0,
            plays: [user(at)],
        };
        assert.equal(firstGuardPause(tl), null, `play pressed at +${at} ms`);
    }
});

test("B-058: the hub's do:play inside hubDrivenUntil plays (a controller elsewhere asked)", () => {
    // The re-check runs inside hubDrivenUntil by construction (the song change re-arms it for
    // 2 s and the re-check fires at +1350), so that window cannot protect a do:play - the mark can.
    const tl: Timeline = { audio: [rolls(740, 'playing')], pausedLoadAt: 0, plays: [hub(700)] };
    assert.equal(firstGuardPause(tl), null);
});

test("B-058: a newer do:load that plays is not paused by the older paused load's re-check", () => {
    const tl: Timeline = { audio: [rolls(850, 'playing')], pausedLoadAt: 0, plays: [hub(800)] };
    assert.equal(firstGuardPause(tl), null);
});

// --- The runaways the re-check is for: still caught -----------------------------------------

test('a paused load whose play() lands after its pause is still paused by the re-check', () => {
    // Store PAUSED (setQueue's PLAYING, then the pause), engine advancing anyway.
    const tl: Timeline = { audio: [rolls(50, 'paused')], pausedLoadAt: 0 };
    assert.deepEqual(firstGuardPause(tl), { at: 1350, why: 'armed seek, 1200 ms re-check' });
});

test("mpv's resumed echo after a paused load (store PLAYING, nobody asked) is still paused", () => {
    const tl: Timeline = { audio: [rolls(300, 'playing')], pausedLoadAt: 0 };
    assert.deepEqual(firstGuardPause(tl), { at: 1350, why: 'armed seek, 1200 ms re-check' });
});

test('a play requested BEFORE the paused load does not excuse audio after it (the load is newer)', () => {
    // Pressed play, then the hub's paused transfer arrived; the old play's engine start lands late.
    const tl: Timeline = { audio: [rolls(50, 'paused')], pausedLoadAt: 0, plays: [user(-500)] };
    assert.deepEqual(firstGuardPause(tl), { at: 1350, why: 'armed seek, 1200 ms re-check' });
});

// --- The adopt guard (Q-051's leftover) ------------------------------------------------------

test('B-058: a play pressed within 3 s of an adopt is not paused', () => {
    for (const at of [50, 200, 390, 1000, 1500, 2500, 2990]) {
        const tl: Timeline = { adoptAt: 0, audio: [rolls(at + 40, 'playing')], plays: [user(at)] };
        assert.equal(firstGuardPause(tl), null, `play pressed at +${at} ms`);
    }
});

test('a startup auto-resume after an adopt (mpv echo, store PLAYING, nobody asked) is still paused', () => {
    // Its first progress event at +350 trips the window; one that starts later meets the re-check.
    const early: Timeline = { adoptAt: 0, audio: [rolls(100, 'playing')] };
    assert.deepEqual(firstGuardPause(early), { at: 350, why: 'adopt guard, progress watchdog' });
    const later: Timeline = { adoptAt: 0, audio: [rolls(200, 'playing')] };
    assert.deepEqual(firstGuardPause(later), { at: 400, why: 'adopt, 400 ms re-check' });
});

test('an auto-resume landing late in the adopt window is still caught by the watchdog', () => {
    const tl: Timeline = { adoptAt: 0, audio: [rolls(1800, 'playing')] };
    assert.deepEqual(firstGuardPause(tl), { at: 2050, why: 'adopt guard, progress watchdog' });
});

test('a runaway under a paused store after an adopt is still caught inside the window', () => {
    const tl: Timeline = { adoptAt: 0, audio: [rolls(500, 'paused')] };
    const pause = firstGuardPause(tl);
    assert.ok(pause && pause.at < ADOPT_GUARD_MS, JSON.stringify(pause));
});

test('a play requested before the adopt does not excuse a runaway after it', () => {
    const tl: Timeline = { adoptAt: 0, audio: [rolls(200, 'playing')], plays: [user(-300)] };
    assert.deepEqual(firstGuardPause(tl), { at: 400, why: 'adopt, 400 ms re-check' });
});

// --- Fix round 1: a later pause withdraws the play ---------------------------------------------

test('play, pause, then a runaway inside the adopt window: the window reopens and catches it', () => {
    // Pressed play at +300 and pause at +1000; mpv's echo starts the engine again at +1500.
    const tl: Timeline = {
        adoptAt: 0,
        audio: [rolls(340, 'playing', 1000), rolls(1500, 'playing')],
        pauses: [1000],
        plays: [user(300)],
    };
    assert.deepEqual(firstGuardPause(tl), { at: 1750, why: 'adopt guard, progress watchdog' });
});

test("play, pause, then a runaway before a paused load's re-check: the re-check catches it", () => {
    const tl: Timeline = {
        audio: [rolls(240, 'playing', 700), rolls(900, 'playing')],
        pausedLoadAt: 0,
        pauses: [700],
        plays: [user(200)],
    };
    assert.deepEqual(firstGuardPause(tl), { at: 1350, why: 'armed seek, 1200 ms re-check' });
});

test('play, pause, play again: the newer play is honoured', () => {
    const adopt: Timeline = {
        adoptAt: 0,
        audio: [rolls(340, 'playing', 1000), rolls(1240, 'playing')],
        pauses: [1000],
        plays: [user(300), user(1200)],
    };
    assert.equal(firstGuardPause(adopt), null, 'adopt');
    const load: Timeline = {
        audio: [rolls(240, 'playing', 700), rolls(940, 'playing')],
        pausedLoadAt: 0,
        pauses: [700],
        plays: [user(200), user(900)],
    };
    assert.equal(firstGuardPause(load), null, 'paused load');
});

test('a play with no pause after it stays honoured for the whole window', () => {
    const tl: Timeline = { adoptAt: 0, audio: [rolls(340, 'playing')], plays: [user(300)] };
    assert.equal(firstGuardPause(tl), null);
});

// --- Fix round 1: claiming the session for a play inside an adopt's hub-driven window ----------
//
// publishQueue returns early inside hubDrivenUntil (the adopt arms it, its song change re-arms it
// for 2 s), and after that nothing republishes until the next track, so the hub would show no
// active device while this desktop plays. use-hub retries the publish once the window lapses -
// only for a play asked for since the adopt, while still playing and still orphaned.

const claim = (patch: Partial<AdoptClaimState>): null | number =>
    adoptClaimDelay({
        adopt: { armedAt: 0, until: 3000 },
        hubDrivenUntil: 2000,
        now: 700,
        orphaned: true,
        playing: true,
        request: user(650),
        ...patch,
    });

test('a play asked for inside the adopt window claims once hubDrivenUntil lapses', () => {
    assert.equal(claim({}), 2000 - 700 + 50);
});

test('a window re-armed before the retry: asked again after the try, it waits out the new end', () => {
    // use-hub re-asks after each publishQueue; the first try at 2050 met a window re-armed to 4100.
    assert.equal(claim({ hubDrivenUntil: 4100, now: 2050 }), 4100 - 2050 + 50);
});

test('nothing is claimed for audio nobody asked for, or a play from before the adopt', () => {
    assert.equal(claim({ request: null }), null, 'a runaway / startup auto-resume');
    assert.equal(claim({ request: user(-100) }), null, 'asked before the adopt');
    assert.equal(claim({ request: user(0) }), null, 'same ms as the adopt');
    assert.equal(
        claim({ hubDrivenUntil: 5000, now: 3300, request: user(3200) }),
        null,
        'asked after the adopt window',
    );
});

test('nothing is claimed when publishQueue can already claim, or there is nothing to claim', () => {
    assert.equal(claim({ now: 2000 }), null, 'hubDrivenUntil already lapsed: publishQueue ran');
    assert.equal(claim({ playing: false }), null, 'not playing');
    assert.equal(claim({ orphaned: false }), null, 'a device holds the session');
});

test('a play paused again before the retry withdraws the claim', () => {
    resetPlayRequests();
    notePlayRequest('user', 650);
    notePauseRequest(900);
    assert.equal(claim({ now: 950, request: lastPlayRequest() }), null);
    resetPlayRequests();
});

// --- The decision itself -----------------------------------------------------------------------

test('a guard stands down only for a play requested strictly after it was armed', () => {
    assert.equal(isRunaway(true, 1000, null), true, 'nobody asked');
    assert.equal(isRunaway(true, 1000, user(999)), true, 'asked before the guard');
    assert.equal(isRunaway(true, 1000, user(1000)), true, 'same ms: the guard wins');
    assert.equal(isRunaway(true, 1000, user(1001)), false, 'asked after');
    assert.equal(isRunaway(true, 1000, hub(1001)), false, 'the hub asked after');
    assert.equal(isRunaway(false, 1000, null), false, 'nothing rolling');
});

test('a guard window lapses at its end, or closes early for a play requested inside it', () => {
    const guard = { armedAt: 1000, until: 4000 };
    assert.equal(isGuardOpen(guard, 2000, null), true);
    assert.equal(isGuardOpen(guard, 4000, null), false, 'lapsed');
    assert.equal(isGuardOpen(guard, 2000, user(500)), true, 'asked before it opened');
    assert.equal(isGuardOpen(guard, 2000, user(1500)), false, 'asked inside it');
});

test('the mark keeps the newest play, and a later pause withdraws it', () => {
    resetPlayRequests();
    assert.equal(lastPlayRequest(), null);
    notePlayRequest('hub', 10);
    notePlayRequest('user', 20);
    assert.deepEqual(lastPlayRequest(), { at: 20, source: 'user' });
    notePauseRequest(30);
    assert.equal(lastPlayRequest(), null, 'paused after it');
    notePlayRequest('user', 40);
    assert.deepEqual(lastPlayRequest(), { at: 40, source: 'user' }, 'played again');
    notePauseRequest(40);
    assert.equal(lastPlayRequest(), null, 'a pause in the same ms wins');
    resetPlayRequests();
});
