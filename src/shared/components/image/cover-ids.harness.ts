import assert from 'node:assert/strict';
import test from 'node:test';

/**
 * Review M2 of `99477e450`:  node --test src/shared/components/image/cover-ids.harness.ts
 *
 * A changed album cover is shown under the album's own cover id and under each of its songs' (a
 * Navidrome song's cover id is the song id). Which songs belong to the album is only known from what
 * the app already holds: the query cache and the play queue. `coverIdsOfAlbums` walks them.
 */
const load = async () =>
    (await import('./cover-ids.ts').catch(() => null)) as null | {
        coverIdsOfAlbums: (albumIds: string[], sources: unknown[]) => Set<string>;
    };

test('an_albums_cover_ids_are_its_own_and_its_songs', async () => {
    const m = await load();
    assert.ok(m, 'no cover-id walk: a changed cover is only forgotten for the album itself');
    const song = (id: string, albumId: string) => ({ albumId, id, imageId: id, name: id });
    const sources = [
        // An album detail query: the album, with its songs.
        { id: 'AL1', imageId: 'AL1-cover', songs: [song('s1', 'AL1'), song('s2', 'AL1')] },
        // A song list page, another album's songs mixed in.
        { items: [song('s3', 'AL1'), song('t1', 'AL2')], totalRecordCount: 2 },
        // The play queue: a map of rows.
        { 'u-1': song('s4', 'AL1'), 'u-2': song('t2', 'AL2') },
        // Infinite query pages.
        { pageParams: [0], pages: [{ items: [song('s5', 'AL1')] }] },
        null,
        'text',
    ];
    const ids = m.coverIdsOfAlbums(['AL1'], sources);
    assert.deepEqual([...ids].sort(), ['AL1', 'AL1-cover', 's1', 's2', 's3', 's4', 's5']);
    // A cycle does not hang it.
    const a: Record<string, unknown> = { id: 'x' };
    a.self = a;
    assert.deepEqual([...m.coverIdsOfAlbums(['AL9'], [a])], ['AL9']);
});
