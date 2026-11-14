import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
    albumRowIsPlaying,
    artistRowIsPlaying,
    songRowIsPlaying,
} from '../../features/player/utils/row-is-playing.ts';

/**
 * B-451 (the owner, 2026-11-14, QUESTIONS-before-stage2 item 6: "follow the session"):
 *   node --test src/renderer/components/item-list/row-follows-session.harness.ts
 *
 * While another device plays, a list marked the song THIS desktop last played as the active one:
 * album and artist rows compared the local player's song (`usePlayerSong`), and so did every song
 * table's `activeRowId` and the detail list's `useIsCurrentSong`. B-420 made the bars move with the
 * session; which row carries them now follows the session too (`useRemoteAwarePlayerSong`: the
 * session's song while another device is active, the local one otherwise).
 */

const ROOT = path.resolve(import.meta.dirname, '../../../..');
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8');

// Every site that decides which list row is the playing one.
const ROW_ACTIVE = [
    'src/renderer/components/item-list/item-table-list/columns/use-row-play-control.ts',
    'src/renderer/features/player/hooks/use-is-current-song.ts',
    'src/renderer/features/albums/components/album-detail-content.tsx',
    'src/renderer/features/artists/routes/album-artist-detail-top-songs-list-route.tsx',
    'src/renderer/features/artists/routes/album-artist-detail-favorite-songs-list-route.tsx',
    'src/renderer/features/folders/components/folder-list-content.tsx',
    'src/renderer/features/playlists/components/playlist-detail-song-list-table.tsx',
    'src/renderer/features/songs/components/song-list-infinite-table.tsx',
    'src/renderer/features/songs/components/song-list-paginated-table.tsx',
];

test('every_list_marks_the_sessions_song', () => {
    for (const file of ROW_ACTIVE) {
        const src = read(file);
        assert.match(src, /useRemoteAwarePlayerSong\(\)/, `${file}: not the session's song`);
        assert.doesNotMatch(src, /usePlayerSong\(\)/, `${file}: still reads the local song`);
    }
});

// The session's song as `hubTrackToQueueSong` builds it: no `_uniqueId` (the local queue's ids
// mean nothing for a song another device plays), album id and artists from the wire or the detail.
const remote = {
    albumArtists: [{ id: 'ar-1', name: 'A' }],
    albumId: 'al-2',
    artists: [{ id: 'ar-3', name: 'C' }],
    id: 's-9',
};
const local = { _uniqueId: 'u-1', albumId: 'al-1', id: 's-1' };

test('an_album_row_is_active_for_the_sessions_album', () => {
    assert.equal(albumRowIsPlaying('al-2', remote), true);
    assert.equal(albumRowIsPlaying('al-1', remote), false);
    assert.equal(albumRowIsPlaying('', { albumId: '' }), false);
    assert.equal(albumRowIsPlaying('al-1', undefined), false);
});

test('an_artist_row_is_active_for_the_sessions_artists', () => {
    assert.equal(artistRowIsPlaying('ar-1', remote, 'albumArtists'), true);
    assert.equal(artistRowIsPlaying('ar-3', remote, 'albumArtists'), false);
    assert.equal(artistRowIsPlaying('ar-3', remote, 'artists'), true);
    assert.equal(artistRowIsPlaying('', { artists: [{ id: '', name: 'x' }] }, 'artists'), false);
});

test('a_song_row_matches_the_sessions_song_by_id', () => {
    // A library row (no queue id) and a local queue row of the song another device plays.
    assert.equal(songRowIsPlaying({ id: 's-9' }, remote), true);
    assert.equal(songRowIsPlaying({ _uniqueId: 'u-7', id: 's-9' }, remote), true);
    assert.equal(songRowIsPlaying({ id: 's-1' }, remote), false);
});

test('local_play_keeps_matching_queue_rows_by_their_queue_id', () => {
    // The same song twice in the local queue: only the playing entry is active.
    assert.equal(songRowIsPlaying({ _uniqueId: 'u-1', id: 's-1' }, local), true);
    assert.equal(songRowIsPlaying({ _uniqueId: 'u-2', id: 's-1' }, local), false);
    assert.equal(songRowIsPlaying({ id: 's-1' }, local), true);
    assert.equal(songRowIsPlaying({ id: 's-1' }, undefined), false);
});
