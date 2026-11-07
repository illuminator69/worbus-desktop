import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createArrivedEntries, mayArrive, settleVisit } from './arrived-entries.ts';

/**
 * R4:  node --test src/shared/components/animations/arrived-entries.harness.ts
 *
 * The record of which (history entry, list) pairs have shown their arrivals: a page that remounts on
 * Back asks it before opening an arrival window, so a history entry arrives once.
 */

test('markedPairIsRemembered', () => {
    const record = createArrivedEntries(10);
    assert.equal(record.has('a', 'list'), false);
    record.mark('a', 'list');
    assert.equal(record.has('a', 'list'), true);
});

test('otherListOnSameEntryIsNot', () => {
    const record = createArrivedEntries(10);
    record.mark('a', 'term-one');
    assert.equal(record.has('a', 'term-two'), false);
    assert.equal(record.has('a', ''), false);
});

test('sameListOnOtherEntryIsNot', () => {
    const record = createArrivedEntries(10);
    record.mark('a', 'list');
    assert.equal(record.has('b', 'list'), false);
});

test('boundedByEntries', () => {
    const record = createArrivedEntries(3);
    ['a', 'b', 'c', 'd'].forEach((entry) => record.mark(entry, 'list'));
    assert.equal(record.size(), 3);
    assert.equal(record.has('a', 'list'), false);
    assert.equal(record.has('b', 'list'), true);
    assert.equal(record.has('d', 'list'), true);
});

test('thousandEntriesStayBounded', () => {
    const record = createArrivedEntries(200);
    for (let i = 0; i < 1000; i += 1) record.mark(`entry-${i}`, 'list');
    assert.equal(record.size(), 200);
    assert.equal(record.has('entry-999', 'list'), true);
    assert.equal(record.has('entry-799', 'list'), false);
    assert.equal(record.has('entry-800', 'list'), true);
});

test('severalListsOnOneEntryCountOnce', () => {
    const record = createArrivedEntries(2);
    record.mark('a', 'one');
    record.mark('a', 'two');
    record.mark('a', 'three');
    assert.equal(record.size(), 1);
    assert.equal(record.has('a', 'one'), true);
});

test('markingAgainKeepsTheEntryNewest', () => {
    const record = createArrivedEntries(2);
    record.mark('a', 'list');
    record.mark('b', 'list');
    record.mark('a', 'other');
    record.mark('c', 'list');
    assert.equal(record.has('b', 'list'), false);
    assert.equal(record.has('a', 'list'), true);
    assert.equal(record.has('c', 'list'), true);
});

test('aFreshPairArrives', () => {
    const record = createArrivedEntries(10);
    assert.equal(record.arrives('a', 'list'), true);
});

test('backToAnArrivedEntryShowsItAtRest', () => {
    const record = createArrivedEntries(10);
    const release = record.hold('a', 'list');
    record.mark('a', 'list');
    release();
    assert.equal(record.arrives('a', 'list'), false);
});

test('aSiblingOpeningInTheSameVisitStillArrives', () => {
    // Home's shelves share one entry and one (empty) list key: the first to open marks the pair, a
    // shelf that fills later is still part of the visit while any holder is mounted.
    const record = createArrivedEntries(10);
    const releaseFirst = record.hold('a', '');
    record.mark('a', '');
    assert.equal(record.arrives('a', ''), true);
    const releaseSecond = record.hold('a', '');
    releaseFirst();
    assert.equal(record.arrives('a', ''), true);
    releaseSecond();
    assert.equal(record.arrives('a', ''), false);
});

test('releasingTwiceDoesNotGoNegative', () => {
    const record = createArrivedEntries(10);
    const release = record.hold('a', 'list');
    record.mark('a', 'list');
    release();
    release();
    const other = record.hold('a', 'list');
    release();
    assert.equal(record.arrives('a', 'list'), true);
    other();
    assert.equal(record.arrives('a', 'list'), false);
});

test('aReplaceUnderAMountedPageMarksTheNewEntry', () => {
    // The Library writes its search term into the URL (a replace) while the list stays mounted: the
    // entry in history is now K2, and Back to it must find it arrived. Settling runs again per key.
    const record = createArrivedEntries(10);
    let release = settleVisit(record, 'k1', 'list', true);
    release();
    release = settleVisit(record, 'k2', 'list', true);
    assert.equal(record.has('k1', 'list'), true);
    assert.equal(record.has('k2', 'list'), true);
    release();
    assert.equal(record.arrives('k2', 'list'), false);
});

test('aSkippedMountStillMarksTheEntryItIsOn', () => {
    // Back to an arrived entry leaves the window closed (opened = false); a replace from there must
    // still mark the new entry, and a skipped mount holds nothing.
    const record = createArrivedEntries(10);
    record.mark('k1', 'list');
    const release = settleVisit(record, 'k2', 'list', false);
    assert.equal(record.has('k2', 'list'), true);
    assert.equal(record.arrives('k2', 'list'), false);
    release();
    assert.equal(record.arrives('k2', 'list'), false);
});

test('theHoldMovesWithTheEntryAndOnlyForAnOpenedWindow', () => {
    const record = createArrivedEntries(10);
    const first = settleVisit(record, 'k1', '', true);
    assert.equal(record.arrives('k1', ''), true);
    first();
    const second = settleVisit(record, 'k2', '', true);
    assert.equal(record.arrives('k1', ''), false);
    assert.equal(record.arrives('k2', ''), true);
    second();
    assert.equal(record.arrives('k2', ''), false);
});

test('theHookSettlesOnEveryEntryChange', () => {
    // The rule lives in the hook's effect too: it must depend on the live entry and run for any decided
    // mount, not only the pair a window opened under.
    const src = readFileSync(
        new URL('../../../renderer/features/motion/use-arrival.ts', import.meta.url),
        'utf8',
    );
    assert.match(src, /settleVisit\(arrivedEntries, entry, listKey, opened, once\)/);
    assert.match(src, /\[decided, opened, entry, listKey, once\]/);
});

test('aListThatIsNotOncePerEntryAlwaysArrivesAndLeavesNoMark', () => {
    // A mood opened in place on Home is a gesture, not a remount from history: Home restored by Back
    // (its shelves skipped, so no holder) must still let a chosen mood arrive, and again on a re-open.
    const record = createArrivedEntries(10);
    record.mark('k1', '');
    assert.equal(mayArrive(record, 'k1', '', true), false);
    assert.equal(mayArrive(record, 'k1', '', false), true);
    const release = settleVisit(record, 'k2', '', true, false);
    assert.equal(record.has('k2', ''), false);
    release();
    assert.equal(mayArrive(record, 'k2', '', false), true);
});

test('theMoodBodyOptsOutOfTheRecord', () => {
    const src = readFileSync(
        new URL('../../../renderer/features/moods/components/mood-body.tsx', import.meta.url),
        'utf8',
    );
    assert.match(src, /useArrival\([^)]*once: false/s);
});
