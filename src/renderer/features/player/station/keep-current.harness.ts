import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { keepCurrentThen, keepsCurrentSong } from './keep-current.ts';

/**
 * B-175:  node --test src/renderer/features/player/station/keep-current.harness.ts
 *
 * A radio started from the song playing now used Play.NOW with that song as the queue's first
 * row: a new row for the same song, so it restarted from 0.
 */

test('aTrackRadioFromThePlayingSongKeepsIt', () => {
    assert.equal(keepsCurrentSong([{ id: 's1' }, { id: 'st1' }, { id: 'st2' }], 's1'), true);
});

test('aRadioFromAnotherSongIsAPlainReplace', () => {
    assert.equal(keepsCurrentSong([{ id: 's2' }, { id: 'st1' }], 's1'), false);
    // Your mix: no seed row at all.
    assert.equal(keepsCurrentSong([{ id: 'st1' }], undefined), false);
    assert.equal(keepsCurrentSong([], 's1'), false);
    assert.equal(keepsCurrentSong([{ id: 's1' }], ''), false);
});

const playing = { songId: 's1', uniqueId: 'row-current' };

test('theCurrentRowStaysFirstAndOnlyWhatFollowsIsReplaced', () => {
    const next = keepCurrentThen(playing, 's1', ['row-a', 'row-b', 'row-c'], null);
    assert.ok(next);
    assert.deepEqual(next.default, ['row-current', 'row-a', 'row-b', 'row-c']);
    assert.equal(next.index, 0);
    assert.deepEqual(next.shuffled, []);
});

test('underTrackShuffleTheCurrentRowStaysFirstInPlayOrder', () => {
    const reversed = (indexes: number[]) => [...indexes].reverse();
    const next = keepCurrentThen(playing, 's1', ['row-a', 'row-b', 'row-c'], reversed);
    assert.ok(next);
    assert.deepEqual(next.shuffled, [0, 3, 2, 1]);
    assert.equal(next.default[next.shuffled[next.index]], 'row-current');
});

test('aStationWithNothingButTheSeedLeavesTheSongAlone', () => {
    const next = keepCurrentThen(playing, 's1', [], null);
    assert.ok(next);
    assert.deepEqual(next.default, ['row-current']);
    assert.equal(next.index, 0);
});

test('aSongChangeWhileTheConfirmationIsOpenKeepsNothing', () => {
    // Decided while A (s1) played...
    const queue = [{ id: 's1' }, { id: 'st1' }, { id: 'st2' }];
    assert.equal(keepsCurrentSong(queue, 's1'), true);
    // ...applied after A ended and B (s9) started: B's row is not kept under A's station.
    const b = { songId: 's9', uniqueId: 'row-b' };
    assert.equal(keepCurrentThen(b, 's1', ['row-st1', 'row-st2'], null), null);
    assert.equal(keepCurrentThen(undefined, 's1', ['row-st1'], null), null);
    assert.equal(keepsCurrentSong(queue, 's9'), false);
});

test('theConfirmedApplyRechecksAndFallsBackToThePlainReplace', () => {
    const source = readFileSync(new URL('../context/player-context.tsx', import.meta.url), 'utf8');
    const start = source.indexOf('const playKeepingCurrent = useCallback(');
    const body = source.slice(start, source.indexOf('const addToQueueByFetch', start));
    const apply = body.slice(body.indexOf('const apply = () => {'));
    const recheck = apply.indexOf('keepsCurrentSong(data, currentSongId())');
    assert.ok(recheck > 0, 'apply re-checks the playing song');
    // The re-check comes before anything is applied, and its fallback is the old Play.NOW.
    assert.ok(recheck < apply.indexOf('onApply?.()'));
    assert.match(apply, /addToQueueByData\(data, Play\.NOW, undefined, undefined, true, onApply\)/);
    // The store's own check takes the expected song.
    assert.match(apply, /keepCurrentAndReplaceRest\(current\.id, tail\)/);
});

test('playStationQueueTakesTheKeepCurrentPathForThePlayingSong', () => {
    const source = readFileSync(new URL('./station-client.ts', import.meta.url), 'utf8');
    const body = source.slice(
        source.indexOf('export const playStationQueue'),
        source.indexOf('export const playStationRadio'),
    );
    assert.match(body, /keepsCurrentSong\(queue\.songs, currentSongId\(\)\)/);
    assert.match(body, /player\.playKeepingCurrent\(queue\.songs, skipConfirmation, onApply\)/);
    // The Play.NOW replace is what is left for every other radio.
    assert.match(body, /player\.addToQueueByData\(queue\.songs, Play\.NOW/);
});
