import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/**
 * B-428:  node --test src/shared/api/navidrome/navidrome-image-id.harness.ts
 *
 * The desktop kept an album's old cover for the whole session after it changed outside the app:
 * on Navidrome its cover key was the bare album or song id, which never changes. Navidrome's own
 * `imageHash` (the ETag, on `/api/album` and `/api/song`) changes with the cover, so the cover id
 * carries it, in the shape the artist and playlist covers already use (`<id>&_=<version>`). The
 * memory cache's key changes with the cover and the next visit to a refetched page shows it.
 */
const load = async () =>
    (await import('./navidrome-image-id.ts').catch(() => null)) as null | {
        navidromeVersionedImageId: (id: string, imageHash: string | undefined) => string;
    };

test('b428_a_cover_id_carries_navidromes_image_hash', async () => {
    const m = await load();
    assert.ok(m, 'no versioned cover id: the key never changes with the cover');
    assert.equal(
        m.navidromeVersionedImageId('al-1', 'e59f1a9d92c7d2c8'),
        'al-1&_=e59f1a9d92c7d2c8',
    );
    assert.equal(m.navidromeVersionedImageId('al-1', undefined), 'al-1', 'no hash: as before');
    assert.equal(m.navidromeVersionedImageId('al-1', ''), 'al-1');
});

test('b428_album_and_song_take_it_and_the_song_schema_reads_it', () => {
    const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
    const normalize = read('./navidrome-normalize.ts');
    assert.match(normalize, /imageId: navidromeVersionedImageId\(id, item\.imageHash\)/, 'song');
    assert.match(
        normalize,
        /imageId: navidromeVersionedImageId\(item\.coverArtId \|\| item\.id, item\.imageHash\)/,
        'album',
    );
    const types = read('./navidrome-types.ts');
    const song = types.slice(types.indexOf('const song = z.object({'));
    assert.match(song.slice(0, song.indexOf('\n});')), /imageHash: z\.string\(\)\.optional\(\)/);
});
