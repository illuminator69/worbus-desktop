import assert from 'node:assert/strict';
import test from 'node:test';

import type { ReleaseKind } from './release-kind.ts';

import {
    chipRow,
    discographyChips,
    discographyLine,
    kindLines,
    lbBotCanScan,
    ownedPlayIds,
    popularReleases,
} from './artist-shelves.ts';
import { type DiscographyItem, type Ownership } from './discography-model.ts';

/**
 * The artist page's short shape: a "Popular releases" line and one line per release kind, picked
 * from the discography model's items.
 *
 *     node --test src/renderer/features/discography/artist-shelves.harness.ts
 */

const item = (over: Partial<DiscographyItem> & { key: string }): DiscographyItem => ({
    addedAt: null,
    albumId: over.ownership === 'missing' || over.ownership === 'syncing' ? null : over.key,
    fill: null,
    gap: null,
    kind: 'album' as ReleaseKind,
    ownership: 'owned' as Ownership,
    plays: 0,
    rgid: `rg-${over.key}`,
    title: over.key,
    year: 2000,
    ...over,
});

const keys = (items: DiscographyItem[]) => items.map((entry) => entry.key);

test('popularOrdersPlaysThenNewest', () => {
    const items = [
        item({ key: 'a', plays: 5, year: 2010 }),
        item({ key: 'b', plays: 9, year: 2001 }),
        item({ key: 'c', plays: 9, year: 2020 }),
    ];
    assert.deepEqual(keys(popularReleases(items, 10)), ['c', 'b', 'a']);
});

test('popularThenSyncingThenMissingAlbums', () => {
    const items = [
        item({ key: 'miss-ep', kind: 'ep', ownership: 'missing', year: 2022 }),
        item({ key: 'miss-album', ownership: 'missing', year: 2018 }),
        item({ key: 'sync', ownership: 'syncing', year: 2019 }),
        item({ key: 'own', plays: 3 }),
    ];
    assert.deepEqual(keys(popularReleases(items, 10)), ['own', 'sync', 'miss-album']);
});

test('popularLimit', () => {
    const items = Array.from({ length: 10 }, (_, i) => item({ key: `k${i}`, plays: i }));
    assert.equal(popularReleases(items, 4).length, 4);
});

test('kindLinesKeepOrderAndHide', () => {
    const items = [
        item({ key: 's1', kind: 'single' }),
        item({ key: 'e1', kind: 'ep' }),
        item({ key: 'a1', kind: 'album' }),
        item({ key: 'l1', kind: 'live' }),
    ];
    const lines = kindLines(items, ['album', 'ep', 'single'], new Set<ReleaseKind>(['single']), 5);
    assert.deepEqual(
        lines.map((line) => line.kind),
        ['album', 'ep'],
    );
    assert.deepEqual(keys(lines[0].items), ['a1']);
});

test('seeAllOnlyWhenMore', () => {
    const eps = [item({ key: 'e1', kind: 'ep' }), item({ key: 'e2', kind: 'ep' })];
    const [epLine] = kindLines(eps, ['ep'], new Set(), 5);
    assert.equal(epLine.more, false);
    assert.equal(epLine.total, 2);

    const albums = Array.from({ length: 7 }, (_, i) => item({ key: `a${i}`, year: 2000 + i }));
    const [albumLine] = kindLines(albums, ['album'], new Set(), 5);
    assert.equal(albumLine.items.length, 5);
    assert.equal(albumLine.more, true);
    assert.equal(albumLine.total, 7);
    assert.deepEqual(keys(albumLine.items), ['a6', 'a5', 'a4', 'a3', 'a2']);
});

test('fromLibraryOnlyHasNoMissing', () => {
    const items = [
        item({ key: 'a', plays: 2 }),
        item({ key: 'b', kind: 'ep', ownership: 'partly' }),
        item({ key: 'c', kind: 'single' }),
    ];
    const all = [
        ...popularReleases(items, 10),
        ...kindLines(items, ['album', 'ep', 'single'], new Set(), 10).flatMap((line) => line.items),
    ];
    assert.ok(all.length > 0);
    assert.ok(all.every((entry) => entry.ownership !== 'missing'));
});

test('playIdsDefaultView', () => {
    const items = [
        item({ key: 'id2001', year: 2001 }),
        item({ key: 'id2020', ownership: 'partly', year: 2020 }),
        item({ key: 'id2015', ownership: 'missing', year: 2015 }),
    ];
    assert.deepEqual(ownedPlayIds(items), ['id2020', 'id2001']);
});

const chipKinds = (chips: { kind: string }[]) => chips.map((chip) => chip.kind);

test('chipsOnlyForKindsPresentInSettingsOrder', () => {
    const items = [
        item({ key: 'l1', kind: 'live' }),
        item({ key: 'a1', kind: 'album' }),
        item({ key: 'c1', kind: 'compilation' }),
    ];
    const chips = discographyChips(items, ['compilation', 'album', 'ep', 'live'], new Set());
    assert.deepEqual(chipKinds(chips), ['popular', 'compilation', 'album', 'live']);
    assert.deepEqual(
        chips.map((chip) => chip.total),
        [3, 1, 1, 1],
    );
});

test('chipsLeaveDisabledKindsOutAndPopularFirst', () => {
    const items = [
        item({ key: 'a1', kind: 'album' }),
        item({ key: 'r1', kind: 'remix' }),
        item({ key: 'o1', kind: 'appears-on' }),
    ];
    const chips = discographyChips(
        items,
        ['album', 'remix', 'appears-on'],
        new Set<ReleaseKind>(['remix']),
    );
    // Appears on is its own row, never a chip.
    assert.deepEqual(chipKinds(chips), ['popular', 'album']);
});

test('singlesAndEpsAreOneChip', () => {
    const items = [
        item({ key: 's1', kind: 'single', year: 2001 }),
        item({ key: 'e1', kind: 'ep', year: 2005 }),
        item({ key: 'a1', kind: 'album' }),
    ];
    const chips = discographyChips(items, ['album', 'single', 'live', 'ep'], new Set());
    assert.deepEqual(chipKinds(chips), ['popular', 'album', 'singles-and-eps']);
    const singles = chips[2];
    assert.deepEqual(singles.kinds, ['single', 'ep']);
    assert.equal(singles.total, 2);
    assert.deepEqual(keys(chipRow(items, singles, 4)), ['e1', 's1']);

    // One of the two switched off: the chip holds the other alone.
    const [, , epsOff] = discographyChips(
        items,
        ['album', 'single', 'ep'],
        new Set<ReleaseKind>(['ep']),
    );
    assert.deepEqual(epsOff.kinds, ['single']);
    assert.deepEqual(keys(chipRow(items, epsOff, 4)), ['s1']);
});

test('noChipsForNothing', () => {
    assert.deepEqual(discographyChips([], ['album'], new Set()), []);
    // Only appears on: no Discography chips at all (the page shows Appears on alone).
    const only = [item({ key: 'o1', kind: 'appears-on' })];
    assert.deepEqual(discographyChips(only, ['album', 'appears-on'], new Set()), []);
});

test('popularFallsBackToWhateverExists', () => {
    // Only missing singles: Popular's own rule picks none (missing albums only), so it falls back.
    const items = [
        item({ key: 's1', kind: 'single', ownership: 'missing', year: 2001 }),
        item({ key: 's2', kind: 'single', ownership: 'missing', year: 2010 }),
    ];
    const chips = discographyChips(items, ['album', 'single'], new Set());
    assert.deepEqual(chipKinds(chips), ['popular', 'singles-and-eps']);
    assert.deepEqual(keys(chipRow(items, chips[0], 4)), ['s2', 's1']);
});

test('popularRowLeavesAppearsOnOut', () => {
    const items = [
        item({ key: 'o1', kind: 'appears-on', plays: 99 }),
        item({ key: 'a1', plays: 1 }),
    ];
    const [popular] = discographyChips(items, ['album', 'appears-on'], new Set());
    assert.deepEqual(keys(chipRow(items, popular, 4)), ['a1']);
});

test('chipRowNeverLongerThanItemsPerRow', () => {
    const items = Array.from({ length: 9 }, (_, i) =>
        item({ key: `a${i}`, plays: i, year: 2000 + i }),
    );
    const chips = discographyChips(items, ['album'], new Set());
    for (const chip of chips) {
        for (const perRow of [1, 2, 4, 6, 12]) {
            assert.ok(chipRow(items, chip, perRow).length <= perRow);
        }
    }
    assert.deepEqual(keys(chipRow(items, chips[1], 3)), ['a8', 'a7', 'a6']);
});

test('popularLeavesSwitchedOffKindsOut', () => {
    // The most played release is live, and Live is switched off: no chip for it, so Popular
    // releases must not show it either.
    const items = [item({ key: 'l1', kind: 'live', plays: 99 }), item({ key: 'a1', plays: 1 })];
    const chips = discographyChips(items, ['album', 'live'], new Set<ReleaseKind>(['live']));
    assert.deepEqual(chipKinds(chips), ['popular', 'album']);
    assert.equal(chips[0].total, 1);
    assert.deepEqual(keys(chipRow(items, chips[0], 4)), ['a1']);
});

test('anArtistWithOnlyAppearsOnStillReachesTheScan', () => {
    // B-369: an owned artist whose library albums are all someone else's (Appears on) has no
    // chip. The Discography line, with its link to the discography page where lb-bot's scan
    // lives, must still show while lb-bot can scan them, with an empty row; it used to vanish.
    const items = [item({ key: 'a', kind: 'appears-on' }), item({ key: 'b', kind: 'appears-on' })];
    const chips = discographyChips(items, ['album', 'single', 'appears-on'], new Set());
    assert.deepEqual(chips, []);
    assert.equal(discographyLine(chips, true), 'empty');
    assert.equal(discographyLine(chips, false), 'none', 'no lb-bot: nothing to reach');
    const own = discographyChips(
        [...items, item({ key: 'c' })],
        ['album', 'single', 'appears-on'],
        new Set(),
    );
    assert.equal(discographyLine(own, true), 'chips');
    assert.equal(discographyLine(own, false), 'chips');
});

test('aFailedLbBotAnswerIsNotScannable', () => {
    // B-369 review finding 4: main answers the discography read `null` when lb-bot is unreachable
    // or erroring, and LbBotIndexButton hides on it. The line must stay away then too
    // (navi-connect/CLAUDE.md §7: lb-bot unreachable renders nothing, the page looks as before).
    assert.equal(lbBotCanScan(undefined), false, 'not configured');
    assert.equal(lbBotCanScan(null), false, 'lb-bot down: the empty line showed with no scan');
    assert.equal(lbBotCanScan({ releases: [] }), true);
});
