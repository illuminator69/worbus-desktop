import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import * as albumMatch from './album-match.ts';

/**
 * B-407 (owner walk, 2026-11-13):
 *   node --test src/renderer/features/lbbot/utils/artist-link.harness.ts
 *
 * B-313 passes for the artist on an album page reached from MusicBrainz (`useArtistTarget`: the
 * library searched by name, B-313's rule, before the MBID's virtual page). Every other lb-bot
 * surface's artist link goes by lb-bot's own match: `artistLinkPath(row.artistId, row.mbid)`,
 * where `artistId` / `owned` is lb-bot's index matching the name for itself. When that match
 * misses (an artist tagged "BTS (방탄소년단)" in the library), the link opens the virtual
 * `mb:` page of an artist the library has. The rows: the Fresh tab's artist line, Discover's
 * browse rows and similar-artists row, the artist page's similar-artists list, and My
 * Listening's artist tiles and lines.
 */

const rule = albumMatch as unknown as {
    artistLinkStep?: (
        artistId: null | string | undefined,
        mbid: null | string | undefined,
        name: null | string | undefined,
    ) => 'external' | 'library' | 'lookup' | null;
};

test('a_row_lbbot_did_not_match_is_looked_up_by_the_b313_rule', () => {
    assert.equal(typeof rule.artistLinkStep, 'function', 'the lb-bot rows go by lb-bot match');
    const step = rule.artistLinkStep!;
    assert.equal(step('nd-1', 'mbid-1', 'BTS'), 'library', "lb-bot's own id still opens it");
    assert.equal(step('', 'mbid-1', 'BTS (방탄소년단)'), 'lookup');
    assert.equal(step(undefined, '', 'BTS'), 'lookup');
    assert.equal(step('', 'mbid-1', '  '), 'external', 'no name: the MBID page');
    assert.equal(step('', '', ''), null);
});

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

test('every_lbbot_artist_link_takes_the_shared_step', () => {
    for (const file of [
        '../routes/lbbot-fresh-route.tsx',
        '../../discover/components/browse-row.tsx',
        '../../discover/components/similar-artists-row.tsx',
        '../../discography/components/similar-artist-list.tsx',
        '../../listening/components/listening-sections.tsx',
    ]) {
        assert.match(
            read(file),
            /useOpenLbBotArtist\(/,
            `${file}: the artist link goes by lb-bot's own match`,
        );
    }
    assert.doesNotMatch(
        read('../../listening/components/listening-sections.tsx'),
        /artistPath\(\s*artistTarget\(/,
        "My Listening's artist links go by lb-bot's own match",
    );
});
