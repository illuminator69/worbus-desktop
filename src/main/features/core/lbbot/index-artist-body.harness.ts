import assert from 'node:assert/strict';
import test from 'node:test';

import { indexArtistBody } from './index-artist-body.ts';

/**
 * B-411 (owner walk, 2026-11-13):
 *   node --test src/main/features/core/lbbot/index-artist-body.harness.ts
 *
 * "Find missing albums" for a library artist with only an Appears on shelf (no albums of their
 * own, no MBID tag) failed: "The MusicBrainz request has an empty entity id: 'artist?query='".
 * With no MBID the desktop sent `{nd_id}` alone, so lb-bot's Scan now took the name from
 * Navidrome's getArtists, which lists album artists only: an artist who is only a track artist
 * is not there, the name was "", and the name search asked MusicBrainz an empty query. The page
 * has the artist's name (Navidrome's own record of them); it goes with the id.
 */
test('scan_now_sends_the_name_the_page_has', () => {
    assert.deepEqual(indexArtistBody({ name: 'Feist', ndId: 'nd-7' }), {
        name: 'Feist',
        nd_id: 'nd-7',
    });
});

test('the_rest_is_as_it_was', () => {
    assert.deepEqual(indexArtistBody({ mbid: 'm-1', name: 'Feist', ndId: 'nd-7' }), {
        mbid: 'm-1',
        name: 'Feist',
        nd_id: 'nd-7',
    });
    // No name known: the id alone, lb-bot's own lookup (as before).
    assert.deepEqual(indexArtistBody({ name: '', ndId: 'nd-7' }), { nd_id: 'nd-7' });
    assert.deepEqual(indexArtistBody({ name: '  ', ndId: 'nd-7' }), { nd_id: 'nd-7' });
    assert.equal(indexArtistBody({ mbid: 'm-1', name: '', ndId: 'nd-7' }), null);
    assert.equal(indexArtistBody({ name: 'Feist', ndId: '' }), null);
});
