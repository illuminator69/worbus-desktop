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

/**
 * B-407 review M4: the tap-time lookup matched names only. A row lb-bot identifies by MBID as one
 * of two same-named acts (Nirvana UK) opened the library's other one (Nirvana US), where the MBID
 * page was right; and `sameArtist` splits credits, so an unowned "Fire" opened the library's
 * "Earth, Wind & Fire". Rule: an MBID on both sides that differs is not the artist; an equal one
 * is; then an exact whole name; then the `A (B)` bracket rule on the whole credit; a credit split
 * only for a row lb-bot says is owned.
 */
type LibraryRow = { id: string; mbz: null | string; name: string };
const pick = (
    albumMatch as unknown as {
        pickLibraryArtist?: (
            rows: LibraryRow[],
            row: { mbid?: null | string; name: string; owned?: boolean },
        ) => null | string;
    }
).pickLibraryArtist;

test('the_lookup_reads_the_rows_mbid_and_never_splits_an_unowned_credit', () => {
    assert.equal(typeof pick, 'function', 'the lookup is by name alone');
    const nirvanaUs = { id: 'nd-us', mbz: 'mb-us', name: 'Nirvana' };
    assert.equal(
        pick!([nirvanaUs], { mbid: 'mb-uk', name: 'Nirvana' }),
        null,
        'Nirvana UK opens Nirvana US',
    );
    assert.equal(pick!([nirvanaUs], { mbid: 'mb-us', name: 'Nirvana' }), 'nd-us');
    assert.equal(pick!([nirvanaUs], { name: 'Nirvana' }), 'nd-us', 'no MBID on the row: the name');
    // A library artist with no MBID tag is no evidence against the row's.
    assert.equal(pick!([{ ...nirvanaUs, mbz: null }], { mbid: 'mb-uk', name: 'Nirvana' }), 'nd-us');

    const ewf = { id: 'nd-ewf', mbz: null, name: 'Earth, Wind & Fire' };
    assert.equal(pick!([ewf], { name: 'Fire' }), null, '"Fire" opens "Earth, Wind & Fire"');
    assert.equal(pick!([ewf], { name: 'Fire', owned: false }), null);
    assert.equal(pick!([ewf], { name: 'Fire', owned: true }), 'nd-ewf', 'owned: the split stands');
    assert.equal(
        pick!([{ ...ewf, mbz: 'mb-ewf' }], { mbid: 'mb-fire', name: 'Fire', owned: true }),
        null,
    );

    // An exact whole name before anything wider.
    const rows = [
        { id: 'feat', mbz: null, name: 'Daft Punk feat. Julian Casablancas' },
        { id: 'dp', mbz: null, name: 'Daft Punk' },
    ];
    assert.equal(pick!(rows, { name: 'Daft Punk', owned: true }), 'dp');
    // B-313's bracket shape is one credit, not a split: it stands for every row.
    assert.equal(
        pick!([{ id: 'bts', mbz: null, name: 'BTS (방탄소년단)' }], { name: 'BTS' }),
        'bts',
    );
});

test('the_open_uses_the_rule_and_the_rows_ownership', () => {
    const hooks = readFileSync(new URL('../hooks/use-lbbot.ts', import.meta.url), 'utf8');
    const open = hooks.slice(hooks.indexOf('export const useResolveLibraryArtistPath'));
    assert.match(open.slice(0, open.indexOf('\n};')), /pickLibraryArtist\(/);
});

/**
 * B-407 review L1: a tap waited on a library search with nothing on screen, then navigated
 * whatever happened meanwhile: after the person had moved on, after a later tap elsewhere (which
 * could lose to the earlier one), and twice for a double tap (two history entries).
 */
test('a_tap_is_one_navigation_the_latest_and_only_where_it_was_made', async () => {
    const mod = (await import('./artist-tap.ts').catch(() => null)) as null | {
        createTapGuard: () => {
            begin: (key: string) => null | number;
            finish: (token: number, stillHere: boolean) => boolean;
            pending: () => null | string;
        };
    };
    assert.ok(mod, 'no guard: every completed lookup navigates');
    const guard = mod.createTapGuard();
    const a = guard.begin('nirvana');
    assert.equal(guard.pending(), 'nirvana', 'nothing says the tap is being worked on');
    assert.equal(guard.begin('nirvana'), null, 'a double tap pushes two entries');
    const b = guard.begin('fire');
    assert.equal(guard.finish(a!, true), false, 'an earlier tap overrides a later one');
    assert.equal(guard.pending(), 'fire');
    assert.equal(guard.finish(b!, true), true);
    assert.equal(guard.pending(), null);
    const c = guard.begin('bts');
    assert.equal(guard.finish(c!, false), false, 'the person moved on and was pulled back');
    assert.equal(guard.pending(), null);

    const hooks = readFileSync(new URL('../hooks/use-lbbot.ts', import.meta.url), 'utf8');
    const open = hooks.slice(hooks.indexOf('export const useOpenLbBotArtist'));
    assert.match(open.slice(0, open.indexOf('\n};')), /\.begin\(/);
    for (const file of [
        '../routes/lbbot-fresh-route.tsx',
        '../../discover/components/browse-row.tsx',
        '../../discover/components/similar-artists-row.tsx',
    ]) {
        assert.match(
            readFileSync(new URL(file, import.meta.url), 'utf8'),
            /isBusy=\{[^}]*pending/i,
            `${file}: no pending state on the tapped tile`,
        );
    }
});

test('an_artist_on_others_albums_only_is_found_too', () => {
    // VM walk edge (2026-11-13): a row with the SAME MBID as the library's Guest Star, who is only a
    // track artist on The Hosts' album, stayed on the MusicBrainz page: the lookup searched album
    // artists only, so `pickLibraryArtist` never saw a candidate. On a miss, Navidrome's artists of
    // every role are asked too.
    const hooks = readFileSync(new URL('../hooks/use-lbbot.ts', import.meta.url), 'utf8');
    const resolve = hooks.slice(hooks.indexOf('export const useResolveLibraryArtistPath'));
    assert.match(
        resolve.slice(0, resolve.indexOf('\n};')),
        /getArtistList\(/,
        'only album artists are searched',
    );
});
