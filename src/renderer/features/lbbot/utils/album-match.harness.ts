import assert from 'node:assert/strict';
import test from 'node:test';

import { pickAlbumCandidate, rankAlbumCandidates, sameArtist } from './album-match.ts';

/**
 * Validating an album lookup against the question (`navi-connect/CLAUDE.md` §7,
 * "Never take the first hit"). The case is the measured one: Daft Punk, Discovery.
 *
 *     node --test src/renderer/features/lbbot/utils/album-match.harness.ts
 */

const cand = (artist: string, title: string, extra: object = {}) => ({
    artist,
    coverUrl: '',
    primaryType: 'Album',
    releaseAlbumId: '',
    releaseOwned: false,
    rgid: `${artist}|${title}`,
    score: 100,
    title,
    year: '',
    ...extra,
});

const ASKED = { artist: 'Daft Punk', title: 'Discovery' };

test('the parody that ranks first is not the answer', () => {
    const picked = pickAlbumCandidate(
        [
            cand('Pignickel', "Daft Punk's Discovery but it's in the SM64 Soundfont"),
            cand('Daft Punk', 'Discovery'),
        ],
        ASKED,
    );
    assert.equal(picked?.artist, 'Daft Punk');
});

test('survivors: owned first, then no bracketed qualifier, then lb-bot order', () => {
    const ranked = rankAlbumCandidates(
        [
            cand('Daft Punk', 'Discovery (Beta Version)'),
            cand('Daft Punk', 'Discovery (Sample Bandit Bootlegs)', { releaseOwned: true }),
            cand('Daft Punk', 'Discovery'),
        ],
        ASKED,
    );
    assert.deepEqual(
        ranked.map((row) => row.title),
        ['Discovery (Sample Bandit Bootlegs)', 'Discovery', 'Discovery (Beta Version)'],
    );
    const unowned = rankAlbumCandidates(
        [cand('Daft Punk', 'Discovery (Beta Version)'), cand('Daft Punk', 'Discovery')],
        ASKED,
    );
    assert.equal(unowned[0].title, 'Discovery');
});

test('nothing valid is a decline, not a guess', () => {
    assert.equal(pickAlbumCandidate([cand('Pink', 'Discovery')], ASKED), null);
    assert.equal(pickAlbumCandidate([], ASKED), null);
});

test('an artist that only contains the asked one does not match', () => {
    assert.equal(
        pickAlbumCandidate([cand('Pink Floyd', 'The Wall')], { artist: 'Pink', title: 'The Wall' }),
        null,
    );
});

/**
 * B-313 (the client half of B-176/Q-120; the hub's `_ARTIST_SEP_RE` splits these since S-094): a
 * bullet and a SPACED hyphen separate acts; an unspaced hyphen never does (Jay-Z, Run-DMC), nor
 * does `/` (AC/DC). Test vectors shared with the Android lane's rule.
 */
test('a bullet and a spaced hyphen separate acts', () => {
    const same: Array<[string, string]> = [
        ['Phoebe Bridgers • Phoebe Bridgers, Christian Lee Hutson', 'Phoebe Bridgers'],
        ['Phoebe Bridgers•Christian Lee Hutson', 'Christian Lee Hutson'],
        ['Lana Del Rey - Nikki Lane', 'Lana Del Rey'],
        ['Lana Del Rey - Nikki Lane', 'Nikki Lane'],
    ];
    for (const [a, b] of same) assert.equal(sameArtist(a, b), true, `${a} | ${b}`);
    const different: Array<[string, string]> = [
        ['Jay-Z', 'Jay'],
        ['Run-DMC', 'Run'],
        ['Run-DMC', 'DMC'],
        ['Lana Del Rey -Nikki Lane', 'Nikki Lane'],
        ['AC/DC', 'AC'],
    ];
    for (const [a, b] of different) assert.equal(sameArtist(a, b), false, `${a} | ${b}`);
    assert.equal(sameArtist('Jay-Z', 'Jay-Z'), true);
});
