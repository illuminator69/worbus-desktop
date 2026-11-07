import assert from 'node:assert/strict';
import test from 'node:test';

import { metaHasContent } from '../../renderer/features/lbbot/utils/lbbot-data.ts';
import { toFindIt } from './find-it.ts';
import { hasMetaFields } from './lbbot-wire.ts';

/**
 * Worbus P1, lane F (F4):  node --test src/shared/utils/find-it.harness.ts
 *
 * "Find it" on a missing album: lb-bot's `findIt` links (MusicBrainz url-relations it confirmed,
 * then search links it built), filtered, ordered and labelled. They are external URLs a user
 * clicks, so only plain http(s) with a host survive (Worbus for Android ruling 8).
 */

const confirmed = (service: string, url: string) => ({ kind: 'confirmed', service, url });
const search = (service: string, url: string) => ({ kind: 'search', service, url });

test('find_it_confirmed_before_search', () => {
    const links = toFindIt([
        search('youtube-music', 'https://music.youtube.com/search?q=a'),
        search('qobuz', 'https://www.qobuz.com/search?q=a'),
        confirmed('spotify', 'https://open.spotify.com/album/x'),
        search('bandcamp', 'https://bandcamp.com/search?q=a'),
        confirmed('bandcamp', 'https://artist.bandcamp.com/album/x'),
        search('apple-music', 'https://music.apple.com/search?term=a'),
        search('deezer', 'https://www.deezer.com/search/a'),
        search('spotify', 'https://open.spotify.com/search/a'),
    ]);
    assert.deepEqual(
        links.map((link) => `${link.kind}:${link.service}`),
        [
            // Confirmed in lb-bot's order...
            'confirmed:spotify',
            'confirmed:bandcamp',
            // ...then search links in the fixed order.
            'search:bandcamp',
            'search:qobuz',
            'search:apple-music',
            'search:spotify',
            'search:deezer',
            'search:youtube-music',
        ],
    );
});

test('find_it_absent_renders_nothing', () => {
    assert.deepEqual(toFindIt(undefined), []);
    assert.deepEqual(toFindIt(null), []);
    assert.deepEqual(toFindIt('links'), []);
    assert.deepEqual(toFindIt([]), []);
    assert.deepEqual(toFindIt([null, 3, 'x', {}]), []);
});

test('find_it_search_labels_name_the_service', () => {
    const labels = toFindIt([
        search('bandcamp', 'https://bandcamp.com/search?q=a'),
        search('qobuz', 'https://www.qobuz.com/search?q=a'),
        search('apple-music', 'https://music.apple.com/search?term=a'),
        search('spotify', 'https://open.spotify.com/search/a'),
        search('deezer', 'https://www.deezer.com/search/a'),
        search('youtube-music', 'https://music.youtube.com/search?q=a'),
        confirmed('tidal', 'https://tidal.com/browse/album/1'),
        confirmed('amazon', 'https://music.amazon.com/albums/1'),
        confirmed('beatport', 'https://www.beatport.com/release/x/1'),
        confirmed('soundcloud', 'https://soundcloud.com/a/sets/x'),
        confirmed('apple-music', 'https://music.apple.com/album/1'),
    ]).map((link) => link.label);
    assert.deepEqual(labels, [
        'TIDAL',
        'Amazon Music',
        'Beatport',
        'SoundCloud',
        'Apple Music',
        'Search Bandcamp',
        'Search Qobuz',
        'Search Apple Music',
        'Search Spotify',
        'Search Deezer',
        'Search YouTube Music',
    ]);
});

test('find_it_filters_schemes', () => {
    const bad = [
        'javascript:alert(1)',
        'file:///etc/passwd',
        'data:text/html,<b>x</b>',
        'spotify:album:1',
        'intent://x#Intent;end',
        'https://u:p@host.example/',
        'https://user@host.example/',
        'https://host.example\\@evil.example/',
        `https://host.example/${'a'.repeat(2049 - 'https://host.example/'.length)}`,
        'https://',
        'https:///',
        '',
    ];
    assert.equal(bad[8].length, 2049);
    for (const url of bad) {
        assert.deepEqual(toFindIt([confirmed('spotify', url)]), [], url);
        assert.deepEqual(toFindIt([search('spotify', url)]), [], url);
    }
    // 2,048 characters is still a link.
    const longest = `https://host.example/${'a'.repeat(2048 - 'https://host.example/'.length)}`;
    assert.equal(toFindIt([confirmed('spotify', longest)]).length, 1);
    assert.equal(toFindIt([confirmed('spotify', 'http://open.spotify.com/album/x')]).length, 1);
});

test('find_it_unknown_service_dropped', () => {
    assert.deepEqual(toFindIt([search('napster', 'https://napster.com/search?q=a')]), []);
    assert.deepEqual(toFindIt([search('other', 'https://example.com/search?q=a')]), []);
    assert.deepEqual(toFindIt([confirmed('napster', 'https://napster.com/album/1')]), []);
    assert.deepEqual(
        toFindIt([{ kind: 'maybe', service: 'spotify', url: 'https://x.example/' }]),
        [],
    );
    // A repeated link is shown once.
    assert.equal(
        toFindIt([
            confirmed('spotify', 'https://open.spotify.com/album/x'),
            confirmed('spotify', 'https://open.spotify.com/album/x'),
        ]).length,
        1,
    );
});

test('find_it_other_labelled_by_host', () => {
    const links = toFindIt([
        confirmed('other', 'https://www.discogs.com/master/1'),
        confirmed('other', 'https://label.example.org/releases/x'),
    ]);
    assert.deepEqual(
        links.map((link) => link.label),
        ['discogs.com', 'label.example.org'],
    );
});

test('meta_with_only_find_it_has_content', () => {
    const findIt = toFindIt([search('bandcamp', 'https://bandcamp.com/search?q=a')]);
    const body = {
        credits: [],
        findIt,
        found: false,
        links: [],
        paragraphs: [],
        relations: { members: [], related: [] },
        summary: '',
        wikidataDescription: '',
    };
    assert.equal(metaHasContent(body), true);
    assert.equal(metaHasContent({ ...body, findIt: [] }), false);
    // The raw body lb-bot sends is a body with a field, so it is an answer.
    assert.equal(hasMetaFields({ findIt: [] }), true);
});
