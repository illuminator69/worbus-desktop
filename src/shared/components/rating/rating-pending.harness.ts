import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/**
 * The stage 2 review's m1 and n5 (2026-11-14):  node --test src/shared/components/rating/rating-pending.harness.ts
 *
 * m1: a change made while a rating save is in flight was dropped (`busy` returned early), silently,
 * and the stars kept showing it: three quick arrow presses 150 ms apart could save 4 while the stars
 * showed 5. The latest change is now kept and sent once the save settles.
 * n5: a failed save restored the query caches, then emitted `USER_RATING` with the *failed* value, which
 * list rows (the infinite and paginated loaders) and the player apply. The optimistic emit now carries a
 * map each listener fills with what it showed before, and a failed save emits those values back.
 */

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

const gate = async () => {
    const { createRatingGate } = await import('./rating-logic.ts');
    const sent: number[] = [];
    const g = createRatingGate();
    const now = (busy: boolean, value: null | number = 3) => ({
        busy,
        onChange: (v: number) => sent.push(v),
        value,
    });
    return { g, now, sent };
};

test('a_change_during_a_save_is_sent_when_the_save_settles', async () => {
    const { g, now, sent } = await gate();
    g.offer(4, false, now(false));
    assert.deepEqual(sent, [4], 'the first move is saved at once');
    // The second move fires while the first save is still out.
    g.offer(5, false, now(true, 4));
    assert.deepEqual(sent, [4], 'not sent over the save in flight');
    // Still out: nothing to send yet.
    g.settle(now(true, 4));
    assert.deepEqual(sent, [4]);
    g.settle(now(false, 4));
    assert.deepEqual(sent, [4, 5], 'sent once the save settles');
    g.settle(now(false, 5));
    assert.deepEqual(sent, [4, 5], 'and only once');
});

test('only_the_latest_change_during_a_save_is_sent', async () => {
    const { g, now, sent } = await gate();
    g.offer(2, false, now(true));
    g.offer(1, false, now(true));
    g.settle(now(false, 3));
    assert.deepEqual(sent, [1]);
});

test('a_toggling_click_held_over_a_save_decides_against_the_value_then', async () => {
    const { g, now, sent } = await gate();
    // A click on star 4 while a save of 4 is out: once 4 is saved, the click clears it.
    g.offer(4, true, now(true, 3));
    g.settle(now(false, 4));
    assert.deepEqual(sent, [0]);
});

test('the_rating_sends_what_it_held_when_the_save_settles', () => {
    const src = read('./rating.tsx');
    const body = src.slice(src.indexOf('export const Rating'));
    assert.doesNotMatch(
        body,
        /if \(now\.busy \|\| !now\.onChange\) return;/,
        'a busy change is dropped',
    );
    assert.match(body, /\.settle\(/, 'nothing sends the held change once the save settles');
});

const restore = async () => import('../../../renderer/features/shared/mutations/rating-restore.ts');

test('a_failed_save_emits_what_each_item_showed_before', async () => {
    const { notePrevious, restorePayloads } = await restore();
    const payload = {
        id: ['a', 'b', 'c'],
        itemType: 'song',
        previous: new Map<string, null | number>(),
        rating: 5,
        serverId: 's',
    };
    notePrevious(payload, 'a', 3);
    notePrevious(payload, 'b', undefined);
    notePrevious(payload, 'c', 3);
    // A second listener showing the same item does not overwrite the first's answer.
    notePrevious(payload, 'a', 5);
    const out = restorePayloads(payload);
    assert.deepEqual(
        out.map((p) => [p.id, p.rating, p.itemType, p.serverId]),
        [
            [['a', 'c'], 3, 'song', 's'],
            [['b'], null, 'song', 's'],
        ],
    );
    assert.ok(out.every((p) => !('previous' in p) || p.previous === undefined));
});

test('a_restore_emit_is_not_collected_again', async () => {
    const { notePrevious } = await restore();
    const payload = { id: ['a'], itemType: 'song', rating: 3, serverId: 's' };
    notePrevious(payload, 'a', 5);
    assert.equal('previous' in payload, false);
});

test('the_mutation_restores_the_previous_rating_not_the_failed_one', () => {
    const src = read('../../../renderer/features/shared/mutations/set-rating-mutation.ts');
    const onError = src.slice(src.indexOf('onError'), src.indexOf('onMutate'));
    assert.doesNotMatch(
        onError,
        /rating: _variables\.query\.rating/,
        'a failed save emits the value that failed',
    );
    assert.match(onError, /restorePayloads\(/);
});

test('every_rating_listener_notes_what_it_showed', () => {
    for (const file of [
        '../../../renderer/components/item-list/helpers/item-list-infinite-loader.ts',
        '../../../renderer/components/item-list/helpers/item-list-paginated-loader.ts',
        '../../../renderer/features/player/components/audio-players.tsx',
    ]) {
        assert.match(read(file), /notePrevious\(/, file);
    }
});
