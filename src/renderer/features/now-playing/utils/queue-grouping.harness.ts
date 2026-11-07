import assert from 'node:assert/strict';
import test from 'node:test';

import type { QueueGroup, QueueRowInfo } from './queue-grouping.ts';

import { playingIndexOf, queueGroups, queueLength } from './queue-grouping.ts';

/**
 * node --test --test-reporter=tap src/renderer/features/now-playing/utils/queue-grouping.harness.ts
 *
 * The side queue's groups (who put each row there), the queue's length and the playing row's
 * index in the displayed rows. Rows are written as letters: p is the playing row, q a row the
 * user put there, a a row the bound station served (flagged).
 */

const rows = (shape: string): QueueRowInfo[] =>
    [...shape].map((c) => ({ stationAdded: c === 'a' }));

const g = (kind: QueueGroup['kind'], count: number): QueueGroup => ({ count, kind });

const sum = (groups: QueueGroup[]) => groups.reduce((n, x) => n + x.count, 0);

test('noStationFiveSongsPlayingSecond', () => {
    assert.deepEqual(queueGroups(rows('qpqqq'), 1), [
        g('earlier', 1),
        g('playing', 1),
        g('next', 3),
    ]);
});

test('aStationQueueIsQueuedThenAutoplay', () => {
    assert.deepEqual(queueGroups(rows('pqqaaa'), 0), [
        g('playing', 1),
        g('queued', 2),
        g('autoplay', 3),
    ]);
});

test('aUserSongAfterTheAutoplayRunStartsASecondQueuedGroup', () => {
    assert.deepEqual(queueGroups(rows('pqaaq'), 0), [
        g('playing', 1),
        g('queued', 1),
        g('autoplay', 2),
        g('queued', 1),
    ]);
});

test('queuedNeedsAnAutoplayGroupBesideIt', () => {
    assert.deepEqual(queueGroups(rows('aqpqq'), 2), [
        g('earlier', 2),
        g('playing', 1),
        g('next', 2),
    ]);
});

test('aKeptStationRowStaysAutoplay', () => {
    assert.deepEqual(queueGroups(rows('pqqqa'), 0), [
        g('playing', 1),
        g('queued', 3),
        g('autoplay', 1),
    ]);
});

test('nothingPlayingMakesEverythingNext', () => {
    assert.deepEqual(queueGroups(rows('qqaaq'), -1), [g('next', 5)]);
});

test('aPlayingIndexPastTheEndMeansNothingPlaying', () => {
    assert.deepEqual(queueGroups(rows('qqa'), 3), [g('next', 3)]);
    assert.deepEqual(queueGroups(rows('qqa'), 99), [g('next', 3)]);
});

test('oneSongIsJustNowPlaying', () => {
    assert.deepEqual(queueGroups(rows('p'), 0), [g('playing', 1)]);
});

test('emptyIsEmpty', () => {
    assert.deepEqual(queueGroups([], 0), []);
    assert.deepEqual(queueGroups([], -1), []);
});

test('playingFirstHasNoEarlierGroup', () => {
    const groups = queueGroups(rows('pqq'), 0);
    assert.equal(groups[0].kind, 'playing');
    assert.ok(!groups.some((x) => x.kind === 'earlier'));
});

test('playingLastHasNothingAfter', () => {
    assert.deepEqual(queueGroups(rows('qqap'), 3), [g('earlier', 3), g('playing', 1)]);
});

test('theCountsAlwaysSumToTheRows', () => {
    const shapes = ['', 'p', 'qqqq', 'aaaa', 'qaqaqa', 'aqqaaqqqa', 'qqqqqqqqqa'];
    for (const shape of shapes) {
        for (let i = -1; i <= shape.length; i++) {
            const groups = queueGroups(rows(shape), i);
            assert.equal(sum(groups), shape.length, `${shape} at ${i}`);
            assert.ok(
                groups.every((x) => x.count > 0),
                `${shape} at ${i}: no empty group`,
            );
            for (let k = 1; k < groups.length; k++) {
                assert.notEqual(groups[k].kind, groups[k - 1].kind, `${shape} at ${i}: runs`);
            }
        }
    }
});

const MIN = 60_000;

test('queueLengthRoundsToTheNearestMinute', () => {
    assert.deepEqual(queueLength(0), { hours: 0, minutes: 0 });
    assert.deepEqual(queueLength(11 * MIN), { hours: 0, minutes: 11 });
    assert.deepEqual(queueLength((3 * 60 + 14) * MIN), { hours: 3, minutes: 14 });
    assert.deepEqual(queueLength(59.6 * MIN), { hours: 1, minutes: 0 });
    assert.deepEqual(queueLength(30_000), { hours: 0, minutes: 1 });
    assert.deepEqual(queueLength(29_999), { hours: 0, minutes: 0 });
});

test('queueLengthOfThreeSongsIsElevenMinutes', () => {
    const songs = [3 * MIN + 40_000, 4 * MIN + 5_000, 3 * MIN + 20_000];
    assert.deepEqual(queueLength(songs.reduce((a, b) => a + b, 0)), { hours: 0, minutes: 11 });
});

test('queueLengthIgnoresNegativeAndNaN', () => {
    for (const bad of [-1, -MIN, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
        assert.deepEqual(queueLength(bad), { hours: 0, minutes: 0 }, String(bad));
    }
});

test('playingIndexOfFindsTheActiveKey', () => {
    assert.equal(playingIndexOf(['a', 'b', 'c'], 'c'), 2);
    assert.equal(playingIndexOf(['remote:0', 'remote:1'], 'remote:1'), 1);
});

test('playingIndexOfIsMinusOneWithoutOne', () => {
    assert.equal(playingIndexOf(['a', 'b'], undefined), -1);
    assert.equal(playingIndexOf(['a', 'b'], 'z'), -1);
    assert.equal(playingIndexOf([], 'a'), -1);
});

test('playingIndexOfTakesTheFirstOfADuplicate', () => {
    assert.equal(playingIndexOf(['a', 'b', 'b'], 'b'), 1);
});
