import assert from 'node:assert/strict';
import test from 'node:test';

import type { StationAnswer, StationResult } from '../../../../shared/types/station-types.ts';
import type { AutoplayInput, StationBinding, StationCursor } from './station-logic.ts';

import {
    afterResolving,
    applySessionStationId,
    applyStationFrame,
    artistFallbackQueue,
    artistSeedSongs,
    bindingFromCursor,
    boundByAnotherDevice,
    BUNDLED_CHARACTERS,
    characterFromAny,
    characterLabel,
    charactersOf,
    continueSeedIds,
    customRadioSeeds,
    decideAutoplay,
    EXCLUDE_MAX,
    idsInPlayOrder,
    interleaveSeeds,
    keepResolved,
    LOCAL_BINDING_HOLD_MS,
    LOOKAHEAD_MIN,
    NEXT_COUNT,
    outcomeOf,
    ownArtistSongs,
    parseStationCursor,
    remainingLocal,
    remainingRemote,
    seedsPerArtist,
    spreadPick,
    stationMode,
    takesVariety,
} from './station-logic.ts';

/**
 * I-040:  node --test src/renderer/features/player/station/station-logic.harness.ts
 *
 * The autoplay decision and what each hub answer means (PROTOCOL §18). `decideAutoplay` is asked
 * every time the queue, the current track or the binding changes; `outcomeOf` reads the answer.
 * The two-device cases replay the hub's `after` arbitration with a tiny fake hub that implements
 * §18.1's rule, so what is asserted is this client's half of it: which `after` it sends and what
 * it does with `servedElsewhere`.
 */

const bound = (over: Partial<StationBinding> = {}): StationBinding => ({
    character: 'balanced',
    engine: 'tier2',
    exhausted: false,
    name: 'Cinnamon Girl radio',
    rev: 0,
    seed: { ids: ['seed'], kind: 'track', name: 'Cinnamon Girl' },
    seq: 20,
    stationId: 'st_1',
    ...over,
});

const input = (over: Partial<AutoplayInput> = {}): AutoplayInput => ({
    bound: null,
    driving: true,
    enabled: true,
    inFlight: false,
    isPlaying: true,
    mode: 'stations',
    queueIds: ['a', 'b', 'c'],
    remaining: 1,
    savedQueueId: 'q_1',
    seedIds: ['a', 'b', 'c'],
    ...over,
});

const answer = (over: Partial<StationAnswer> = {}): StationAnswer => ({
    bound: null,
    character: 'balanced',
    engine: 'tier2',
    exhausted: false,
    name: '',
    origin: null,
    partial: false,
    rev: 0,
    seed: null,
    seq: 25,
    servedElsewhere: false,
    stationId: 'st_1',
    stopped: null,
    tracks: [1, 2, 3, 4, 5].map((n) => ({ album: '', artist: '', id: `t${n}`, title: '' })),
    ...over,
});

const ok = (data: StationAnswer): StationResult<StationAnswer> => ({
    data,
    error: '',
    ok: true,
    status: 200,
});

const failure = (status: number, extra: Partial<StationResult<StationAnswer>> = {}) =>
    ({ data: null, error: 'x', ok: false, status, ...extra }) as StationResult<StationAnswer>;

// --- When to ask ------------------------------------------------------------------------------

test('fewer than two left in play order on a station queue: next, after its seq, for five', () => {
    const decision = decideAutoplay(input({ bound: bound(), remaining: 1 }), 'balanced');
    assert.equal(decision.kind, 'next');
    if (decision.kind !== 'next') return;
    assert.equal(decision.body.after, 20);
    assert.equal(decision.body.count, NEXT_COUNT);
    assert.equal(decision.body.stationId, 'st_1');
    assert.deepEqual(decision.body.exclude, ['a', 'b', 'c']);
});

test('the last track playing (none left) asks too', () => {
    assert.equal(decideAutoplay(input({ bound: bound(), remaining: 0 }), 'close').kind, 'next');
});

test('two or more left: nothing is asked', () => {
    const decision = decideAutoplay(input({ bound: bound(), remaining: LOOKAHEAD_MIN }), 'close');
    assert.deepEqual(decision, { kind: 'wait', reason: 'enough' });
});

test('a queue that is not a station: start from the tracks just played, bound to the session', () => {
    const decision = decideAutoplay(input({ seedIds: ['x', 'y', 'z'] }), 'explore');
    assert.equal(decision.kind, 'start');
    if (decision.kind !== 'start') return;
    assert.deepEqual(decision.body.seed, { ids: ['x', 'y', 'z'], kind: 'tracks' });
    assert.equal(decision.body.bindSession, 'q_1');
    assert.equal(decision.body.character, 'explore');
    assert.equal(decision.body.count, NEXT_COUNT);
});

test('a new queue the hub does not hold yet waits for its setQueue before a bound start', () => {
    // Walk W7: a one-track album played over a radio. `savedQueueId` was still the radio's
    // queue, the start asked to bind it, got the radio back as a 409 and continued it.
    assert.deepEqual(decideAutoplay(input({ sessionHoldsQueue: false }), 'balanced'), {
        kind: 'wait',
        reason: 'publishing',
    });
    const held = decideAutoplay(input({ sessionHoldsQueue: true }), 'balanced');
    assert.equal(held.kind, 'start');
    // A station's own queue goes on: its `next` names the station, not the session.
    const next = decideAutoplay(input({ bound: bound(), sessionHoldsQueue: false }), 'balanced');
    assert.equal(next.kind, 'next');
});

test('a continuation is named after the track playing, not after the oldest seed (B-139)', () => {
    const decision = decideAutoplay(
        input({ seedIds: ['x', 'y', 'z'], seedName: 'Take a Picture' }),
        'close',
    );
    assert.equal(decision.kind, 'start');
    if (decision.kind !== 'start') return;
    assert.deepEqual(decision.body.seed, {
        ids: ['x', 'y', 'z'],
        kind: 'tracks',
        name: 'Take a Picture',
    });
});

test('no saved-queue id: start without bindSession (the setQueue that follows binds it)', () => {
    const decision = decideAutoplay(input({ savedQueueId: null }), 'balanced');
    assert.equal(decision.kind, 'start');
    if (decision.kind !== 'start') return;
    assert.equal('bindSession' in decision.body, false);
});

test('an exhausted station stops autoplay: no request at all', () => {
    const decision = decideAutoplay(input({ bound: bound({ exhausted: true }) }), 'balanced');
    assert.deepEqual(decision, { kind: 'wait', reason: 'exhausted' });
});

test('one request in flight: no second one', () => {
    const decision = decideAutoplay(input({ bound: bound(), inFlight: true }), 'balanced');
    assert.deepEqual(decision, { kind: 'wait', reason: 'in-flight' });
});

test('off, unavailable, not driving, paused, nothing to seed from: each waits, and says why', () => {
    assert.deepEqual(decideAutoplay(input({ enabled: false }), 'balanced'), {
        kind: 'wait',
        reason: 'off',
    });
    for (const mode of ['fallback', 'pending'] as const) {
        assert.deepEqual(decideAutoplay(input({ mode }), 'balanced'), {
            kind: 'wait',
            reason: 'unavailable',
        });
    }
    assert.deepEqual(decideAutoplay(input({ driving: false }), 'balanced'), {
        kind: 'wait',
        reason: 'not-driving',
    });
    assert.deepEqual(decideAutoplay(input({ isPlaying: false }), 'balanced'), {
        kind: 'wait',
        reason: 'not-playing',
    });
    assert.deepEqual(decideAutoplay(input({ seedIds: [] }), 'balanced'), {
        kind: 'wait',
        reason: 'no-seed',
    });
});

test('exclude carries at most 1000 distinct ids, the newest ones', () => {
    const ids = Array.from({ length: 1500 }, (_, i) => `s${i}`);
    const decision = decideAutoplay(
        input({ bound: bound(), queueIds: [...ids, 's1499'] }),
        'close',
    );
    assert.equal(decision.kind, 'next');
    if (decision.kind !== 'next') return;
    assert.equal(decision.body.exclude!.length, EXCLUDE_MAX);
    assert.equal(decision.body.exclude![0], 's500');
    assert.equal(decision.body.exclude!.at(-1), 's1499');
});

// --- Play order under shuffle ------------------------------------------------------------------

test('local: remaining counts the play order, which is what player.index walks', () => {
    // Shuffled or not, Worbus for desktop's index is a position in the order being played.
    assert.equal(remainingLocal(8, 10), 1);
    assert.equal(remainingLocal(9, 10), 0);
    assert.equal(remainingLocal(0, 10), 9);
});

test('remote shuffle: the last queue row can be the first one played', () => {
    // Queue of 5, played in the order 4,2,0,3,1. The current queue index 4 is first in play
    // order: four remain, though it is the last row of the queue.
    const order = [4, 2, 0, 3, 1];
    assert.equal(remainingRemote(4, 5, order), 4);
    // Queue index 1 is played last: nothing remains, though rows 2..4 come after it.
    assert.equal(remainingRemote(1, 5, order), 0);
    assert.equal(remainingRemote(3, 5, order), 1);
});

test('remote: no order, or one that does not cover the queue, counts queue order', () => {
    assert.equal(remainingRemote(3, 5, null), 1);
    assert.equal(remainingRemote(3, 7, [4, 2, 0, 3, 1]), 3);
});

test('the continue seed is the current track and up to two before it in play order', () => {
    const playOrder = idsInPlayOrder(['a', 'b', 'c', 'd', 'e'], [4, 2, 0, 3, 1]);
    assert.deepEqual(playOrder, ['e', 'c', 'a', 'd', 'b']);
    assert.deepEqual(continueSeedIds(playOrder, 4), ['a', 'd', 'b']);
    assert.deepEqual(continueSeedIds(playOrder, 0), ['e']);
    assert.deepEqual(continueSeedIds(['a', 'a', 'b'], 2), ['a', 'b']);
});

test('album seeds are spread over the album, first and last included', () => {
    const tracks = Array.from({ length: 12 }, (_, i) => i + 1);
    assert.deepEqual(spreadPick(tracks, 5), [1, 4, 7, 9, 12]);
    assert.deepEqual(spreadPick([1, 2, 3], 5), [1, 2, 3]);
});

// --- An artist radio's seed (B-149, Worbus for Android's `artistSeedSongs`) ---------------------------------

const song = (id: string, albumId: string, playCount: number, artistId = 'oya') => ({
    albumId,
    artists: [{ id: artistId }],
    id,
    playCount,
});

const ids = (songs: readonly { id: string }[]) => songs.map((row) => row.id);

test('artist seed: the most played, one per album before a second from any', () => {
    const songs = [
        song('a1', 'A', 40),
        song('a2', 'A', 30),
        song('a3', 'A', 20),
        song('b1', 'B', 10),
        song('c1', 'C', 5),
        song('d1', 'D', 0),
        song('e1', 'E', 1),
        song('f1', 'F', 2),
    ];
    // Six albums, five seeds: the best song of the five albums with the most played tops.
    assert.deepEqual(ids(artistSeedSongs(songs)), ['a1', 'b1', 'c1', 'f1', 'e1']);
});

test('artist seed: fewer albums than seeds, the rest by plays from any album', () => {
    const songs = [
        song('a1', 'A', 9),
        song('a2', 'A', 8),
        song('a3', 'A', 7),
        song('b1', 'B', 1),
        song('b2', 'B', 6),
    ];
    assert.deepEqual(ids(artistSeedSongs(songs)), ['a1', 'b2', 'a2', 'a3', 'b1']);
});

test('artist seed: equal play counts keep the order given (album order), at most five', () => {
    const songs = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].flatMap((album) => [
        song(`${album}1`, album, 0),
        song(`${album}2`, album, 0),
    ]);
    assert.deepEqual(ids(artistSeedSongs(songs)), ['A1', 'B1', 'C1', 'D1', 'E1']);
    // One song with one play is enough to put it first.
    songs[5] = song('C2', 'C', 1);
    assert.deepEqual(ids(artistSeedSongs(songs)), ['C2', 'A1', 'B1', 'D1', 'E1']);
});

test('artist seed: a single album, a single song, nothing', () => {
    const one = [song('x2', 'X', 3), song('x1', 'X', 5), song('x3', 'X', 0)];
    assert.deepEqual(ids(artistSeedSongs(one)), ['x1', 'x2', 'x3']);
    assert.deepEqual(ids(artistSeedSongs([song('only', 'X', 0)])), ['only']);
    assert.deepEqual(artistSeedSongs([]), []);
    // A song without an album is an album of its own; a missing count is no plays.
    assert.deepEqual(
        ids(
            artistSeedSongs([{ albumId: '', id: 'loose' }, song('x1', 'X', 0), song('x2', 'X', 0)]),
        ),
        ['loose', 'x1', 'x2'],
    );
});

test("artist seed: only the artist's own songs, not a guest spot or someone else's on its album", () => {
    const songs = [
        song('own', 'A', 1),
        song('guest', 'B', 50, 'someone'),
        { albumId: 'C', artists: [{ id: 'someone' }, { id: 'oya' }], id: 'feat', playCount: 30 },
        { albumId: 'D', artists: [], id: 'unnamed', playCount: 0 },
    ];
    assert.deepEqual(ids(ownArtistSongs(songs, 'oya')), ['own', 'unnamed']);
});

test('artist radio without a station: the seeds, then the similar songs in order, cut at the cap', () => {
    const seeds = [{ id: 's1' }, { id: 's2' }];
    const similar = [{ id: 'm1' }, { id: 's2' }, { id: 'm2' }, { id: 'm3' }];
    assert.deepEqual(ids(artistFallbackQueue(seeds, similar)), ['s1', 's2', 'm1', 'm2', 'm3']);
    assert.deepEqual(ids(artistFallbackQueue(seeds, similar, 4)), ['s1', 's2', 'm1', 'm2']);
    assert.deepEqual(ids(artistFallbackQueue([], similar, 2)), ['m1', 's2']);
    // Nothing similar leaves the seeds.
    assert.deepEqual(ids(artistFallbackQueue(seeds, [])), ['s1', 's2']);
});

// --- What an answer means ------------------------------------------------------------------------

test('a batch: append it, and the next after is the seq it answered with', () => {
    const outcome = outcomeOf(ok(answer({ seq: 25 })), bound({ seq: 20 }), 'next');
    assert.equal(outcome.kind, 'append');
    if (outcome.kind !== 'append') return;
    assert.equal(outcome.tracks.length, 5);
    assert.equal(outcome.binding.seq, 25);
    // The name and the seed survive a `next`, which carries neither.
    assert.equal(outcome.binding.name, 'Cinnamon Girl radio');
    assert.deepEqual(outcome.binding.seed, { ids: ['seed'], kind: 'track', name: 'Cinnamon Girl' });
    const again = decideAutoplay(input({ bound: outcome.binding, remaining: 0 }), 'balanced');
    assert.equal(again.kind === 'next' && again.body.after, 25);
});

test('servedElsewhere: adopt the new seq, add nothing, and look again shortly', () => {
    const outcome = outcomeOf(
        ok(answer({ seq: 30, servedElsewhere: true, tracks: [] })),
        bound({ seq: 20 }),
        'next',
    );
    assert.equal(outcome.kind, 'adopt');
    if (outcome.kind !== 'adopt') return;
    assert.equal(outcome.binding.seq, 30);
    assert.equal(outcome.recheck, true);
    assert.equal(outcome.servedElsewhere, true);
});

test('exhausted with nothing: adopt it, no recheck; the next decision stops', () => {
    const outcome = outcomeOf(ok(answer({ exhausted: true, tracks: [] })), bound(), 'next');
    assert.equal(outcome.kind, 'adopt');
    if (outcome.kind !== 'adopt') return;
    assert.equal(outcome.recheck, false);
    assert.equal(outcome.binding.exhausted, true);
    assert.equal(decideAutoplay(input({ bound: outcome.binding }), 'balanced').kind, 'wait');
});

test('exhausted with a last few tracks: append them, then stop', () => {
    const outcome = outcomeOf(
        ok(answer({ exhausted: true, tracks: [{ album: '', artist: '', id: 'z', title: '' }] })),
        bound(),
        'next',
    );
    assert.equal(outcome.kind, 'append');
    if (outcome.kind !== 'append') return;
    assert.equal(outcome.binding.exhausted, true);
});

test('partial with nothing: not exhausted, so it is tried again', () => {
    const outcome = outcomeOf(ok(answer({ partial: true, tracks: [] })), bound(), 'next');
    assert.deepEqual(outcome.kind === 'adopt' && outcome.recheck, true);
    assert.deepEqual(outcome.kind === 'adopt' && outcome.servedElsewhere, false);
});

test('partial with some: append what came, flagged partial', () => {
    const outcome = outcomeOf(
        ok(answer({ partial: true, tracks: [{ album: '', artist: '', id: 'p', title: '' }] })),
        bound(),
        'next',
    );
    assert.equal(outcome.kind === 'append' && outcome.partial, true);
});

test('a start answer becomes the binding, with its name and seed', () => {
    const outcome = outcomeOf(
        ok(
            answer({
                name: 'Your mix',
                seed: { kind: 'yourMix' },
                seq: 5,
                stationId: 'st_new',
            }),
        ),
        null,
        'start',
    );
    assert.equal(outcome.kind, 'append');
    if (outcome.kind !== 'append') return;
    assert.equal(outcome.binding.stationId, 'st_new');
    assert.equal(outcome.binding.name, 'Your mix');
    assert.equal(outcome.binding.seq, 5);
});

test('409 session_bound on start: continue that station', () => {
    assert.deepEqual(
        outcomeOf(failure(409, { code: 'session_bound', stationId: 'st_other' }), null, 'start'),
        { kind: 'continue', stationId: 'st_other' },
    );
});

test('404 station_unknown on next: start again from the seed', () => {
    assert.deepEqual(outcomeOf(failure(404, { code: 'station_unknown' }), bound(), 'next'), {
        kind: 'restart',
    });
});

test('503 is the fallback, whichever call answered it', () => {
    assert.deepEqual(outcomeOf(failure(503, { fallback: true }), null, 'start'), {
        kind: 'fallback',
    });
    assert.deepEqual(outcomeOf(failure(503), bound(), 'next'), { kind: 'fallback' });
});

test('no answer at all (status 0) or a 502: retry shortly', () => {
    assert.deepEqual(outcomeOf(failure(0), bound(), 'next'), {
        kind: 'retry',
        status: 0,
        transient: true,
    });
    assert.deepEqual(outcomeOf(failure(502), bound(), 'next'), {
        kind: 'retry',
        status: 502,
        transient: true,
    });
});

test('a refused seed (404 seed_unknown, 400 bad_seed): wait for the next trigger, not a timer', () => {
    assert.deepEqual(outcomeOf(failure(404, { code: 'seed_unknown' }), null, 'start'), {
        kind: 'retry',
        status: 404,
        transient: false,
    });
    assert.deepEqual(outcomeOf(failure(400, { code: 'bad_seed' }), null, 'start'), {
        kind: 'retry',
        status: 400,
        transient: false,
    });
});

// --- Two devices, one station: the hub's `after` rule, from this side -------------------------------

/** §18.1's arbitration, nothing else: only after == seq computes; the same after from the same
 *  device replays; a lower after from another device is servedElsewhere. */
const fakeHub = () => {
    let seq = 20;
    let last: null | { after: number; device: string; tracks: string[] } = null;
    let served = 0;
    return {
        next(after: number, device: string): StationAnswer {
            if (last && last.after === after && last.device === device) {
                return answer({
                    seq,
                    tracks: last.tracks.map((id) => ({ album: '', artist: '', id, title: '' })),
                });
            }
            if (after < seq) return answer({ seq, servedElsewhere: true, tracks: [] });
            const tracks = Array.from({ length: 5 }, () => `n${(served += 1)}`);
            seq += tracks.length;
            last = { after, device, tracks };
            return answer({
                seq,
                tracks: tracks.map((id) => ({ album: '', artist: '', id, title: '' })),
            });
        },
        get seq() {
            return seq;
        },
    };
};

test('two devices at the queue end together: one batch, and the second adopts its seq', () => {
    const hub = fakeHub();
    let desk = bound({ seq: 20 });
    let phone = bound({ seq: 20 });

    const deskAsk = decideAutoplay(input({ bound: desk }), 'balanced');
    const phoneAsk = decideAutoplay(input({ bound: phone }), 'balanced');
    assert.equal(deskAsk.kind === 'next' && deskAsk.body.after, 20);
    assert.equal(phoneAsk.kind === 'next' && phoneAsk.body.after, 20);

    const deskOutcome = outcomeOf(ok(hub.next(20, 'desk')), desk, 'next');
    const phoneOutcome = outcomeOf(ok(hub.next(20, 'phone')), phone, 'next');
    assert.equal(deskOutcome.kind, 'append');
    assert.equal(phoneOutcome.kind, 'adopt');
    if (deskOutcome.kind !== 'append' || phoneOutcome.kind !== 'adopt') return;
    desk = deskOutcome.binding;
    phone = phoneOutcome.binding;
    assert.equal(desk.seq, 25);
    assert.equal(phone.seq, 25);
    assert.equal(hub.seq, 25);

    // The next top-up, from either, continues from 25: one new batch, not a replay.
    const later = decideAutoplay(input({ bound: phone, remaining: 0 }), 'balanced');
    assert.equal(later.kind === 'next' && later.body.after, 25);
    assert.equal(outcomeOf(ok(hub.next(25, 'phone')), phone, 'next').kind, 'append');
    assert.equal(hub.seq, 30);
});

test('a retry of the same after from the same device replays its batch, the seq unchanged', () => {
    const hub = fakeHub();
    const first = hub.next(20, 'desk');
    const retry = hub.next(20, 'desk');
    assert.deepEqual(
        retry.tracks.map((t) => t.id),
        first.tracks.map((t) => t.id),
    );
    assert.equal(hub.seq, 25);
});

test('just after another device served the station, wait for its batch instead of asking', () => {
    // The frame told this device seq 25, but the 5 tracks behind it are not in the session
    // queue yet: asking with after 25 now would make the hub compute a second batch.
    const decision = decideAutoplay(
        input({ bound: bound({ seq: 25 }), elsewhereRecent: true }),
        'balanced',
    );
    assert.deepEqual(decision, { kind: 'wait', reason: 'served-elsewhere' });
    // Once the grace has passed and the queue is still short, the batch never came: ask.
    assert.equal(
        decideAutoplay(input({ bound: bound({ seq: 25 }), elsewhereRecent: false }), 'balanced')
            .kind,
        'next',
    );
});

test('a station frame tells the other device its new seq before it asks', () => {
    const hub = fakeHub();
    let phone = bound({ seq: 20 });
    hub.next(20, 'desk');
    phone = applyStationFrame(
        phone,
        parseStationCursor({
            character: 'balanced',
            exhausted: false,
            rev: 0,
            seq: hub.seq,
            stationId: 'st_1',
            t: 'station',
        })!,
    )!;
    const ask = decideAutoplay(input({ bound: phone }), 'balanced');
    assert.equal(ask.kind === 'next' && ask.body.after, 25);
});

// --- Frames and the binding ----------------------------------------------------------------

test('a station frame for another station leaves the binding alone', () => {
    const before = bound();
    const after = applyStationFrame(before, {
        character: 'explore',
        exhausted: true,
        rev: 4,
        seq: 99,
        stationId: 'st_other',
    });
    assert.equal(after, before);
});

test('a frame never moves the cursor backwards', () => {
    const after = applyStationFrame(bound({ seq: 30 }), {
        character: 'balanced',
        exhausted: false,
        rev: 1,
        seq: 25,
        stationId: 'st_1',
    });
    assert.equal(after!.seq, 30);
    assert.equal(after!.rev, 1);
});

test('Explore clears exhausted: the frame that follows the character change unblocks autoplay', () => {
    let b = bound({ exhausted: true });
    assert.equal(decideAutoplay(input({ bound: b }), 'balanced').kind, 'wait');
    b = applyStationFrame(b, {
        character: 'explore',
        exhausted: false,
        rev: 1,
        seq: 20,
        stationId: 'st_1',
    })!;
    assert.equal(b.character, 'explore');
    assert.equal(decideAutoplay(input({ bound: b }), 'explore').kind, 'next');
});

test('welcome.station: the cursor plus name and seed', () => {
    const cursor = parseStationCursor({
        character: 'close',
        exhausted: false,
        name: 'Cinnamon Girl radio',
        rev: 2,
        seed: { ids: ['seed'], kind: 'track', name: 'Cinnamon Girl' },
        seq: 25,
        stationId: 'st_1',
    })!;
    const b = bindingFromCursor(cursor, null);
    assert.equal(b.name, 'Cinnamon Girl radio');
    assert.equal(b.seq, 25);
    assert.equal(b.character, 'close');
    assert.deepEqual(b.seed, { ids: ['seed'], kind: 'track', name: 'Cinnamon Girl' });
    assert.equal(parseStationCursor(null), null);
    assert.equal(parseStationCursor({ seq: 1 }), null);
});

test('session.stationId: the hub decides, except just after a change of this client own', () => {
    const cursors: Record<string, StationCursor> = {
        st_2: { character: 'explore', exhausted: false, rev: 0, seq: 10, stationId: 'st_2' },
    };
    // Another device started st_2 on the session: bind to it, from the cursor already heard.
    let r = applySessionStationId({
        bound: bound(),
        cursors,
        incoming: 'st_2',
        localUntil: 0,
        now: 1000,
    });
    assert.equal(r.bound!.stationId, 'st_2');
    assert.equal(r.bound!.seq, 10);
    // An album replaced the queue: unbound.
    r = applySessionStationId({
        bound: r.bound,
        cursors,
        incoming: null,
        localUntil: 0,
        now: 2000,
    });
    assert.equal(r.bound, null);

    // This client just started a radio; a frame from before it still says null. Ignored...
    const mine = bound({ stationId: 'st_mine' });
    const hold = 3000 + LOCAL_BINDING_HOLD_MS;
    r = applySessionStationId({
        bound: mine,
        cursors,
        incoming: null,
        localUntil: hold,
        now: 3100,
    });
    assert.equal(r.bound, mine);
    // ...the echo ends the hold...
    r = applySessionStationId({
        bound: mine,
        cursors,
        incoming: 'st_mine',
        localUntil: hold,
        now: 3200,
    });
    assert.equal(r.localUntil, 0);
    // ...and a hub that disagrees after the hold wins.
    r = applySessionStationId({
        bound: mine,
        cursors,
        incoming: null,
        localUntil: hold,
        now: hold + 1,
    });
    assert.equal(r.bound, null);
});

test('a hub without stations sends no stationId: nothing changes', () => {
    const b = bound();
    const r = applySessionStationId({
        bound: b,
        cursors: {},
        incoming: undefined,
        localUntil: 0,
        now: 1,
    });
    assert.equal(r.bound, b);
});

// --- Which path runs, and the words ------------------------------------------------------------

test('stations only with a connection, the feature, a probe that said available, and no 503', () => {
    const base = {
        available: true,
        connected: true,
        fallbackLatched: false,
        hasFeature: true,
        probed: true,
    };
    assert.equal(stationMode(base), 'stations');
    assert.equal(stationMode({ ...base, connected: false }), 'fallback');
    assert.equal(stationMode({ ...base, hasFeature: false }), 'fallback');
    assert.equal(stationMode({ ...base, fallbackLatched: true }), 'fallback');
    assert.equal(stationMode({ ...base, available: false }), 'fallback');
    assert.equal(stationMode({ ...base, probed: false }), 'pending');
});

test('every stored character name reads as one of the three', () => {
    assert.equal(characterFromAny('EchoMatch'), 'close');
    assert.equal(characterFromAny('echo'), 'close');
    assert.equal(characterFromAny('SteadyVibes'), 'balanced');
    assert.equal(characterFromAny('TransitionMaestro'), 'explore');
    assert.equal(characterFromAny('explore'), 'explore');
    assert.equal(characterFromAny(undefined), 'balanced');
});

// --- Off stops everything, radios included (I-041) ------------------------------------------------

for (const origin of ['radio', 'continue', null] as const) {
    test(`a ${origin ?? 'unknown-origin'} station picked Off (stopped): nothing is asked, On or Off`, () => {
        for (const enabled of [true, false]) {
            assert.deepEqual(
                decideAutoplay(
                    input({ bound: bound({ origin, stopped: true }), enabled }),
                    'close',
                ),
                { kind: 'wait', reason: 'stopped' },
            );
        }
    });
    test(`a ${origin ?? 'unknown-origin'} station not stopped: continued, whatever this device prefers`, () => {
        // Its state is shared: the chip shows its character on every device, so it goes on.
        for (const enabled of [true, false]) {
            assert.equal(
                decideAutoplay(
                    input({ bound: bound({ origin, stopped: false }), enabled }),
                    'close',
                ).kind,
                'next',
            );
        }
    });
}

test('next answered stopped (Off was picked elsewhere): adopt it, nothing to retry, then stop', () => {
    const outcome = outcomeOf(ok(answer({ stopped: true, tracks: [] })), bound(), 'next');
    assert.equal(outcome.kind, 'adopt');
    if (outcome.kind !== 'adopt') return;
    assert.equal(outcome.recheck, false);
    assert.equal(outcome.binding.stopped, true);
    assert.deepEqual(decideAutoplay(input({ bound: outcome.binding }), 'close'), {
        kind: 'wait',
        reason: 'stopped',
    });
});

test('a station frame carries stopped; a frame without it leaves this client own Off standing', () => {
    const frame = (extra: Record<string, unknown>) =>
        parseStationCursor({
            character: 'balanced',
            rev: 1,
            seq: 20,
            stationId: 'st_1',
            ...extra,
        })!;
    assert.equal(applyStationFrame(bound(), frame({ stopped: true }))!.stopped, true);
    assert.equal(
        applyStationFrame(bound({ stopped: true }), frame({ stopped: false }))!.stopped,
        false,
    );
    // An older hub sends no `stopped`: the Off picked here is kept.
    assert.equal(applyStationFrame(bound({ stopped: true }), frame({}))!.stopped, true);
});

test('Autoplay On, a queue no station built: continued as a station, origin continue', () => {
    const decision = decideAutoplay(input({ bound: null, enabled: true }), 'balanced');
    assert.equal(decision.kind, 'start');
    if (decision.kind !== 'start') return;
    assert.equal(decision.body.origin, 'continue');
});

test('Autoplay Off, a queue no station built: never a continuation', () => {
    assert.deepEqual(decideAutoplay(input({ bound: null, enabled: false }), 'balanced'), {
        kind: 'wait',
        reason: 'off',
    });
});

test('the origin the hub echoes on start and next becomes the binding origin', () => {
    const started = outcomeOf(ok(answer({ origin: 'continue', stationId: 'st_c' })), null, 'start');
    assert.equal(started.kind === 'append' && started.binding.origin, 'continue');
    const nexted = outcomeOf(ok(answer({ origin: null })), bound({ origin: 'radio' }), 'next');
    assert.equal(nexted.kind === 'append' && nexted.binding.origin, 'radio');
});

test('a station frame carries origin and name, and the binding takes both', () => {
    const cursor = parseStationCursor({
        character: 'balanced',
        exhausted: false,
        name: 'Video Games radio',
        origin: 'radio',
        rev: 1,
        seq: 30,
        stationId: 'st_1',
        t: 'station',
    })!;
    const b = applyStationFrame(bound({ name: '', origin: null }), cursor)!;
    assert.equal(b.name, 'Video Games radio');
    assert.equal(b.origin, 'radio');
    // A frame without a name (or an empty one) keeps the name already held.
    const kept = applyStationFrame(b, { ...cursor, name: undefined, seq: 35 })!;
    assert.equal(kept.name, 'Video Games radio');
    assert.equal(parseStationCursor({ name: '', seq: 1, stationId: 'x' })!.name, undefined);
});

// --- bound: false -----------------------------------------------------------------------------------

test('asked to bind, answered bound:false: an unbound station, continued from here', () => {
    const outcome = outcomeOf(ok(answer({ bound: false, stationId: 'st_u' })), null, 'start', {
        askedBind: true,
    });
    assert.equal(outcome.kind, 'append');
    if (outcome.kind !== 'append') return;
    assert.equal(outcome.binding.unbound, true);
    // It is continued with next, never started (bound) again.
    const again = decideAutoplay(input({ bound: outcome.binding, remaining: 0 }), 'balanced');
    assert.equal(again.kind, 'next');
});

test('bound:true, or bound:false without asking to bind, is not unbound', () => {
    const yes = outcomeOf(ok(answer({ bound: true })), null, 'start', { askedBind: true });
    assert.equal(yes.kind === 'append' && yes.binding.unbound, false);
    const notAsked = outcomeOf(ok(answer({ bound: false })), null, 'start', { askedBind: false });
    assert.equal(notAsked.kind === 'append' && notAsked.binding.unbound, false);
    const older = outcomeOf(ok(answer({ bound: null })), null, 'start', { askedBind: true });
    assert.equal(older.kind === 'append' && older.binding.unbound, false);
});

test('an unbound station survives a session that names no station, not one that names another', () => {
    const mine = bound({ stationId: 'st_u', unbound: true });
    let r = applySessionStationId({
        bound: mine,
        cursors: {},
        incoming: null,
        localUntil: 0,
        now: 1,
    });
    assert.equal(r.bound, mine);
    r = applySessionStationId({
        bound: mine,
        cursors: {},
        incoming: 'st_other',
        localUntil: 0,
        now: 1,
    });
    assert.equal(r.bound!.stationId, 'st_other');
    // The session naming it after all: it is bound now.
    r = applySessionStationId({
        bound: mine,
        cursors: {},
        incoming: 'st_u',
        localUntil: 0,
        now: 1,
    });
    assert.equal(r.bound!.unbound, false);
});

// --- Tracks this server cannot resolve are dropped ------------------------------------------------

test('unresolved tracks are dropped, the rest keep the served order', () => {
    assert.deepEqual(keepResolved(['a', null, 'c', undefined, 'e']), ['a', 'c', 'e']);
    assert.deepEqual(keepResolved([null, null]), []);
});

test('a batch that resolves to nothing is a partial answer: ask again, append nothing', () => {
    const outcome = outcomeOf(ok(answer({ seq: 25 })), bound({ seq: 20 }), 'next');
    assert.equal(outcome.kind, 'append');
    if (outcome.kind !== 'append') return;
    const none = afterResolving(outcome, 0);
    assert.equal(none.kind, 'adopt');
    if (none.kind !== 'adopt') return;
    assert.equal(none.recheck, true);
    assert.equal(none.servedElsewhere, false);
    // The cursor still moves past the batch, so the retry asks for the NEXT one.
    assert.equal(none.binding.seq, 25);
    assert.equal(afterResolving(outcome, 2), outcome);
});

test('an exhausted batch that resolves to nothing stops rather than asking again', () => {
    const outcome = outcomeOf(ok(answer({ exhausted: true })), bound(), 'next');
    if (outcome.kind !== 'append') return assert.fail('expected append');
    const none = afterResolving(outcome, 0);
    assert.equal(none.kind === 'adopt' && none.recheck, false);
});

// --- S-035: a chip tap does not wait for playback (B-144) ----------------------------------------------

test('paused: autoplay waits, but a chip tap asks now (continuation still only under 2 left)', () => {
    const paused = { isPlaying: false };
    assert.deepEqual(decideAutoplay(input({ ...paused, bound: null }), 'close'), {
        kind: 'wait',
        reason: 'not-playing',
    });
    // The tap: a non-station queue near its end is continued while paused...
    assert.equal(
        decideAutoplay(input({ ...paused, bound: null, ignorePaused: true }), 'close').kind,
        'start',
    );
    // ...but only near its end, as ever.
    assert.deepEqual(
        decideAutoplay(
            input({ ...paused, bound: null, ignorePaused: true, remaining: 4 }),
            'close',
        ),
        { kind: 'wait', reason: 'enough' },
    );
    // A station (no hub edits) is asked for its next batch while paused, too.
    assert.equal(
        decideAutoplay(input({ ...paused, bound: bound(), ignorePaused: true }), 'close').kind,
        'next',
    );
    // And a stopped station or Autoplay off still win over the tap's urgency.
    assert.deepEqual(
        decideAutoplay(
            input({ ...paused, bound: bound({ stopped: true }), ignorePaused: true }),
            'close',
        ),
        { kind: 'wait', reason: 'stopped' },
    );
    assert.deepEqual(
        decideAutoplay(input({ ...paused, enabled: false, ignorePaused: true }), 'close'),
        { kind: 'wait', reason: 'off' },
    );
});

test('a station another device bound to the session is waited for, not topped up at once', () => {
    // Walk W7: Worbus for Android continued an album as a new station; Worbus for desktop, controlling, saw the session
    // bound to it with the queue still one track long and asked `next`: two batches, one top-up.
    assert.equal(boundByAnotherDevice(null, bound(), false), true);
    assert.equal(boundByAnotherDevice(bound({ stationId: 'st_0' }), bound(), false), true);
    // The same station, nothing; unbound, nothing; this client's own request out, its own start.
    assert.equal(boundByAnotherDevice(bound(), bound(), false), false);
    assert.equal(boundByAnotherDevice(bound(), null, false), false);
    assert.equal(boundByAnotherDevice(null, bound(), true), false);
});

// --- A custom radio (P5): seeds, words, variety -------------------------------------------------

test('custom radio seeds: twelve shared one to five per artist, dealt in turn', () => {
    assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7, 8].map(seedsPerArtist), [0, 5, 5, 4, 3, 2, 2, 1, 1]);
    const a = [song('a1', 'A1', 9, 'a'), song('a2', 'A2', 8, 'a')];
    const b = [song('b1', 'B1', 9, 'b')];
    const c = [song('c1', 'C1', 9, 'c'), song('c2', 'C2', 8, 'c'), song('c3', 'C3', 7, 'c')];
    assert.deepEqual(ids(interleaveSeeds([a, b, c])), ['a1', 'b1', 'c1', 'a2', 'c2', 'c3']);
    const duet = song('duet', 'D', 9, 'a');
    assert.deepEqual(
        ids(
            interleaveSeeds([
                [duet, a[1]],
                [b[0], duet],
            ]),
        ),
        ['duet', 'b1', 'a2'],
    );
    // Three artists of six: four each, twelve.
    const six = (x: string) =>
        Array.from({ length: 6 }, (_, i) => song(`${x}${i}`, `${x}-al${i}`, 100 - i, x));
    const three = customRadioSeeds([six('a'), six('b'), six('c')]);
    assert.equal(three.length, 12);
    assert.deepEqual(ids(three).slice(0, 6), ['a0', 'b0', 'c0', 'a1', 'b1', 'c1']);
    // An artist the library no longer holds is skipped; one held is the artist radio's five.
    assert.deepEqual(ids(customRadioSeeds([[], six('a'), []])), ids(artistSeedSongs(six('a'))));
    assert.equal(customRadioSeeds([[], []]).length, 0);
});

test("the characters read Familiar, Blend, Discover; an old hub's words read as these", () => {
    assert.deepEqual(
        BUNDLED_CHARACTERS.map((row) => row.label),
        ['Familiar', 'Blend', 'Discover'],
    );
    const oldHub = {
        available: true,
        characters: [
            { description: 'd1', id: 'close' as const, label: 'Close', legacy: 'EchoMatch' },
            {
                description: 'd2',
                id: 'balanced' as const,
                label: 'Balanced',
                legacy: 'SteadyVibes',
            },
            {
                description: 'd3',
                id: 'explore' as const,
                label: 'Explore',
                legacy: 'TransitionMaestro',
            },
        ],
        configured: true,
        count: false,
        default: 'balanced' as const,
        engine: 'tier2' as const,
        filters: [],
        varieties: [],
    };
    assert.deepEqual(
        charactersOf(oldHub).map((row) => row.label),
        ['Familiar', 'Blend', 'Discover'],
    );
    assert.equal(charactersOf(oldHub)[1].description, 'd2');
    assert.equal(characterLabel(oldHub, 'explore'), 'Discover');
    // A hub's own new words win.
    const renamed = {
        ...oldHub,
        characters: [{ ...oldHub.characters[0], label: 'Near' }],
    };
    assert.equal(characterLabel(renamed, 'close'), 'Near');
});

test('variety is sent only when the probe lists it', () => {
    assert.equal(takesVariety(null, 'high'), false);
    const listed = { varieties: ['low', 'medium', 'high'] } as never;
    assert.equal(takesVariety(listed, 'high'), true);
    assert.equal(takesVariety(listed, ''), false);
    assert.equal(takesVariety({ varieties: [] } as never, 'low'), false);
    // A catalogue stored by an older build has no `varieties` at all.
    assert.equal(takesVariety({} as never, 'low'), false);
});
