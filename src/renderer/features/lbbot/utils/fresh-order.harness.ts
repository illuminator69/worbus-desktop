import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
    FRESH_SCOPE_WORDS,
    FRESH_SHELF_SIZE,
    FRESH_TYPE_WORDS,
    freshBuckets,
    freshScopeInEffect,
    freshShelf,
    freshShelfReason,
    freshTileTarget,
    freshTypeBucket,
    WEEK_BUCKETS,
    weekBucketFor,
} from './fresh-order.ts';

/**
 * B-286:  node --test src/renderer/features/lbbot/utils/fresh-order.harness.ts
 *
 * Home's and Discover's Fresh shelf kept owned artists' rows in feed order from a fixed 30-day
 * window, while the Fresh page read the persisted filters (window, scope, type, sort) and ordered
 * its rows in week buckets or A-Z. The page's ordering is now one pure function, and the shelf is
 * the first N rows of the very same answer, read from the same store and the same query key.
 */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const NOW = Date.parse('2026-10-30T12:00:00Z');

interface Row {
    artist: string;
    artistOwned: boolean;
    artistPlays?: number;
    releaseDate: string;
    releaseName: string;
    type: string;
}

const row = (artist: string, releaseDate: string, patch: Partial<Row> = {}): Row => ({
    artist,
    artistOwned: true,
    releaseDate,
    releaseName: `${artist} LP`,
    type: 'Album',
    ...patch,
});

// A feed covering every case: every week bucket, an undated row, owned and unowned artists, plays
// on some rows, every type including an empty and an unknown one. In feed order (not the page's).
const FEED: Row[] = [
    row('Earl', '2026-09-01', { artistPlays: 3 }),
    row('Undated', '', { type: '' }),
    row('Thea', '2026-10-28', { artistOwned: false, artistPlays: 40, type: 'EP' }),
    row('Upco', '2026-11-05', { type: 'Single' }),
    row('Lars', '2026-10-20', { artistPlays: 12, type: 'single' }),
    row('Twon', '2026-10-14', { type: 'Broadcast' }),
    row('Abel', '2026-10-28', { type: 'ep' }),
    row('Thri', '2026-10-08', { artistOwned: false }),
    row('Zed', '2026-10-29', { artistOwned: false, type: '' }),
];

const names = (rows: readonly Row[]) => rows.map((r) => r.artist);
const flat = (buckets: { releases: Row[] }[]) => buckets.flatMap((b) => b.releases);

test('weekBucketFor: upcoming, this week back to three weeks, and an undated row sinks to Earlier', () => {
    assert.deepEqual(
        [
            '2026-11-05',
            '2026-10-28',
            '2026-10-20',
            '2026-10-14',
            '2026-10-08',
            '2026-09-01',
            '',
            'x',
        ].map((date) => weekBucketFor(date, NOW)),
        [
            'Upcoming',
            'This week',
            'Last week',
            '2 weeks ago',
            '3 weeks ago',
            'Earlier',
            'Earlier',
            'Earlier',
        ],
    );
    assert.deepEqual(
        [...WEEK_BUCKETS],
        ['Upcoming', 'This week', 'Last week', '2 weeks ago', '3 weeks ago', 'Earlier'],
    );
});

test('freshTypeBucket: the three known types any case, everything else (empty too) is other', () => {
    assert.equal(freshTypeBucket('Album'), 'album');
    assert.equal(freshTypeBucket('EP'), 'ep');
    assert.equal(freshTypeBucket('single'), 'single');
    assert.equal(freshTypeBucket(''), 'other');
    assert.equal(freshTypeBucket('Broadcast'), 'other');
    assert.equal(freshTypeBucket(undefined), 'other');
});

test('newest: week buckets newest first, newest first inside a bucket, the artist breaking ties', () => {
    const buckets = freshBuckets(FEED, { scope: 'all', sort: 'newest', type: 'all' }, NOW);
    assert.deepEqual(
        buckets.map((b) => [b.label, names(b.releases)]),
        [
            ['Upcoming', ['Upco']],
            ['This week', ['Zed', 'Abel', 'Thea']],
            ['Last week', ['Lars']],
            ['2 weeks ago', ['Twon']],
            ['3 weeks ago', ['Thri']],
            ['Earlier', ['Earl', 'Undated']],
        ],
    );
});

test('scope: mine keeps owned artists, all keeps every row', () => {
    const mine = freshBuckets(FEED, { scope: 'mine', sort: 'newest', type: 'all' }, NOW);
    assert.deepEqual(names(flat(mine)), ['Upco', 'Abel', 'Lars', 'Twon', 'Earl', 'Undated']);
    assert.equal(
        flat(freshBuckets(FEED, { scope: 'all', sort: 'newest', type: 'all' }, NOW)).length,
        9,
    );
});

test('plays: one unlabelled bucket, most played first, whatever the sort says', () => {
    for (const sort of ['newest', 'artist'] as const) {
        const buckets = freshBuckets(FEED, { scope: 'plays', sort, type: 'all' }, NOW);
        assert.deepEqual(
            buckets.map((b) => [b.label, names(b.releases)]),
            [['', ['Thea', 'Lars', 'Earl']]],
        );
    }
});

test('a stored plays scope with no plays data reads as mine, on the shelf as on the page', () => {
    const noPlays = FEED.map((r) => ({ ...r, artistPlays: undefined }));
    assert.equal(freshScopeInEffect(noPlays, 'plays'), 'mine');
    assert.equal(freshScopeInEffect(FEED, 'plays'), 'plays');
    assert.deepEqual(
        freshBuckets(noPlays, { scope: 'plays', sort: 'newest', type: 'all' }, NOW),
        freshBuckets(noPlays, { scope: 'mine', sort: 'newest', type: 'all' }, NOW),
    );
    assert.deepEqual(
        freshShelf(noPlays, { scope: 'plays', sort: 'newest', type: 'all' }, NOW),
        freshShelf(noPlays, { scope: 'mine', sort: 'newest', type: 'all' }, NOW),
    );
});

test('type: each bucket, other catching the empty and the unknown types', () => {
    const of = (type: 'album' | 'ep' | 'other' | 'single') =>
        names(flat(freshBuckets(FEED, { scope: 'all', sort: 'newest', type }, NOW)));
    assert.deepEqual(of('album'), ['Thri', 'Earl']);
    assert.deepEqual(of('ep'), ['Abel', 'Thea']);
    assert.deepEqual(of('single'), ['Upco', 'Lars']);
    assert.deepEqual(of('other'), ['Zed', 'Twon', 'Undated']);
});

test('artist: one unlabelled A-Z bucket, the release name breaking ties', () => {
    const rows = [...FEED, row('Abel', '2026-01-01', { releaseName: 'Abel Early' })];
    const buckets = freshBuckets(rows, { scope: 'all', sort: 'artist', type: 'all' }, NOW);
    assert.equal(buckets.length, 1);
    assert.equal(buckets[0].label, '');
    assert.deepEqual(
        buckets[0].releases.map((r) => r.releaseName),
        [
            'Abel Early',
            'Abel LP',
            'Earl LP',
            'Lars LP',
            'Thea LP',
            'Thri LP',
            'Twon LP',
            'Undated LP',
            'Upco LP',
            'Zed LP',
        ],
    );
});

test('nothing: no rows, or a filter leaving none, is no bucket at all', () => {
    assert.deepEqual(
        freshBuckets(undefined, { scope: 'all', sort: 'newest', type: 'all' }, NOW),
        [],
    );
    assert.deepEqual(
        freshBuckets(
            [row('Only', '2026-10-28', { artistOwned: false })],
            {
                scope: 'mine',
                sort: 'newest',
                type: 'all',
            },
            NOW,
        ),
        [],
    );
    assert.deepEqual(freshShelf([], { scope: 'all', sort: 'newest', type: 'all' }, NOW), []);
});

test('theShelfIsThePagesFirstRows, against ids written out by hand', () => {
    // Each expectation is the page's order read off the FEED above by hand, not computed from
    // freshBuckets, so a change to the page's order shows here as a change to the shelf.
    const shelf = (filters: Parameters<typeof freshShelf>[1], size?: number) =>
        names(freshShelf(FEED, filters, NOW, size));
    // Defaults (mine, newest, all): owned artists, week buckets newest first.
    assert.deepEqual(shelf({ scope: 'mine', sort: 'newest', type: 'all' }, 4), [
        'Upco',
        'Abel',
        'Lars',
        'Twon',
    ]);
    // All: the unowned artists join, Zed newest of this week.
    assert.deepEqual(shelf({ scope: 'all', sort: 'newest', type: 'all' }, 4), [
        'Upco',
        'Zed',
        'Abel',
        'Thea',
    ]);
    // Plays: most played first, rows without plays dropped.
    assert.deepEqual(shelf({ scope: 'plays', sort: 'newest', type: 'all' }), [
        'Thea',
        'Lars',
        'Earl',
    ]);
    // EP, and A-Z, and the empty type under other.
    assert.deepEqual(shelf({ scope: 'all', sort: 'newest', type: 'ep' }), ['Abel', 'Thea']);
    assert.deepEqual(shelf({ scope: 'all', sort: 'artist', type: 'all' }, 3), [
        'Abel',
        'Earl',
        'Lars',
    ]);
    assert.deepEqual(shelf({ scope: 'mine', sort: 'artist', type: 'single' }), ['Lars', 'Upco']);
    assert.deepEqual(shelf({ scope: 'all', sort: 'newest', type: 'other' }), [
        'Zed',
        'Twon',
        'Undated',
    ]);
    // A filter leaving nothing.
    assert.deepEqual(shelf({ scope: 'plays', sort: 'newest', type: 'ep' }), ['Thea']);
    assert.deepEqual(shelf({ scope: 'mine', sort: 'newest', type: 'ep' }), ['Abel']);
    assert.deepEqual(
        names(
            freshShelf(
                [row('Only', '2026-10-28', { artistOwned: false })],
                { scope: 'mine', sort: 'newest', type: 'all' },
                NOW,
            ),
        ),
        [],
    );

    // The shelf's cut: 25 rows A-Z from a feed in reverse order, the first 20 written out.
    const letters = 'YXWVUTSRQPONMLKJIHGFEDCBA'.split('');
    const long = letters.map((letter) => row(letter, '2026-10-20'));
    assert.equal(FRESH_SHELF_SIZE, 20);
    assert.deepEqual(names(freshShelf(long, { scope: 'mine', sort: 'artist', type: 'all' }, NOW)), [
        'A',
        'B',
        'C',
        'D',
        'E',
        'F',
        'G',
        'H',
        'I',
        'J',
        'K',
        'L',
        'M',
        'N',
        'O',
        'P',
        'Q',
        'R',
        'S',
        'T',
    ]);
});

test('aTileWithNoReleaseGroupOpensNothing', () => {
    // The page's guard, now shared: an owned album opens the library album, a release group the
    // virtual page, and a row with neither opens nothing and offers no acquire (R18 review M-8).
    assert.deepEqual(freshTileTarget({ releaseAlbumId: 'al-1', releaseGroupMbid: 'rg-1' }), {
        albumId: 'al-1',
        kind: 'library',
    });
    assert.deepEqual(freshTileTarget({ releaseAlbumId: '', releaseGroupMbid: 'rg-1' }), {
        kind: 'external',
        rgid: 'rg-1',
    });
    assert.equal(freshTileTarget({ releaseAlbumId: '', releaseGroupMbid: '' }), null);
    // Both the page and the shelf read it (grep-only).
    const shelf = read('../../discover/components/fresh-row.tsx');
    const page = read('../routes/lbbot-fresh-route.tsx');
    assert.match(shelf, /freshTileTarget\(/);
    assert.match(page, /freshTileTarget\(/);
    // The shelf's acquire control and its click both wait for a target (grep-only).
    assert.match(shelf, /target\?\.kind === 'external' && !release\.releaseOwned \?/);
    assert.match(shelf, /onClick=\{\s*target\s*\? \(\) =>/);
});

test('theReasonFollowsTheScopeAndNamesAWindowThatIsNot30Days', () => {
    assert.equal(freshShelfReason('mine', 30), FRESH_SCOPE_WORDS.mine.reason);
    assert.match(freshShelfReason('mine', 30), /artists already in your library/);
    assert.doesNotMatch(freshShelfReason('all', 30), /in your library/);
    assert.doesNotMatch(freshShelfReason('plays', 30), /already in your library/);
    assert.doesNotMatch(freshShelfReason('mine', 30), /days/);
    assert.match(freshShelfReason('all', 7), /7 days/);
    assert.match(freshShelfReason('plays', 90), /90 days/);
    // A type filter is named too, so a shelf of EPs says why it has no albums (M-9).
    assert.equal(freshShelfReason('mine', 30, 'all'), FRESH_SCOPE_WORDS.mine.reason);
    assert.equal(freshShelfReason('mine', 30, 'ep'), `${FRESH_SCOPE_WORDS.mine.reason} · EPs`);
    assert.equal(
        freshShelfReason('all', 7, 'single'),
        `${FRESH_SCOPE_WORDS.all.reason} in the last 7 days · Singles`,
    );
    assert.deepEqual(FRESH_TYPE_WORDS, {
        album: 'Albums',
        all: 'All',
        ep: 'EPs',
        other: 'Other',
        single: 'Singles',
    });
    // The page's scope chips read the same words.
    assert.deepEqual(
        Object.values(FRESH_SCOPE_WORDS)
            .map((w) => w.label)
            .sort(),
        ['All', 'Artists you play', 'Your artists'],
    );
});

test('thePageAndTheShelfReadTheSameFunctionsAndTheSameQuery', () => {
    const page = read('../routes/lbbot-fresh-route.tsx');
    assert.match(page, /freshBuckets\(/);
    assert.match(page, /FRESH_SCOPE_WORDS/);
    assert.match(page, /FRESH_TYPE_WORDS/);
    // One spelling of the scope rule: the page asks freshScopeInEffect, as the shelf does (M-11).
    assert.match(page, /freshScopeInEffect\(data\?\.releases, storedScope\)/);
    assert.doesNotMatch(page, /scopeInEffect\(storedScope/);
    // The ordering lives in one place now.
    assert.doesNotMatch(page, /const weekBucketFor|const WEEK_BUCKETS|const typeBucket/);
    assert.doesNotMatch(page, /'Your artists'|'Artists you play'/);

    const shelf = read('../../discover/components/fresh-row.tsx');
    assert.match(shelf, /freshShelf\(/);
    assert.match(shelf, /freshScopeInEffect\(/);
    assert.match(shelf, /freshShelfReason\(scope, days, type\)/);
    for (const hook of ['useFreshDays', 'useFreshScope', 'useFreshSort', 'useFreshType']) {
        assert.match(shelf, new RegExp(`${hook}\\(\\)`), hook);
    }
    // The page's query key for the window, never a second fixed window.
    assert.match(shelf, /useLbBotFreshReleases\(days\)/);
    assert.doesNotMatch(shelf, /useLbBotFreshReleases\(30\)/);
    assert.doesNotMatch(shelf, /\.filter\(\(r\) => r\.artistOwned\)/);
    // A placeholder answer (the previous window) is held dimmed, never shown as this window's, and
    // dropped when lb-bot cannot answer, as on the page.
    assert.match(shelf, /isPlaceholderData/);
    assert.match(shelf, /switching && !available \? undefined : query\.data/);
    assert.match(shelf, /isStale=\{switching\}/);
});
