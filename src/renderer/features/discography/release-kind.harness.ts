import assert from 'node:assert/strict';
import test from 'node:test';

import { KIND_SETTING_ID, RELEASE_KINDS, releaseKindOf } from './release-kind.ts';

/**
 * F7 Call 3: one kind rule for owned and missing albums. Compilation beats Live, then
 * Soundtrack, then Remix, then the primary type; the rest is Other.
 *
 *     node --test src/renderer/features/discography/release-kind.harness.ts
 */

test('a secondary type decides over the primary one, in the stated order', () => {
    assert.equal(releaseKindOf(['album', 'live'], false), 'live');
    assert.equal(releaseKindOf(['album', 'compilation'], false), 'compilation');
    assert.equal(releaseKindOf(['album', 'live', 'compilation'], false), 'compilation');
    assert.equal(releaseKindOf(['soundtrack', 'album'], false), 'soundtrack');
    assert.equal(releaseKindOf(['remix', 'single'], false), 'remix');
    assert.equal(releaseKindOf(['album', 'live', 'soundtrack'], false), 'live');
});

test("Navidrome's compilation flag makes a plain album a compilation", () => {
    assert.equal(releaseKindOf(['album'], true), 'compilation');
    assert.equal(releaseKindOf(['album', 'live'], true), 'compilation');
});

test('the primary types', () => {
    assert.equal(releaseKindOf(['album'], false), 'album');
    assert.equal(releaseKindOf(['ep'], false), 'ep');
    assert.equal(releaseKindOf(['single'], false), 'single');
});

test('everything else is other', () => {
    for (const type of [
        'broadcast',
        'other',
        'djmix',
        'dj-mix',
        'mixtape/street',
        'spokenword',
        'audiobook',
        'audio drama',
        'interview',
        'field recording',
        'demo',
    ]) {
        assert.equal(releaseKindOf([type], false), 'other', type);
    }
    // A demo is a secondary type in MusicBrainz: on an album it still makes it Other.
    assert.equal(releaseKindOf(['album', 'demo'], false), 'other');
});

test('no type at all is an album, and case and padding are ignored', () => {
    assert.equal(releaseKindOf([], false), 'album');
    assert.equal(releaseKindOf(['', '  '], false), 'album');
    assert.equal(releaseKindOf([' Live ', 'ALBUM'], false), 'live');
    assert.equal(releaseKindOf(['EP'], false), 'ep');
});

test('every kind has a Settings id and a place in the display order', () => {
    for (const kind of RELEASE_KINDS) {
        assert.equal(typeof KIND_SETTING_ID[kind], 'string', kind);
        assert.ok(KIND_SETTING_ID[kind].length > 0, kind);
    }
    assert.equal(new Set(RELEASE_KINDS).size, 9);
    assert.equal(RELEASE_KINDS[0], 'album');
});
