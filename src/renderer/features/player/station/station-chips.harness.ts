import assert from 'node:assert/strict';
import test from 'node:test';

import type { ChipState, QueueEntry } from './station-chips.ts';
import type { StationBinding } from './station-logic.ts';

import {
    autoplayIsOn,
    autoplayToggleChip,
    characterChips,
    chipLine,
    chipsFor,
    KEEP_NEXT_UNDER_MS,
    keepsNext,
    panelStatusLine,
    planChipTap,
    remoteEditActs,
    removableStationRows,
    REPLACE_COUNT,
    selectedChip,
    stationStatusKey,
} from './station-chips.ts';

/**
 * I-041:  node --test src/renderer/features/player/station/station-chips.harness.ts
 *
 * The queue's chip row: which chip is selected in each state, and what a tap does (the
 * preference, the signal, which rows it takes out or swaps, whether the top-up runs at once),
 * plus the acts that edit a REMOTE session: `remove` per row, highest index first, then one
 * `enqueue`, never a `setQueue`. The remote cases replay the acts on a model of the hub's own
 * `remove` (hub.py: pop the index, shift the playing index down when it was before it) and check
 * that the playing track and the next one are the same rows afterwards.
 */

const bound = (over: Partial<StationBinding> = {}): StationBinding => ({
    character: 'balanced',
    engine: 'tier2',
    exhausted: false,
    name: 'Cinnamon Girl radio',
    rev: 0,
    seed: { ids: ['seed'], kind: 'track' },
    seq: 20,
    stationId: 'st_1',
    stopped: false,
    ...over,
});

const state = (over: Partial<ChipState> = {}): ChipState => ({
    autoplay: true,
    bound: null,
    mode: 'stations',
    preferred: 'close',
    ...over,
});

/** A queue in play order: `s` rows are the station's, `u` the user's (or a seed). */
const queue = (pattern: string, order?: number[]): QueueEntry[] => {
    const rows = [...pattern].map((kind, queueIndex) => ({
        id: `${kind}${queueIndex}`,
        key: String(queueIndex),
        queueIndex,
        stationAdded: kind === 's',
    }));
    return order ? order.map((queueIndex) => rows[queueIndex]) : rows;
};

// --- Which chips, which one selected ------------------------------------------------------------

test('with the engine: Off, Close, Balanced, Explore; without it: Off and Auto DJ', () => {
    assert.deepEqual(chipsFor('stations'), ['off', 'close', 'balanced', 'explore']);
    assert.deepEqual(chipsFor('pending'), ['off', 'close', 'balanced', 'explore']);
    assert.deepEqual(chipsFor('fallback'), ['off', 'autoDj']);
});

test('a queue with a station shows the station: its character, or Off when it was stopped', () => {
    assert.equal(selectedChip(state({ bound: bound({ character: 'explore' }) })), 'explore');
    assert.equal(selectedChip(state({ bound: bound({ stopped: true }) })), 'off');
    // Shared state: this device's own preference does not override it either way.
    assert.equal(
        selectedChip(state({ autoplay: false, bound: bound({ character: 'close' }) })),
        'close',
    );
    assert.equal(selectedChip(state({ autoplay: true, bound: bound({ stopped: true }) })), 'off');
});

test('a queue with no station shows the preference: Off, or the preferred character', () => {
    assert.equal(selectedChip(state({ autoplay: false })), 'off');
    assert.equal(selectedChip(state({ autoplay: true, preferred: 'explore' })), 'explore');
});

test('without the engine: Auto DJ when on, else Off, whatever is bound', () => {
    assert.equal(selectedChip(state({ autoplay: true, mode: 'fallback' })), 'autoDj');
    assert.equal(selectedChip(state({ autoplay: false, bound: bound(), mode: 'fallback' })), 'off');
});

// --- Which rows a tap may touch -----------------------------------------------------------------

test('under 20 s left: only station rows after the next one, never the playing or next track', () => {
    // Playing row 1; row 2 is next. Rows 3.. are candidates, and the user's row 3 stays.
    const rows = removableStationRows(queue('ussusss'), 1, true);
    assert.deepEqual(
        rows.map((row) => row.queueIndex),
        [4, 5, 6],
    );
    // Playing the last-but-one: nothing after the next one.
    assert.deepEqual(removableStationRows(queue('ssss'), 2, true), []);
});

test('shuffle: after the next one in PLAY order, whatever the queue order', () => {
    // Queue order u0 s1 s2 s3 s4 s5, played in the order 3,0,5,1,4,2. Playing queue row 0
    // (play position 1); next is row 5. After it in play order: rows 1, 4, 2.
    const playOrder = queue('usssss', [3, 0, 5, 1, 4, 2]);
    const rows = removableStationRows(playOrder, 1, true);
    assert.deepEqual(
        rows.map((row) => row.queueIndex),
        [1, 4, 2],
    );
    // Row 3 was played before; row 5 is the next one: neither is touched.
    assert.equal(
        rows.some((row) => row.queueIndex === 3 || row.queueIndex === 5),
        false,
    );
});

// --- Tap Off -----------------------------------------------------------------------------------

test('Off on a station queue: autoplay off, stop the station, take out its unplayed rows', () => {
    const plan = planChipTap('off', state({ bound: bound() }), {
        keepNext: true,
        playOrder: queue('usssss'),
        position: 1,
    });
    assert.equal(plan.autoplay, false);
    assert.deepEqual(plan.signal, { kind: 'stop' });
    assert.deepEqual(plan.optimistic, { stopped: true });
    assert.deepEqual(
        plan.rows.map((row) => row.queueIndex),
        [3, 4, 5],
    );
    assert.equal(plan.topUp, false);
    assert.equal(plan.replaceCount, undefined);
});

test('Off on a station already stopped: no second stop, still takes out what is left', () => {
    const plan = planChipTap('off', state({ bound: bound({ stopped: true }) }), {
        keepNext: true,
        playOrder: queue('ussss'),
        position: 0,
    });
    assert.equal(plan.signal, undefined);
    assert.deepEqual(
        plan.rows.map((row) => row.queueIndex),
        [2, 3, 4],
    );
});

test('Off on a queue with no station: only the preference; nothing to stop or take out', () => {
    const plan = planChipTap('off', state(), { playOrder: queue('uuuu'), position: 0 });
    assert.deepEqual(plan, { autoplay: false, rows: [], topUp: false });
});

// --- Tap a character -----------------------------------------------------------------------------

test('a new character on a station: steer it, swap its unplayed rows for 5 new, top up now', () => {
    const plan = planChipTap('explore', state({ bound: bound({ character: 'balanced' }) }), {
        keepNext: true,
        playOrder: queue('ussss'),
        position: 0,
    });
    assert.equal(plan.autoplay, true);
    assert.equal(plan.character, 'explore');
    assert.deepEqual(plan.signal, { kind: 'character', value: 'explore' });
    assert.deepEqual(plan.optimistic, { character: 'explore', exhausted: false, stopped: false });
    assert.deepEqual(
        plan.rows.map((row) => row.queueIndex),
        [2, 3, 4],
    );
    assert.equal(plan.replaceCount, REPLACE_COUNT);
    assert.equal(plan.topUp, true);
});

test('a character on a stopped station lifts the stop, even the same character', () => {
    const plan = planChipTap('balanced', state({ bound: bound({ stopped: true }) }), {
        keepNext: true,
        playOrder: queue('us'),
        position: 0,
    });
    assert.deepEqual(plan.signal, { kind: 'character', value: 'balanced' });
    assert.equal(plan.optimistic?.stopped, false);
    // Nothing after the next one to swap: just the top-up, which asks now.
    assert.equal(plan.replaceCount, undefined);
    assert.equal(plan.topUp, true);
});

test('the character the station already has: no signal, no swap, only the top-up', () => {
    const plan = planChipTap('balanced', state({ autoplay: false, bound: bound() }), {
        keepNext: true,
        playOrder: queue('ussss'),
        position: 0,
    });
    assert.equal(plan.signal, undefined);
    assert.deepEqual(plan.rows, []);
    assert.equal(plan.autoplay, true);
    assert.equal(plan.topUp, true);
});

test('a character on a queue with no station: preference on, top-up now (it may continue it)', () => {
    const plan = planChipTap('close', state({ autoplay: false }), {
        keepNext: true,
        playOrder: queue('uuu'),
        position: 1,
    });
    assert.deepEqual(plan, { autoplay: true, character: 'close', rows: [], topUp: true });
});

test('a character with only user rows after the next one: steered, nothing swapped', () => {
    const plan = planChipTap('explore', state({ bound: bound() }), {
        keepNext: true,
        playOrder: queue('ssuuu'),
        position: 0,
    });
    assert.deepEqual(plan.signal, { kind: 'character', value: 'explore' });
    assert.deepEqual(plan.rows, []);
    assert.equal(plan.replaceCount, undefined);
});

// --- Without the engine ---------------------------------------------------------------------------

test('fallback: Auto DJ switches upstream Auto DJ on and has it look at once; Off switches it off', () => {
    const on = planChipTap('autoDj', state({ autoplay: false, mode: 'fallback' }), {
        keepNext: true,
        playOrder: queue('uu'),
        position: 0,
    });
    assert.deepEqual(on, { autoplay: true, kickAutoDj: true, rows: [], topUp: false });
    const off = planChipTap('off', state({ autoplay: true, bound: bound(), mode: 'fallback' }), {
        keepNext: true,
        playOrder: queue('uss'),
        position: 0,
    });
    // No station is reachable to stop, and Auto DJ's rows are not a station's.
    assert.deepEqual(off, { autoplay: false, kickAutoDj: false, rows: [], topUp: false });
});

// --- The remote edit: remove acts, highest first, then one enqueue ---------------------------------

/** hub.py's `remove`: pop the index; the playing index moves down when the row was before it. */
const applyHubRemove = (hub: { index: number; queue: string[] }, index: number) => {
    hub.queue.splice(index, 1);
    if (index < hub.index) hub.index -= 1;
};

test('the remote acts: one remove per row, highest index first, then one enqueue', () => {
    const acts = remoteEditActs([3, 7, 5, 7], 5);
    assert.deepEqual(acts, [
        { action: 'remove', index: 7 },
        { action: 'remove', index: 5 },
        { action: 'remove', index: 3 },
        { action: 'enqueue', at: 'end', count: 5 },
    ]);
    assert.equal(
        acts.some((act) => (act.action as string) === 'setQueue'),
        false,
    );
});

test('Off on a remote session: removes only, no enqueue, no setQueue', () => {
    const acts = remoteEditActs([4, 2], 0);
    assert.deepEqual(acts, [
        { action: 'remove', index: 4 },
        { action: 'remove', index: 2 },
    ]);
    assert.deepEqual(remoteEditActs([], 0), []);
    assert.deepEqual(remoteEditActs([-1, 1.5], 0), []);
});

test('shuffled remote session: the acts leave the playing and next rows the same tracks', () => {
    // Queue order u0 s1 s2 s3 s4 s5 s6, played 6,0,3,1,5,2,4. Playing row 0 (position 1),
    // next row 3. The station rows after it in play order: 1, 5, 2, 4.
    const ids = ['u0', 's1', 's2', 's3', 's4', 's5', 's6'];
    const playOrder = queue('ussssss', [6, 0, 3, 1, 5, 2, 4]);
    const rows = removableStationRows(playOrder, 1, true);
    const acts = remoteEditActs(
        rows.map((row) => row.queueIndex),
        5,
    );
    const hub = { index: 0, queue: [...ids] };
    const playing = hub.queue[hub.index];
    const next = 's3';
    for (const act of acts) if (act.action === 'remove') applyHubRemove(hub, act.index);
    assert.equal(hub.queue[hub.index], playing);
    assert.ok(hub.queue.includes(next));
    assert.deepEqual(hub.queue, ['u0', 's3', 's6']);
    assert.deepEqual(acts.at(-1), { action: 'enqueue', at: 'end', count: 5 });
});

test('the playing row after the removed ones keeps its place too (its index moves down)', () => {
    // Queue order s0 s1 u2 s3 s4, played in the order 2,0,1,3,4. Playing row 1 (position 2);
    // next row 3; after it row 4, the only one taken out.
    const playOrder = queue('ssuss', [2, 0, 1, 3, 4]);
    const rows = removableStationRows(playOrder, 2, true);
    assert.deepEqual(
        rows.map((row) => row.queueIndex),
        [4],
    );
    // And a removal BEFORE the playing row, in queue order, shifts the playing index down.
    const hub = { index: 3, queue: ['a', 'b', 'c', 'd', 'e'] };
    for (const act of remoteEditActs([1, 4], 0)) {
        if (act.action === 'remove') applyHubRemove(hub, act.index);
    }
    assert.equal(hub.queue[hub.index], 'd');
});

// --- S-035: the cut point (B-145) -------------------------------------------------------------------

test('the next song goes too, unless under 20 s of the playing one is left (or no way to tell)', () => {
    assert.equal(keepsNext(60_000), false);
    assert.equal(keepsNext(KEEP_NEXT_UNDER_MS), false);
    assert.equal(keepsNext(KEEP_NEXT_UNDER_MS - 1), true);
    assert.equal(keepsNext(3_000), true);
    assert.equal(keepsNext(null), true);
    assert.equal(keepsNext(Number.NaN), true);
});

test('more than 20 s left: the cut is right after the playing track (B-145)', () => {
    // Playing row 0; the station's row 1 (the "second song") is taken out too now.
    const rows = removableStationRows(queue('ussss'), 0, keepsNext(90_000));
    assert.deepEqual(
        rows.map((row) => row.queueIndex),
        [1, 2, 3, 4],
    );
    // The playing track is never a candidate, whatever is left of it.
    assert.equal(
        rows.some((row) => row.queueIndex === 0),
        false,
    );
});

test('Off with more than 20 s left takes out the next station row too', () => {
    const plan = planChipTap('off', state({ bound: bound() }), {
        keepNext: false,
        playOrder: queue('ussss'),
        position: 0,
    });
    assert.deepEqual(
        plan.rows.map((row) => row.queueIndex),
        [1, 2, 3, 4],
    );
});

test('a character with more than 20 s left swaps from the next row on', () => {
    const plan = planChipTap('explore', state({ bound: bound() }), {
        keepNext: false,
        playOrder: queue('usss'),
        position: 0,
    });
    assert.deepEqual(
        plan.rows.map((row) => row.queueIndex),
        [1, 2, 3],
    );
    assert.equal(plan.replaceCount, REPLACE_COUNT);
});

test('shuffle, more than 20 s left: from the next one in PLAY order', () => {
    // Played 3,0,5,1,4,2; playing row 0 (position 1): rows 5, 1, 4, 2 are cut.
    const rows = removableStationRows(queue('usssss', [3, 0, 5, 1, 4, 2]), 1, false);
    assert.deepEqual(
        rows.map((row) => row.queueIndex),
        [5, 1, 4, 2],
    );
});

// --- S-035: the hub edits the session's bound station itself (B-143) ----------------------------------

for (const where of ['local', 'remote'] as const) {
    // The plan does not depend on which device plays: the hub edits the SESSION queue and the
    // playing device gets queueChanged. `where` only varies the rows' keys.
    const rows = (pattern: string) =>
        queue(pattern).map((row) => (where === 'remote' ? row : { ...row, key: `u${row.key}` }));

    test(`${where}, hub edits: Off is only the stop signal with apply, no client edit`, () => {
        const plan = planChipTap('off', state({ bound: bound(), hubEdits: true }), {
            keepNext: false,
            playOrder: rows('ussss'),
            position: 0,
        });
        assert.deepEqual(plan, {
            apply: true,
            autoplay: false,
            optimistic: { stopped: true },
            rows: [],
            signal: { kind: 'stop' },
            topUp: false,
        });
    });

    test(`${where}, hub edits: a character is only the signal with apply; no swap, no next`, () => {
        const plan = planChipTap('explore', state({ bound: bound(), hubEdits: true }), {
            keepNext: true,
            playOrder: rows('ussssss'),
            position: 1,
        });
        assert.deepEqual(plan, {
            apply: true,
            autoplay: true,
            character: 'explore',
            optimistic: { character: 'explore', exhausted: false, stopped: false },
            rows: [],
            signal: { kind: 'character', value: 'explore' },
            topUp: false,
        });
    });

    test(`${where}, hub edits: a character on a stopped station is the signal with apply too`, () => {
        const plan = planChipTap(
            'balanced',
            state({ bound: bound({ stopped: true }), hubEdits: true }),
            {
                keepNext: false,
                playOrder: rows('us'),
                position: 0,
            },
        );
        assert.equal(plan.apply, true);
        assert.deepEqual(plan.signal, { kind: 'character', value: 'balanced' });
        assert.deepEqual(plan.rows, []);
        assert.equal(plan.replaceCount, undefined);
    });
}

test('hub edits but no station bound: the preference and the top-up, as before', () => {
    const plan = planChipTap('close', state({ autoplay: false, hubEdits: true }), {
        keepNext: false,
        playOrder: queue('uuu'),
        position: 2,
    });
    assert.deepEqual(plan, { autoplay: true, character: 'close', rows: [], topUp: true });
});

test('hub edits, the character the station already has: no signal, just the top-up', () => {
    const plan = planChipTap('balanced', state({ bound: bound(), hubEdits: true }), {
        keepNext: false,
        playOrder: queue('us'),
        position: 0,
    });
    assert.deepEqual(plan, { autoplay: true, character: 'balanced', rows: [], topUp: true });
});

// --- S-035: the line under the chips (B-146) ------------------------------------------------------------

test('the line is the origin then the status, either alone, or nothing', () => {
    assert.equal(
        chipLine('Moon Song radio · Balanced', 'Finding the next tracks...'),
        'Moon Song radio · Balanced · Finding the next tracks...',
    );
    assert.equal(chipLine('Auto DJ', null), 'Auto DJ');
    assert.equal(
        chipLine(null, 'Autoplay is off. This queue stops at its end.'),
        'Autoplay is off. This queue stops at its end.',
    );
    assert.equal(chipLine(null, null), null);
    assert.equal(chipLine('  ', ''), null);
});

// F4: the side queue's Autoplay toggle is the chip Off or the preferred character, over the
// same tap plan, and its character row is the three characters only.

test('offToggleIsTheOffChip', () => {
    assert.equal(autoplayToggleChip(false, true, 'balanced'), 'off');
    assert.equal(autoplayToggleChip(false, false, 'explore'), 'off');
    const state: ChipState = {
        autoplay: true,
        bound: bound(),
        mode: 'stations',
        preferred: 'balanced',
    };
    const queue = { keepNext: false, playOrder: [], position: 0 };
    assert.deepEqual(
        planChipTap(autoplayToggleChip(false, true, 'balanced'), state, queue),
        planChipTap('off', state, queue),
    );
});

test('onToggleIsThePreferredCharacterWithTheEngine', () => {
    assert.equal(autoplayToggleChip(true, true, 'explore'), 'explore');
    assert.equal(autoplayToggleChip(true, true, 'close'), 'close');
});

test('onToggleIsAutoDjWithoutIt', () => {
    assert.equal(autoplayToggleChip(true, false, 'explore'), 'autoDj');
});

test('characterChipsAreTheThreeCharacters', () => {
    assert.deepEqual(characterChips(['off', 'close', 'balanced', 'explore']), [
        'close',
        'balanced',
        'explore',
    ]);
    assert.deepEqual(characterChips(chipsFor('stations')), ['close', 'balanced', 'explore']);
    assert.deepEqual(characterChips(chipsFor('pending')), ['close', 'balanced', 'explore']);
});

test('characterChipsOfTheFallbackAreEmpty', () => {
    assert.deepEqual(characterChips(['off', 'autoDj']), []);
    assert.deepEqual(characterChips(chipsFor('fallback')), []);
});

test('theToggleIsOnIffTheSelectedChipIsNotOff', () => {
    assert.equal(autoplayIsOn('off'), false);
    assert.equal(autoplayIsOn('autoDj'), true);
    assert.equal(autoplayIsOn('close'), true);
    assert.equal(autoplayIsOn('balanced'), true);
    assert.equal(autoplayIsOn('explore'), true);
});

// R14 (B-251): the status line's key, as useStationWords had it inline, and the side queue
// header's line, which carries no status sentence.

test('statusKeyInEachState', () => {
    const base = { autoplay: true, bound: null, inFlight: false, lastPartial: false };
    assert.equal(stationStatusKey({ ...base, mode: 'fallback' }), null);
    assert.equal(stationStatusKey({ ...base, mode: 'pending' }), null);
    assert.equal(stationStatusKey({ ...base, mode: 'stations' }), 'continues');
    assert.equal(stationStatusKey({ ...base, autoplay: false, mode: 'stations' }), 'offStops');
    assert.equal(stationStatusKey({ ...base, inFlight: true, mode: 'stations' }), 'finding');
    assert.equal(stationStatusKey({ ...base, lastPartial: true, mode: 'stations' }), 'partial');
    const live = { exhausted: false, stopped: false };
    assert.equal(stationStatusKey({ ...base, bound: live, mode: 'stations' }), null);
    // A bound station answers for itself: Autoplay off does not stop it, Off does.
    assert.equal(
        stationStatusKey({ ...base, autoplay: false, bound: live, mode: 'stations' }),
        null,
    );
    assert.equal(
        stationStatusKey({ ...base, bound: { ...live, stopped: true }, mode: 'stations' }),
        'offStops',
    );
    assert.equal(
        stationStatusKey({ ...base, bound: { ...live, exhausted: true }, mode: 'stations' }),
        'exhausted',
    );
});

test('panelLineIsTheBoundStationOnly', () => {
    // I1: no status sentence (the Autoplay switch says on and off), and no "Auto DJ" (it comes
    // and goes with that switch): the line's presence never follows the switch.
    assert.equal(panelStatusLine('Auto DJ', false), null);
    assert.equal(panelStatusLine(null, false), null);
    assert.equal(panelStatusLine(null, true), null);
    assert.equal(panelStatusLine('  ', true), null);
    assert.equal(panelStatusLine('Moon Song radio · Balanced', true), 'Moon Song radio · Balanced');
});
