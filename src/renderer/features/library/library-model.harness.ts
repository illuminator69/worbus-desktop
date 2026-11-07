import assert from 'node:assert/strict';
import test from 'node:test';

import type { LibraryArtist, Lookup } from './library-model.ts';

import { buildFuzzyIndex } from '../../../shared/utils/fuzzy-match.ts';
import {
    buildOwnedByMbid,
    externalLookupWanted,
    gapCount,
    isLinkShaped,
    isPastedLink,
    libraryPhase,
    parseLibraryParams,
    rankArtists,
    serializeLibraryParams,
    sortArtists,
    sortedColumnsFor,
    splitExternalArtists,
} from './library-model.ts';

/**
 * F6:  node --test src/renderer/features/library/library-model.harness.ts
 *
 * The Artists page's model: sorting and ranking your artists, which MusicBrainz candidates you own
 * (by MBID, never by name), what the page shows for a query and a lookup state, the URL it keeps,
 * and which table columns carry a sort.
 */

const artist = (id: string, name: string, patch: Partial<LibraryArtist> = {}): LibraryArtist => ({
    albumCount: null,
    id,
    mbz: null,
    name,
    playCount: null,
    ...patch,
});

const names = (list: readonly LibraryArtist[]) => list.map((a) => a.name);

test('aToZIsStableCaseInsensitiveAndKeepsThe', () => {
    const list = [
        artist('1', 'the Wrens of May'),
        artist('2', 'abba'),
        artist('3', 'Björk'),
        artist('4', 'ABBA'),
        artist('5', 'Zola'),
        artist('6', 'Bjork'),
    ];
    assert.deepEqual(names(sortArtists(list, 'az')), [
        'abba',
        'ABBA',
        'Björk',
        'Bjork',
        'the Wrens of May',
        'Zola',
    ]);
    // The input is not changed.
    assert.equal(list[0].name, 'the Wrens of May');
});

test('playsAndReleasesSortHighestFirstTiesByName', () => {
    const list = [
        artist('1', 'Moth', { albumCount: 2, playCount: 10 }),
        artist('2', 'Kiosk', { albumCount: 5, playCount: null }),
        artist('3', 'Abba', { albumCount: 2, playCount: 10 }),
        artist('4', 'Zed', { albumCount: null, playCount: 40 }),
    ];
    assert.deepEqual(names(sortArtists(list, 'plays')), ['Zed', 'Abba', 'Moth', 'Kiosk']);
    assert.deepEqual(names(sortArtists(list, 'releases')), ['Kiosk', 'Abba', 'Moth', 'Zed']);
});

const indexOf = (list: LibraryArtist[]) =>
    buildFuzzyIndex(list.map((a) => ({ text: a.name, value: a })));

test('rankArtistsOrdersByMatchThenTheSort', () => {
    const list = [artist('1', 'Pale Kiosk'), artist('2', 'Kiosk'), artist('3', 'Moth Season')];
    const ranked = rankArtists(indexOf(list), 'kiosc', 'az');
    assert.deepEqual(
        ranked.map((r) => r.artist.name),
        ['Kiosk', 'Pale Kiosk'],
    );
    assert.deepEqual(
        ranked.map((r) => r.tier),
        ['typo', 'typo'],
    );
    const blank = rankArtists(indexOf(list), '  ', 'az');
    assert.deepEqual(
        blank.map((r) => r.artist.name),
        ['Kiosk', 'Moth Season', 'Pale Kiosk'],
    );
    assert.ok(blank.every((r) => r.tier === 'exact'));
});

test('equalScoresFollowTheChosenSort', () => {
    const list = [
        artist('1', 'Pale Kiosk', { playCount: 1 }),
        artist('2', 'Low Kiosk', { playCount: 9 }),
        artist('3', 'Kiosk', { playCount: 0 }),
    ];
    const index = indexOf(list);
    assert.deepEqual(
        rankArtists(index, 'kiosk', 'az').map((r) => r.artist.name),
        ['Kiosk', 'Low Kiosk', 'Pale Kiosk'],
    );
    assert.deepEqual(
        rankArtists(index, 'kiosk', 'plays').map((r) => r.artist.name),
        ['Kiosk', 'Low Kiosk', 'Pale Kiosk'],
    );
    const sameScore = [artist('a', 'Pale Kiosk', { playCount: 1 }), artist('b', 'Low Kiosk')];
    assert.deepEqual(
        rankArtists(indexOf(sameScore), 'kiosk', 'plays').map((r) => r.artist.name),
        ['Pale Kiosk', 'Low Kiosk'],
    );
    assert.deepEqual(
        rankArtists(indexOf(sameScore), 'kiosk', 'az').map((r) => r.artist.name),
        ['Low Kiosk', 'Pale Kiosk'],
    );
});

test('limitCutsAfterOrdering', () => {
    const list = [artist('1', 'Pale Kiosk'), artist('2', 'Low Kiosk'), artist('3', 'Kiosk')];
    assert.deepEqual(
        rankArtists(indexOf(list), 'kiosk', 'az', 2).map((r) => r.artist.name),
        ['Kiosk', 'Low Kiosk'],
    );
    assert.equal(rankArtists(indexOf(list), '', 'az', 1).length, 1);
});

const candidate = (mbid: string, name: string) => ({
    country: '',
    disambiguation: '',
    mbid,
    name,
    type: '',
});

test('sameNameCandidatesSplitByMbid', () => {
    const split = splitExternalArtists(
        [candidate('A', 'Pale Kiosk'), candidate('B', 'Pale Kiosk')],
        { A: 'nd1' },
    );
    assert.deepEqual(
        split.map((s) => [s.candidate.mbid, s.ownedId]),
        [
            ['A', 'nd1'],
            ['B', null],
        ],
    );
    // MusicBrainz order is kept, owned or not.
    assert.deepEqual(
        splitExternalArtists([candidate('B', 'x'), candidate('A', 'y')], { A: 'nd1' }).map(
            (s) => s.candidate.mbid,
        ),
        ['B', 'A'],
    );
});

test('ownershipByMbid', () => {
    const owned = buildOwnedByMbid(
        [
            { id: 'nd1', mbz: 'mb-1' },
            { id: 'nd2', mbz: '' },
            { id: 'nd3', mbz: null },
            { id: 'nd4', mbz: 'mb-4' },
        ],
        [
            // Navidrome's mbz wins over the mirror for the same MBID.
            { mbid: 'mb-1', ndArtistId: 'nd3' },
            // A blank Navidrome id is ignored.
            { mbid: 'mb-2', ndArtistId: '' },
            // A Navidrome id the loaded list does not have is ignored.
            { mbid: 'mb-5', ndArtistId: 'gone' },
            // The mirror alone can own one.
            { mbid: 'mb-6', ndArtistId: 'nd2' },
        ],
    );
    assert.deepEqual(owned, { 'mb-1': 'nd1', 'mb-4': 'nd4', 'mb-6': 'nd2' });
    assert.equal('' in owned, false);
});

test('gapCountCountsOnlyIncomplete', () => {
    assert.equal(
        gapCount([
            { status: 'incomplete' },
            { status: 'complete' },
            { status: 'incomplete' },
            { status: 'missing' },
        ]),
        2,
    );
    assert.equal(gapCount([]), 0);
});

test('externalLookupWanted', () => {
    assert.equal(externalLookupWanted('ab'), false);
    assert.equal(externalLookupWanted('abc'), true);
    assert.equal(externalLookupWanted('a b'), false);
    assert.equal(externalLookupWanted('米津'), true);
    assert.equal(externalLookupWanted('米'), false);
    assert.equal(externalLookupWanted('  x '), false);
    assert.equal(externalLookupWanted('spotify.com/album'), false);
    assert.equal(externalLookupWanted('https://open.spotify.com/album/x'), false);
    assert.equal(externalLookupWanted('AC/DC'), true);
});

test('links', () => {
    assert.equal(isPastedLink('https://open.spotify.com/album/x'), true);
    assert.equal(isPastedLink('  https://open.spotify.com/album/x '), true);
    assert.equal(isPastedLink('http://x'), true);
    assert.equal(isPastedLink('kiosk'), false);
    assert.equal(isPastedLink('spotify.com/album'), false);
    assert.equal(isPastedLink('https://a b'), false);
    assert.equal(isLinkShaped('https://open.spotify.com/album/x'), true);
    assert.equal(isLinkShaped('spotify.com/album'), true);
    assert.equal(isLinkShaped('www.deezer.com/album/1'), true);
    assert.equal(isLinkShaped('kiosk'), false);
    assert.equal(isLinkShaped('AC/DC'), false);
});

const phase = (
    query: string,
    ownedCount: number,
    lookup: Lookup<unknown>,
    lookupAvailable = true,
) => libraryPhase({ lookup, lookupAvailable, ownedCount, query });

test('libraryPhase', () => {
    const idle: Lookup<unknown> = { kind: 'idle' };
    const looking: Lookup<unknown> = { kind: 'looking' };
    const failed: Lookup<unknown> = { kind: 'failed' };
    const older: Lookup<unknown> = { kind: 'older' };
    const empty: Lookup<unknown> = { items: [], kind: 'done' };
    const some: Lookup<unknown> = { items: [1], kind: 'done' };

    // The blank query first, whatever else is true.
    assert.equal(phase('', 5, some), 'browse');
    assert.equal(phase('   ', 0, failed), 'browse');
    assert.equal(phase('kiosk', 3, empty), 'results');
    assert.equal(phase('kiosk', 0, looking), 'results');
    // The 300 ms before the lookup starts.
    assert.equal(phase('kiosk', 0, idle), 'results');
    assert.equal(phase('kiosk', 0, failed), 'results');
    assert.equal(phase('kiosk', 0, failed, false), 'results');
    assert.equal(phase('kiosk', 0, some), 'results');
    assert.equal(phase('kiosk', 0, empty), 'none');
    assert.equal(phase('kiosk', 0, older), 'none');
    assert.equal(phase('kiosk', 0, idle, false), 'none');
    assert.equal(phase('ki', 0, idle), 'none');
    assert.equal(phase('spotify.com/album', 0, idle), 'none');
});

test('sortedColumnsFor', () => {
    assert.deepEqual(sortedColumnsFor('rating'), ['userRating']);
    assert.deepEqual(sortedColumnsFor('bitRate'), ['bitRate']);
    // TableColumn.TITLE's value is 'name'.
    assert.deepEqual(sortedColumnsFor('name'), ['name', 'titleCombined', 'titleArtist']);
    assert.deepEqual(sortedColumnsFor('duration'), ['duration']);
    assert.deepEqual(sortedColumnsFor('recentlyAdded'), ['createdAt']);
    assert.deepEqual(sortedColumnsFor('playCount'), ['playCount']);
    assert.deepEqual(sortedColumnsFor('year'), ['year']);
    assert.deepEqual(sortedColumnsFor('random'), []);
    assert.deepEqual(sortedColumnsFor('nonsense'), []);
});

test('libraryParams', () => {
    assert.deepEqual(parseLibraryParams('q=kiosc&sort=plays'), { q: 'kiosc', sort: 'plays' });
    assert.deepEqual(parseLibraryParams('?q=kiosc&sort=releases'), {
        q: 'kiosc',
        sort: 'releases',
    });
    assert.deepEqual(parseLibraryParams('sort=popular'), { q: '', sort: 'az' });
    assert.equal(parseLibraryParams(`q=${'x'.repeat(300)}`).q.length, 200);
    assert.deepEqual(parseLibraryParams(''), { q: '', sort: 'az' });
    assert.equal(serializeLibraryParams({ q: '', sort: 'az' }), '');
    assert.equal(serializeLibraryParams({ q: '', sort: 'plays' }), 'sort=plays');
    for (const params of [
        { q: 'pale kiosk', sort: 'az' as const },
        { q: 'AC/DC & co?', sort: 'releases' as const },
        { q: '米津', sort: 'plays' as const },
    ]) {
        assert.deepEqual(parseLibraryParams(serializeLibraryParams(params)), params);
    }
});
