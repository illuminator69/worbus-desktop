import assert from 'node:assert/strict';
import test from 'node:test';

import { migrateArtistItems } from './artist-items-migration.ts';

/**
 * R13:  node --test src/renderer/store/artist-items-migration.harness.ts
 *
 * Settings version 42: the Favourite songs row leaves the artist page's stored order, nothing else moves.
 */

const rows = (ids: readonly string[], disabled: string[] = []) =>
    ids.map((id) => ({ disabled: disabled.includes(id), id }));

test('theDefaultOrderLosesOnlyFavouriteSongs', () => {
    assert.deepEqual(
        migrateArtistItems(
            rows(['biography', 'favoriteSongs', 'recentAlbums', 'similarArtists', 'topSongs']),
        ),
        rows(['biography', 'recentAlbums', 'similarArtists', 'topSongs']),
    );
});

test('aReorderedOrderKeepsItsOrderAndSwitches', () => {
    assert.deepEqual(
        migrateArtistItems(
            rows(
                ['topSongs', 'favoriteSongs', 'similarArtists', 'biography', 'recentAlbums'],
                ['favoriteSongs', 'biography'],
            ),
        ),
        rows(['topSongs', 'similarArtists', 'biography', 'recentAlbums'], ['biography']),
    );
});

test('anOrderWithoutItIsUntouched', () => {
    const stored = rows(['biography', 'recentAlbums', 'similarArtists', 'topSongs'], ['topSongs']);
    assert.deepEqual(migrateArtistItems(stored), stored);
});

test('nothingStoredStaysNothing', () => {
    assert.equal(migrateArtistItems(undefined), undefined);
    assert.deepEqual(migrateArtistItems([]), []);
});
