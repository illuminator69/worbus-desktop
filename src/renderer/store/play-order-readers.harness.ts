import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

// The readers import the store's play-order selectors through the app's `/@/` alias.
registerHooks({
    resolve: (specifier, context, nextResolve) =>
        specifier.startsWith('/@/')
            ? nextResolve(new URL(`../../${specifier.slice(3)}.ts`, import.meta.url).href, context)
            : nextResolve(specifier, context),
});

const { publicationFields } = await import('../features/hub/utils/queue-publication.ts');
const { savePlayQueueQuery } = await import('../features/player/utils/save-play-queue.ts');
const { queueListRows } = await import('../features/now-playing/utils/queue-list-rows.ts');

/**
 * W1 (B-305, B-351, B-371):  node --test src/renderer/store/play-order-readers.harness.ts
 *
 * Three readers of the player under track shuffle, where `player.index` is a position in
 * `queue.shuffled` and `queue.shuffled[player.index]` the playing row:
 * - the hub's `setQueue` (B-305) names the playing ROW, and with a hub that speaks `playOrder`
 *   says shuffle and the order (navi-connect/DESIGN-w1-play-order-2026-11-10.md §1);
 * - Navidrome's `savePlayQueue` (B-371) gets the playing row of the songs it is sent;
 * - the play queue list (B-351) draws the rows in play order, the playing song among them.
 */

const ids = ['a', 'b', 'c', 'd', 'e'];
/** Shuffle on, five rows, play order [3, 0, 4, 1, 2], at play position 0: row 3 ('d') plays. */
const shuffled = {
    player: { index: 0, shuffle: 'track' },
    queue: { default: ids, shuffled: [3, 0, 4, 1, 2] },
};
const straight = {
    player: { index: 2, shuffle: 'none' },
    queue: { default: ids, shuffled: [] },
};
const items = ids.map((id) => ({ id }));

test('B-305: setQueue names the playing row under shuffle (was: the play position)', () => {
    assert.equal(publicationFields(shuffled, false).index, 3);
    assert.equal(publicationFields(straight, false).index, 2);
});

test('B-305: with a playOrder hub, setQueue carries shuffle and the order', () => {
    assert.deepEqual(publicationFields(shuffled, true), {
        index: 3,
        order: [3, 0, 4, 1, 2],
        shuffle: true,
    });
    assert.deepEqual(publicationFields(straight, true), { index: 2, order: null, shuffle: false });
});

test('B-305: an older hub is sent no shuffle and no order', () => {
    assert.deepEqual(Object.keys(publicationFields(shuffled, false)), ['index']);
});

test('B-371: savePlayQueue gets the playing row of the songs it sends', () => {
    const query = savePlayQueueQuery(items, shuffled, 12.5);
    assert.deepEqual(query.songs, ids, 'queue order');
    assert.equal(query.songs[query.currentIndex!], 'd', 'the song that plays');
    assert.equal(query.positionMs, 12500);
});

test('B-351: the list draws the rows in play order, the playing song first here', () => {
    assert.deepEqual(
        queueListRows(items, shuffled).map((item) => item.id),
        ['d', 'a', 'e', 'b', 'c'],
    );
    assert.deepEqual(
        queueListRows(items, straight).map((item) => item.id),
        ids,
        'queue order without shuffle',
    );
});
