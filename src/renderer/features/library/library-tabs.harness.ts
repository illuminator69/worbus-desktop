import assert from 'node:assert/strict';
import test from 'node:test';

import type { LibraryTab, LibraryTabsContext } from './library-tabs.ts';

import { disabledSidebarIds, libraryTabForPath, libraryTabs } from './library-tabs.ts';

/**
 * F6:  node --test src/renderer/features/library/library-tabs.harness.ts
 *
 * The Library frame's chips: Artists, Albums, Tracks; then Mixes, Playlists, Genres, Folders, Radio
 * stations; and More. The old sidebar items' switches gate the chips they used to gate. Which chip a
 * path selects (a detail page selects none).
 */

const routes = {
    albumArtists: '/library/album-artists',
    albums: '/library/albums',
    allArtists: '/library/artists',
    artists: '/library',
    discover: '/explore',
    favorites: '/favorites',
    folders: '/library/folders',
    genres: '/library/genres',
    mixes: '/mixes',
    playlists: '/playlists',
    radio: '/radio',
    tracks: '/library/songs',
};

const ctx = (patch: Partial<LibraryTabsContext> = {}): LibraryTabsContext => ({
    disabledIds: [],
    hasDiscoverSources: false,
    hubConfigured: false,
    routes,
    ...patch,
});

const ids = (tabs: LibraryTab[]) => tabs.map((t) => t.id);

test('theDefaultChips', () => {
    const tabs = libraryTabs(ctx());
    assert.deepEqual(ids(tabs.primary), ['artists', 'albums', 'tracks']);
    assert.deepEqual(ids(tabs.secondary), ['playlists', 'genres', 'folders', 'radio']);
    assert.deepEqual(ids(tabs.more), ['albumArtists', 'allArtists', 'favorites']);
    assert.equal(tabs.primary[0].route, '/library');
    assert.equal(tabs.secondary.at(-1)!.route, '/radio');
    assert.ok([...tabs.primary, ...tabs.secondary, ...tabs.more].every((t) => t.label));
});

test('aConfiguredHubPutsMixesFirst', () => {
    assert.deepEqual(ids(libraryTabs(ctx({ hubConfigured: true })).secondary), [
        'mixes',
        'playlists',
        'genres',
        'folders',
        'radio',
    ]);
});

test('theOldSwitchesGateTheirChips', () => {
    const without = (id: string) => {
        const tabs = libraryTabs(ctx({ disabledIds: [id] }));
        return [...ids(tabs.primary), ...ids(tabs.secondary), ...ids(tabs.more)];
    };
    const all = without('nothing');
    assert.deepEqual(
        all.filter((id) => !without('Genres').includes(id)),
        ['genres'],
    );
    assert.deepEqual(
        all.filter((id) => !without('Radio').includes(id)),
        ['radio'],
    );
    assert.deepEqual(
        all.filter((id) => !without('Folders').includes(id)),
        ['folders'],
    );
    assert.deepEqual(
        all.filter((id) => !without('Favorites').includes(id)),
        ['favorites'],
    );
    assert.deepEqual(
        all.filter((id) => !without('Artists-all').includes(id)),
        ['allArtists'],
    );
    // Album artists is always in More; Albums, Tracks and Playlists are always chips.
    for (const id of ['Artists', 'Albums', 'Tracks', 'Playlists']) {
        assert.deepEqual(without(id), all, id);
    }
});

test('discoverIsLastInMoreWhenItHasSources', () => {
    assert.deepEqual(ids(libraryTabs(ctx({ hasDiscoverSources: true })).more), [
        'albumArtists',
        'allArtists',
        'favorites',
        'discover',
    ]);
});

test('disabledSidebarIdsFirstOccurrenceDecides', () => {
    assert.deepEqual(
        disabledSidebarIds([
            { disabled: true, id: 'Genres' },
            { disabled: false, id: 'Radio' },
            { disabled: false, id: 'Genres' },
            { disabled: true, id: 'Radio' },
            { disabled: true, id: 'Folders' },
        ]),
        ['Genres', 'Folders'],
    );
    assert.deepEqual(disabledSidebarIds(undefined), []);
});

test('libraryTabForPath', () => {
    const tabs = libraryTabs(ctx());
    assert.equal(libraryTabForPath('/library', tabs), 'artists');
    assert.equal(libraryTabForPath('/library/', tabs), 'artists');
    assert.equal(libraryTabForPath('/library/albums', tabs), 'albums');
    assert.equal(libraryTabForPath('/library/albums/abc', tabs), null);
    assert.equal(libraryTabForPath('/library/album-artists', tabs), 'albumArtists');
    assert.equal(libraryTabForPath('/library/album-artists/a1', tabs), null);
    assert.equal(libraryTabForPath('/library/genres', tabs), 'genres');
    assert.equal(libraryTabForPath('/library/genres/g1', tabs), null);
    assert.equal(libraryTabForPath('/playlists', tabs), 'playlists');
    assert.equal(libraryTabForPath('/library/songs', tabs), 'tracks');
    assert.equal(libraryTabForPath('/', tabs), null);
    assert.equal(libraryTabForPath('/mixes', tabs), null);
    assert.equal(libraryTabForPath('/mixes', libraryTabs(ctx({ hubConfigured: true }))), 'mixes');
    // A switched-off chip selects nothing.
    assert.equal(libraryTabForPath('/radio', libraryTabs(ctx({ disabledIds: ['Radio'] }))), null);
});
