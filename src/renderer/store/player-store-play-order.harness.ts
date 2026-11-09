import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import test from 'node:test';

/**
 * W1, the desktop half of B-105, and B-351:
 *
 *     node --test src/renderer/store/player-store-play-order.harness.ts
 *
 * The REAL player store, its app imports stubbed (events, settings, the timestamp store, the
 * radio store, persistence), driven through its actions. Under track shuffle the play order is
 * `queue.shuffled` (rows of `queue.default`) and `player.index` a position in it. One rule
 * (navi-connect/DESIGN-w1-play-order-2026-11-10.md §2) says what each edit does to that order:
 * shuffle on puts the playing row first; Play next goes right after the playing row and Add to
 * queue at the end, both in the order given; removing the playing row plays the row after it in
 * play order; a queue or order adopted from the hub is kept as sent.
 */

const TYPES = readFileSync(new URL('../../shared/types/types.ts', import.meta.url), 'utf8');
/** The real enum's members, so the stub cannot drift from it. */
const enumSource = (name: string): string => {
    const start = TYPES.indexOf(`export enum ${name} {`);
    assert.ok(start >= 0, `enum ${name} in shared/types/types.ts`);
    const body = TYPES.slice(start, TYPES.indexOf('\n}', start));
    const members = [...body.matchAll(/(\w+) = '([^']*)'/g)].map((m) => `${m[1]}: '${m[2]}'`);
    return `export const ${name} = { ${members.join(', ')} };`;
};

const STUBS: Record<string, string> = {
    '/@/renderer/events/event-emitter':
        'export const eventEmitter = { emit() {}, off() {}, on() {} };',
    '/@/renderer/features/radio/hooks/use-radio-player':
        'export const useRadioStore = { getState: () => ({ actions: { clear() {} }, currentStreamUrl: null }) };',
    '/@/renderer/store/settings.store':
        'export const useSettingsStore = { getState: () => ({ general: { resume: false, skipButtons: {} }, playback: {} }) };',
    '/@/renderer/store/timestamp.store':
        'let t = 0; export const setTimestamp = (v) => { t = v; }; export const useTimestampStoreBase = { getState: () => ({ timestamp: t }) };',
    '/@/renderer/store/utils':
        'export const migratePlayerStorePersist = async () => {}; export const playerStoreStorage = { getItem: () => null, removeItem() {}, setItem() {} };',
    '/@/shared/types/domain-types':
        'export const PlayerData = undefined; export const QueueData = undefined; export const QueueSong = undefined; export const Song = undefined;',
    '/@/shared/types/types': [
        'CrossfadeStyle',
        'Play',
        'PlayerRepeat',
        'PlayerShuffle',
        'PlayerStatus',
        'PlayerStyle',
    ]
        .map(enumSource)
        .join('\n'),
};

registerHooks({
    load: (url, context, nextLoad) =>
        url.startsWith('stub:')
            ? {
                  format: 'module',
                  shortCircuit: true,
                  source: STUBS[decodeURIComponent(url.slice(5))],
              }
            : nextLoad(url, context),
    resolve: (specifier, context, nextResolve) => {
        if (specifier in STUBS) {
            return { shortCircuit: true, url: `stub:${encodeURIComponent(specifier)}` };
        }
        if (specifier.startsWith('/@/')) {
            return nextResolve(
                new URL(`../../${specifier.slice(3)}.ts`, import.meta.url).href,
                context,
            );
        }
        // Vite resolves extensionless subpaths; node's ESM resolver wants the file.
        if (specifier === 'lodash/merge') return nextResolve('lodash/merge.js', context);
        return nextResolve(specifier, context);
    },
});

const { usePlayerStoreBase } = await import('./player.store.ts');
const { Play, PlayerShuffle } = (await import('/@/shared/types/types' as string)) as {
    Play: Record<string, string>;
    PlayerShuffle: Record<string, string>;
};

const store = () => usePlayerStoreBase.getState();

const songs = (n: number, prefix = 's') =>
    Array.from({ length: n }, (_, i) => ({
        id: `${prefix}${i}`,
        name: `${prefix}${i}`,
    })) as never[];

/** A queue of `n` songs s0..s(n-1), shuffle on, playing row `row` (with play order `order`). */
const shuffledQueue = (n: number, row: number, order: number[]) => {
    store().clearQueue();
    store().setShuffle(PlayerShuffle.NONE as never);
    store().setQueue(songs(n), row, 0, false);
    usePlayerStoreBase.setState((state) => {
        state.player.shuffle = PlayerShuffle.TRACK as never;
        state.queue.shuffled = [...order];
        state.player.index = order.indexOf(row);
    });
};

/** Song ids in play order, and the playing song's id. */
const playIds = () => {
    const s = store();
    const items = s.getQueueOrder().items;
    const rows = s.queue.shuffled.length ? s.queue.shuffled : items.map((_, i) => i);
    return rows.map((row) => items[row]?.id);
};
const playing = () => store().getCurrentSong()?.id;

test('shuffle on puts the playing row first, over 50 rows (was: a random place)', () => {
    store().clearQueue();
    store().setShuffle(PlayerShuffle.NONE as never);
    store().setQueue(songs(50), 17, 0, false);
    store().setShuffle(PlayerShuffle.TRACK as never);
    assert.equal(playing(), 's17', 'the playing song does not change');
    assert.equal(store().queue.shuffled[0], 17, 'the playing row is first in play order');
    assert.equal(store().player.index, 0);
});

test('Play next keeps the batch in the order given, right after the playing row', () => {
    shuffledQueue(8, 3, [5, 1, 3, 7, 0, 2, 6, 4]);
    store().addToQueueByType(songs(6, 'n'), Play.NEXT as never);
    assert.equal(playing(), 's3');
    assert.deepEqual(playIds().slice(0, 9), ['s5', 's1', 's3', 'n0', 'n1', 'n2', 'n3', 'n4', 'n5']);
    assert.deepEqual(
        playIds().slice(9),
        ['s7', 's0', 's2', 's6', 's4'],
        'the rest keep their order',
    );
});

test('Add to queue lands at the end of play order, in the order given', () => {
    shuffledQueue(6, 2, [4, 2, 0, 5, 1, 3]);
    store().addToQueueByType(songs(5, 'a'), Play.LAST as never);
    assert.equal(playing(), 's2');
    assert.deepEqual(playIds(), ['s4', 's2', 's0', 's5', 's1', 's3', 'a0', 'a1', 'a2', 'a3', 'a4']);
});

test('removing the playing row plays the row after it in play order', () => {
    shuffledQueue(6, 2, [4, 2, 0, 5, 1, 3]);
    const current = store().getCurrentSong()!;
    store().clearSelected([current]);
    assert.equal(playing(), 's0', 'the play-order successor of s2');
    assert.deepEqual(playIds(), ['s4', 's0', 's5', 's1', 's3'], 'the rest keep their order');
});

test('removing another row keeps the playing song and the play order', () => {
    shuffledQueue(6, 2, [4, 2, 0, 5, 1, 3]);
    const s5 = store()
        .getQueueOrder()
        .items.find((item) => item.id === 's5')!;
    store().clearSelected([s5]);
    assert.equal(playing(), 's2');
    assert.deepEqual(playIds(), ['s4', 's2', 's0', 's1', 's3']);
});

test("reconcileQueue adopts the hub's order (was: regenerated)", () => {
    shuffledQueue(6, 2, [2, 0, 1, 3, 4, 5]);
    const order = [4, 2, 0, 5, 1, 3];
    (store().reconcileQueue as (...args: unknown[]) => void)(songs(6), 2, {
        order,
        shuffle: true,
    });
    assert.deepEqual([...store().queue.shuffled], order);
    assert.equal(playing(), 's2');
});

test('setQueue from a load plays the row it names, under shuffle (was: a play position)', () => {
    // A play order left from before, so a row written as a play position names another song.
    shuffledQueue(6, 0, [3, 5, 0, 1, 4, 2]);
    const order = [5, 1, 3, 0, 4, 2];
    (store().setQueue as (...args: unknown[]) => void)(songs(6, 'x'), 3, 0, false, {
        order,
        shuffle: true,
    });
    assert.equal(playing(), 'x3', 'row 3 of the loaded queue');
    assert.deepEqual([...store().queue.shuffled], order, 'in the order the hub sent');
});

test('setQueue under local shuffle with no order puts its start row first', () => {
    shuffledQueue(6, 0, [0, 1, 2, 3, 4, 5]);
    store().setQueue(songs(9, 'y'), 4, 0, false);
    assert.equal(playing(), 'y4');
    assert.equal(store().queue.shuffled[0], 4);
    assert.equal(store().queue.shuffled.length, 9);
});

test('a load with shuffle off turns shuffle off and plays its row', () => {
    shuffledQueue(6, 0, [3, 0, 1, 2, 4, 5]);
    (store().setQueue as (...args: unknown[]) => void)(songs(6, 'z'), 2, 0, false, {
        order: null,
        shuffle: false,
    });
    assert.equal(store().player.shuffle, PlayerShuffle.NONE);
    assert.equal(playing(), 'z2');
});

test('Play next with the playing row last in the queue still plays next (not at the end)', () => {
    shuffledQueue(4, 3, [3, 0, 1, 2]);
    store().addToQueueByType(songs(2, 'n'), Play.NEXT as never);
    assert.deepEqual(playIds(), ['s3', 'n0', 'n1', 's0', 's1', 's2']);
});

test('a move keeps every row in its play position; Move to next plays them next', () => {
    shuffledQueue(6, 2, [4, 2, 0, 5, 1, 3]);
    const items = () => store().getQueueOrder().items;
    store().moveSelectedToTop([items().find((item) => item.id === 's5')!]);
    assert.equal(playing(), 's2');
    assert.deepEqual(playIds(), ['s4', 's2', 's0', 's5', 's1', 's3']);
    store().moveSelectedToNext([items().find((item) => item.id === 's3')!]);
    assert.equal(playing(), 's2');
    assert.deepEqual(playIds(), ['s4', 's2', 's3', 's0', 's5', 's1']);
});

test('shuffle off keeps the playing song and plays on in queue order', () => {
    shuffledQueue(6, 2, [4, 2, 0, 5, 1, 3]);
    store().toggleShuffle();
    assert.equal(store().player.shuffle, PlayerShuffle.NONE);
    assert.equal(playing(), 's2');
    assert.equal(store().player.index, 2);
    store().toggleShuffle();
    assert.equal(playing(), 's2');
    assert.equal(store().queue.shuffled[0], 2, 'on again: the playing row first');
});

test('a re-shuffle keeps the playing song (was: a new order under the same position)', () => {
    shuffledQueue(30, 9, [...Array(30).keys()].reverse());
    store().shuffle();
    assert.equal(playing(), 's9');
    assert.equal(store().queue.shuffled[0], 9);
});

test("setShuffle adopts a hub's order and keeps the playing song", () => {
    shuffledQueue(5, 1, [0, 1, 2, 3, 4]);
    store().setShuffle(PlayerShuffle.TRACK as never, [3, 1, 4, 0, 2]);
    assert.deepEqual([...store().queue.shuffled], [3, 1, 4, 0, 2]);
    assert.equal(playing(), 's1');
    store().setShuffle(PlayerShuffle.TRACK as never, [0, 1]);
    assert.equal(store().queue.shuffled[0], 1, 'not a permutation: the playing row first');
});

test('an older hub (no order): a queueChanged insert keeps the kept rows in play order', () => {
    shuffledQueue(4, 1, [2, 1, 3, 0]);
    // The hub inserted 'h' after s1 (row 2) and appended 't'; the queue resends whole.
    const next = [
        ...songs(2),
        { id: 'h', name: 'h' },
        ...songs(4).slice(2),
        { id: 't', name: 't' },
    ];
    store().reconcileQueue(next as never[], 1);
    assert.equal(playing(), 's1');
    assert.deepEqual(playIds(), ['s2', 's1', 'h', 's3', 's0', 't']);
});
