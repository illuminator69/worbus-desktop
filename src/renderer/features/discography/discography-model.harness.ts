import assert from 'node:assert/strict';
import test from 'node:test';

import {
    buildItems,
    chipCounts,
    type DiscographyItem,
    type DiscographyView,
    type FillInput,
    filterItems,
    kindSettings,
    type OwnedAlbumInput,
    type ReleaseRowInput,
    sectionsOf,
    sortItems,
    summaryOf,
} from './discography-model.ts';

/**
 * F7: the discography's one model. Owned albums (Navidrome) and lb-bot's index rows become one
 * list of releases, each with one kind and one ownership state, then filtered, sorted and cut
 * into sections by the page's view.
 *
 *     node --test src/renderer/features/discography/discography-model.harness.ts
 */

const owned = (over: Partial<OwnedAlbumInput> = {}): OwnedAlbumInput => ({
    addedAt: null,
    creditedAsAlbumArtist: true,
    favorite: false,
    id: 'al-1',
    isCompilation: false,
    name: 'Lantern Season',
    playCount: 0,
    releaseTypes: ['album'],
    rgid: 'rg-1',
    year: 2024,
    ...over,
});

const row = (over: Partial<ReleaseRowInput> = {}): ReleaseRowInput => ({
    navidromeAlbumIds: [],
    primaryType: 'album',
    rgid: 'rg-9',
    secondaryTypes: [],
    status: 'missing',
    title: 'Low Country',
    year: '2013',
    ...over,
});

const view = (over: Partial<DiscographyView> = {}): DiscographyView => ({
    dir: 'desc',
    own: 'all',
    sort: 'year',
    type: 'all',
    ...over,
});

const keys = (items: DiscographyItem[]) => items.map((item) => item.key);

test('an owned album that lb-bot lists by rgid is one item (owned), not two', () => {
    const items = buildItems(
        [owned()],
        [row({ rgid: 'rg-1', status: 'complete', title: 'Lantern Season' })],
        [],
    );
    assert.equal(items.length, 1);
    assert.equal(items[0].ownership, 'owned');
    assert.equal(items[0].albumId, 'al-1');
});

test("an owned album whose id is in a row's navidromeAlbumIds is that row's item", () => {
    const items = buildItems(
        [owned({ name: 'Wintering', rgid: '' })],
        [
            row({
                navidromeAlbumIds: ['al-0', 'al-1'],
                rgid: 'rg-w',
                status: 'complete',
                title: 'Wintering',
            }),
        ],
        [],
    );
    assert.equal(items.length, 1);
    assert.equal(items[0].rgid, 'rg-w');
    assert.equal(items[0].ownership, 'owned');
});

test('an owned album tagged plain album whose matched row has secondary live is kind live', () => {
    const items = buildItems(
        [owned()],
        [row({ rgid: 'rg-1', secondaryTypes: ['live'], status: 'complete' })],
        [],
    );
    assert.equal(items[0].kind, 'live');
});

test('an unmatched owned album uses its own types', () => {
    const items = buildItems(
        [owned({ releaseTypes: ['album', 'soundtrack'], rgid: 'rg-x' })],
        [],
        [],
    );
    assert.equal(items[0].kind, 'soundtrack');
});

test('compilation by flag, by type and by row agree', () => {
    const flag = buildItems([owned({ isCompilation: true, rgid: '' })], [], [])[0];
    const type = buildItems(
        [owned({ releaseTypes: ['album', 'compilation'], rgid: '' })],
        [],
        [],
    )[0];
    const byRow = buildItems(
        [owned()],
        [row({ rgid: 'rg-1', secondaryTypes: ['compilation'], status: 'complete' })],
        [],
    )[0];
    const flagAndRow = buildItems(
        [owned({ isCompilation: true })],
        [row({ rgid: 'rg-1', secondaryTypes: ['compilation'], status: 'complete' })],
        [],
    )[0];
    const missing = buildItems([], [row({ secondaryTypes: ['compilation'] })], [])[0];
    assert.deepEqual(
        [flag.kind, type.kind, byRow.kind, flagAndRow.kind, missing.kind],
        ['compilation', 'compilation', 'compilation', 'compilation', 'compilation'],
    );
});

test('an incomplete row with a group id is partly with 9 of 12', () => {
    const items = buildItems(
        [owned({ id: 'al-u', name: 'Undertow', rgid: 'rg-u' })],
        [
            row({
                groupId: 'g-1',
                presentTracks: 9,
                rgid: 'rg-u',
                status: 'incomplete',
                totalTracks: 12,
            }),
        ],
        [],
    );
    assert.equal(items[0].ownership, 'partly');
    assert.deepEqual(items[0].gap, { groupId: 'g-1', present: 9, total: 12 });
});

test('an incomplete row with no group id is owned (nothing to act on)', () => {
    const items = buildItems(
        [owned({ rgid: 'rg-u' })],
        [row({ presentTracks: 9, rgid: 'rg-u', status: 'incomplete', totalTracks: 12 })],
        [],
    );
    assert.equal(items[0].ownership, 'owned');
    assert.equal(items[0].gap, null);
});

test('a non-missing row with no album ids is syncing', () => {
    const items = buildItems([], [row({ status: 'complete' })], []);
    assert.equal(items[0].ownership, 'syncing');
    assert.equal(items[0].albumId, null);
});

test('a missing row with no fill is missing', () => {
    const items = buildItems([], [row()], []);
    assert.equal(items[0].ownership, 'missing');
    assert.equal(items[0].fill, null);
    assert.equal(items[0].key, 'rg-9');
});

test('a missing row with an unsettled fill stays missing and carries the fill', () => {
    const fill: FillInput = {
        outcome: 'running',
        rgid: 'rg-9',
        settled: false,
        state: 'downloading',
    };
    const items = buildItems([], [row()], [fill]);
    assert.equal(items[0].ownership, 'missing');
    assert.deepEqual(items[0].fill, fill);
});

test('a missing row whose fill landed is syncing, never missing (the index lags the fill)', () => {
    const done: FillInput = { outcome: 'done', rgid: 'rg-9', settled: true, state: 'verified' };
    const placed: FillInput = { outcome: 'running', rgid: 'rg-9', settled: false, state: 'placed' };
    const failed: FillInput = { outcome: 'failed', rgid: 'rg-9', settled: true, state: 'failed' };
    assert.equal(buildItems([], [row()], [done])[0].ownership, 'syncing');
    assert.equal(buildItems([], [row()], [placed])[0].ownership, 'syncing');
    assert.equal(buildItems([], [row()], [failed])[0].ownership, 'missing');
});

test('two rows naming one Navidrome album draw it once', () => {
    const items = buildItems(
        [owned({ id: 'a', name: 'Kid A', rgid: 'rg-1' })],
        [
            row({ navidromeAlbumIds: ['a'], rgid: 'rg-1', status: 'complete', title: 'Kid A' }),
            row({
                navidromeAlbumIds: ['a'],
                rgid: 'rg-2',
                status: 'complete',
                title: 'Kid A Mnemonic',
            }),
            row({ navidromeAlbumIds: ['b'], rgid: 'rg-3', status: 'complete', title: 'Amnesiac' }),
            row({
                navidromeAlbumIds: ['b'],
                rgid: 'rg-4',
                status: 'complete',
                title: 'Amnesiac (deluxe)',
            }),
        ],
        [],
    );
    assert.deepEqual(keys(items), ['a', 'b']);
});

test('a row naming a Navidrome album the page has not listed yet is owned, not dropped', () => {
    const items = buildItems([], [row({ navidromeAlbumIds: ['al-new'], status: 'complete' })], []);
    assert.equal(items.length, 1);
    assert.equal(items[0].ownership, 'owned');
    assert.equal(items[0].albumId, 'al-new');
});

test('a missing row whose title matches an owned album after titleKey is dropped (Kid A / Kid A (Remastered))', () => {
    const items = buildItems(
        [
            owned({ name: 'Kid A', rgid: 'rg-a' }),
            owned({ id: 'al-2', name: 'Hail to the Thief', rgid: 'rg-h' }),
        ],
        [
            row({ rgid: 'rg-k', title: 'Kid A (Remastered)' }),
            // A dash suffix is a different record: it stays.
            row({ rgid: 'rg-l', title: 'Hail to the Thief - Live' }),
        ],
        [],
    );
    assert.deepEqual(keys(items).sort(), ['al-1', 'al-2', 'rg-l']);
});

test('appears-on for an owned album the artist is not credited on', () => {
    const items = buildItems(
        [owned({ creditedAsAlbumArtist: false })],
        [row({ rgid: 'rg-1', secondaryTypes: ['live'], status: 'complete' })],
        [],
    );
    assert.equal(items[0].kind, 'appears-on');
});

const mixed = (): DiscographyItem[] =>
    buildItems(
        [
            owned({
                addedAt: 300,
                id: 'a-live',
                name: 'Grain Store',
                playCount: 2,
                rgid: 'r1',
                year: 2022,
            }),
            owned({
                addedAt: 100,
                id: 'a-old',
                name: 'Wintering',
                playCount: 9,
                rgid: 'r2',
                year: 2021,
            }),
            owned({
                addedAt: 200,
                id: 'a-new',
                name: 'Lantern',
                playCount: 0,
                rgid: 'r3',
                year: 2024,
            }),
            owned({ id: 'a-part', name: 'Undertow', playCount: 4, rgid: 'r4', year: 2018 }),
        ],
        [
            row({ rgid: 'r1', secondaryTypes: ['live'], status: 'complete' }),
            row({
                groupId: 'g',
                presentTracks: 9,
                rgid: 'r4',
                status: 'incomplete',
                totalTracks: 12,
            }),
            row({ rgid: 'm1', title: 'Low Country', year: '2013' }),
            row({ rgid: 'm2', secondaryTypes: ['live'], title: 'Ghent', year: '2023' }),
            row({ rgid: 's1', status: 'complete', title: 'Boats', year: '' }),
        ],
        [],
    );

test('filterItems: type, own, and both; matching nothing returns []', () => {
    const items = mixed();
    assert.deepEqual(keys(filterItems(items, view({ type: 'live' }))).sort(), ['a-live', 'm2']);
    assert.deepEqual(keys(filterItems(items, view({ own: 'missing' }))).sort(), ['m1', 'm2']);
    assert.deepEqual(keys(filterItems(items, view({ own: 'missing', type: 'live' }))), ['m2']);
    assert.deepEqual(keys(filterItems(items, view({ own: 'partly', type: 'live' }))), []);
    assert.deepEqual(keys(filterItems(items, view({ own: 'syncing' }))), ['s1']);
});

test('sortItems: year desc by default, ties by title, no year last', () => {
    const items = mixed();
    assert.deepEqual(keys(sortItems(items, view())), [
        'a-new',
        'm2',
        'a-live',
        'a-old',
        'a-part',
        'm1',
        's1',
    ]);
    assert.deepEqual(keys(sortItems(items, view({ dir: 'asc' }))), [
        'm1',
        'a-part',
        'a-old',
        'a-live',
        'm2',
        'a-new',
        's1',
    ]);
    const tie = buildItems(
        [],
        [row({ rgid: 'b', title: 'B' }), row({ rgid: 'a', title: 'A' })],
        [],
    );
    assert.deepEqual(keys(sortItems(tie, view())), ['a', 'b']);
});

test('sortItems: title', () => {
    assert.deepEqual(keys(sortItems(mixed(), view({ dir: 'asc', sort: 'title' }))), [
        's1',
        'm2',
        'a-live',
        'a-new',
        'm1',
        'a-part',
        'a-old',
    ]);
});

test('sortItems: plays puts owned first by plays and the unowned after, by year', () => {
    assert.deepEqual(keys(sortItems(mixed(), view({ sort: 'plays' }))), [
        'a-old',
        'a-part',
        'a-live',
        'a-new',
        'm2',
        'm1',
        's1',
    ]);
    // Direction flips the owned order and keeps the unowned after.
    assert.deepEqual(keys(sortItems(mixed(), view({ dir: 'asc', sort: 'plays' }))), [
        'a-new',
        'a-live',
        'a-part',
        'a-old',
        'm2',
        'm1',
        's1',
    ]);
});

test('sortItems: recently added is owned only, the rest after', () => {
    assert.deepEqual(keys(sortItems(mixed(), view({ sort: 'added' }))), [
        'a-live',
        'a-new',
        'a-old',
        'a-part',
        'm2',
        'm1',
        's1',
    ]);
});

test('chipCounts counts before filters and omits kinds with zero', () => {
    const counts = chipCounts(mixed());
    assert.equal(counts.all, 7);
    assert.deepEqual(counts.byKind, { album: 5, live: 2 });
});

const SETTINGS = [
    { disabled: false, id: 'releaseTypeLive' },
    { disabled: false, id: 'releaseTypeAlbum' },
    { disabled: true, id: 'releaseTypeCompilation' },
    { disabled: false, id: 'releaseTypeEp' },
];

test('sectionsOf: order follows the settings list; a kind switched off is collapsed and still present', () => {
    const items = [
        ...mixed(),
        ...buildItems(
            [],
            [row({ rgid: 'c1', secondaryTypes: ['compilation'], title: 'Odds' })],
            [],
        ),
        ...buildItems([], [row({ primaryType: 'single', rgid: 's2', title: 'Paper Boats' })], []),
    ];
    const sections = sectionsOf(items, view(), SETTINGS);
    assert.deepEqual(
        sections.map((s) => [s.kind, s.collapsed, s.items.length]),
        [
            ['live', false, 2],
            ['album', false, 5],
            ['compilation', true, 1],
            // Not in the settings list: after the listed kinds, in display order.
            ['single', false, 1],
        ],
    );
    // With the view on that kind it is open.
    const only = sectionsOf(
        filterItems(items, view({ type: 'compilation' })),
        view({ type: 'compilation' }),
        SETTINGS,
    );
    assert.deepEqual(
        only.map((s) => [s.kind, s.collapsed]),
        [['compilation', false]],
    );
});

test('kindSettings: listed kinds in the settings order, the rest after in display order; off is disabled', () => {
    const { disabled, order } = kindSettings(SETTINGS);
    assert.deepEqual(order, [
        'live',
        'album',
        'compilation',
        'ep',
        'single',
        'soundtrack',
        'remix',
        'other',
        'appears-on',
    ]);
    assert.deepEqual([...disabled], ['compilation']);
});

test('summary strings', () => {
    const items = mixed().filter((item) => item.kind === 'album');
    assert.equal(summaryOf(items), '5 releases · 2 owned, 1 partly, 1 missing, 1 syncing');
    assert.equal(summaryOf(items.slice(0, 1)), '1 release');
    assert.equal(summaryOf(items.filter((item) => item.ownership === 'owned')), '2 releases');
    assert.equal(summaryOf([]), '0 releases');
});

test('320 items in 9 kinds: sectionsOf runs in under 50 ms', () => {
    const rows: ReleaseRowInput[] = [];
    const types = [
        ['album'],
        ['ep'],
        ['single'],
        ['album', 'compilation'],
        ['album', 'live'],
        ['album', 'soundtrack'],
        ['single', 'remix'],
        ['broadcast'],
    ];
    for (let i = 0; i < 320; i += 1) {
        const [primary, ...secondary] = types[i % types.length];
        rows.push(
            row({
                primaryType: primary,
                rgid: `r${i}`,
                secondaryTypes: secondary,
                title: `T${i}`,
                year: String(1971 + (i % 49)),
            }),
        );
    }
    const ownedAlbums = Array.from({ length: 20 }, (_, i) =>
        owned({ creditedAsAlbumArtist: i % 10 !== 0, id: `o${i}`, name: `O${i}`, rgid: `ro${i}` }),
    );
    const start = performance.now();
    const items = buildItems(ownedAlbums, rows, []);
    const sections = sectionsOf(sortItems(filterItems(items, view()), view()), view(), SETTINGS);
    const ms = performance.now() - start;
    console.log(
        `# build + filter + sort + sections over ${items.length} items: ${ms.toFixed(1)} ms`,
    );
    assert.equal(new Set(sections.map((s) => s.kind)).size, 9);
    assert.ok(ms < 50, `${ms} ms`);
});
