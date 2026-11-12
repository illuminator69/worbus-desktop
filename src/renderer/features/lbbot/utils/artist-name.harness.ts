import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeArtistName, sameArtist } from './album-match.ts';
import { KEY_VECTORS, SAME_ARTIST_VECTORS } from './artist-name-vectors.ts';

/**
 * B-313, owner's ruling 2026-11-12: one artist-name rule on both clients, a letter in any script
 * counts. The rows are `artist-name-vectors.ts`, the table Worbus for Android is to run too.
 *
 *     node --test src/renderer/features/lbbot/utils/artist-name.harness.ts
 */

const show = (value: string) => JSON.stringify(value);

test('every key vector normalises to its shared key', () => {
    const wrong = KEY_VECTORS.filter((v) => normalizeArtistName(v.input) !== v.key).map(
        (v) => `${show(v.input)} -> ${show(normalizeArtistName(v.input))}, want ${show(v.key)}`,
    );
    assert.deepEqual(wrong, []);
});

test('every pair answers its shared verdict, either way round', () => {
    const wrong = SAME_ARTIST_VECTORS.filter(
        (v) => sameArtist(v.a, v.b) !== v.same || sameArtist(v.b, v.a) !== v.same,
    ).map((v) => `${show(v.a)} | ${show(v.b)}: want ${v.same} (${v.note})`);
    assert.deepEqual(wrong, []);
});

test("an Android column is only written where Android's answer differs", () => {
    for (const v of KEY_VECTORS) if (v.android !== undefined) assert.notEqual(v.android, v.key);
    for (const v of SAME_ARTIST_VECTORS)
        if (v.android !== undefined) assert.notEqual(v.android, v.same);
});
