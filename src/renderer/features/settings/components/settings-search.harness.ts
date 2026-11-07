import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { FORK_SEARCH_TERMS, KEYWORDS } from './settings-keywords.ts';
import { extraShown, matchesSearch, sectionDrawn, sectionRows } from './settings-search.ts';

/**
 * F5:  node --test src/renderer/features/settings/components/settings-search.harness.ts
 *
 * Search matched only a row's title, only on the open tab, and drew every section heading and extra
 * block whatever the query. It now matches title, description and a row's keywords across all tabs,
 * and a section with nothing to show is not drawn. The fork's rows carry the words people have for
 * them ("hub", "cast", "autoplay", "library tools") that appear in no title.
 */

const here = (path: string) => new URL(path, import.meta.url);
const read = (path: string) => readFileSync(here(path), 'utf8');

const ROWS = [
    { description: 'Keep music going when your queue is about to run out.', title: 'Autoplay' },
    { description: 'Shown in the device list on your other devices.', title: "This device's name" },
    { description: 'Only needed without a Worbus Server.', title: 'AudioMuse address' },
    { description: 'Hidden one', isHidden: true, title: 'Autoplay mode' },
];

test('aRowMatchesOnItsTitleItsDescriptionOrAKeyword', () => {
    assert.ok(matchesSearch('autoplay', ROWS[0]));
    assert.ok(matchesSearch('queue', ROWS[0]), 'description');
    assert.ok(matchesSearch('hub', { ...ROWS[1], keywords: ['hub', 'server'] }), 'keyword');
    assert.ok(!matchesSearch('hub', ROWS[1]), 'no keyword, no match');
    assert.ok(matchesSearch('', ROWS[1]), 'an empty query matches everything');
});

test('matchingIsCaseInsensitiveAndAReactNodeDescriptionIsIgnoredNotCrashedOn', () => {
    assert.ok(matchesSearch('autoplay', { title: 'AUTOPLAY' }));
    assert.ok(matchesSearch('AUTOPLAY', { title: 'Autoplay' }));
    assert.ok(!matchesSearch('xyz', { description: { type: 'div' }, title: 'Status' }));
    assert.ok(matchesSearch('status', { description: { type: 'div' }, title: 'Status' }));
});

test('hiddenRowsAreNeverFoundAndAnEmptyQueryKeepsTheSectionAsItIs', () => {
    assert.deepEqual(
        sectionRows('', 'Autoplay & radio', ROWS).map((r) => r.title),
        ['Autoplay', "This device's name", 'AudioMuse address'],
    );
    assert.deepEqual(
        sectionRows('autoplay', 'Other', ROWS).map((r) => r.title),
        ['Autoplay'],
    );
});

test('aSectionWhoseTitleMatchesShowsAllItsRows', () => {
    assert.deepEqual(
        sectionRows('worbus', 'Worbus Server', ROWS).map((r) => r.title),
        ['Autoplay', "This device's name", 'AudioMuse address'],
    );
});

test('aMissDrawsNoHeadingAndNoExtraBlock', () => {
    const rows = sectionRows('zzz', 'Autoplay & radio', ROWS);
    assert.equal(rows.length, 0);
    const shown = extraShown('zzz', 'Autoplay & radio', ['home page rows']);
    assert.equal(shown, false);
    assert.equal(sectionDrawn('zzz', rows.length, shown), false);
});

test('anExtraBlockIsFoundByTheSectionTitleOrItsOwnWords', () => {
    assert.equal(extraShown('', 'Home', undefined), true);
    assert.equal(extraShown('home', 'Home', undefined), true);
    assert.equal(extraShown('fresh', 'Home', ['home page rows', 'fresh', 'mixed for you']), true);
    assert.equal(extraShown('fresh', 'Home', undefined), false);
    assert.equal(sectionDrawn('fresh', 0, true), true);
    assert.equal(
        sectionDrawn('', 0, true),
        true,
        'no query: the section is drawn as it always was',
    );
});

const matchers = (rows: readonly string[]) => rows.map((id) => KEYWORDS[id]);

test('eachForkSearchTermFindsTheRowsItIsMeantFor', () => {
    assert.ok(FORK_SEARCH_TERMS.length >= 10, 'the table of terms exists');
    for (const { rows, term } of FORK_SEARCH_TERMS) {
        assert.ok(rows.length > 0, `${term} names at least one row`);
        for (const [i, keywords] of matchers(rows).entries()) {
            assert.ok(keywords, `${rows[i]} has a keyword list`);
            assert.ok(
                matchesSearch(term, { keywords, title: '' }),
                `"${term}" must find ${rows[i]}`,
            );
        }
    }
});

test('thePlansWordsAreAllCovered', () => {
    const terms = FORK_SEARCH_TERMS.map((t) => t.term);
    for (const word of [
        'hub',
        'server',
        'cast',
        'chromecast',
        'autoplay',
        'lb-bot',
        'library tools',
    ]) {
        assert.ok(terms.includes(word), `"${word}" is in the table`);
    }
});

test('aTermThatMeansNothingFindsNoForkRow', () => {
    for (const [id, keywords] of Object.entries(KEYWORDS)) {
        assert.ok(!matchesSearch('zzz', { keywords, title: '' }), `zzz must not find ${id}`);
    }
});

const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory()
            ? walk(join(dir, e.name))
            : e.name.endsWith('.tsx')
              ? [join(dir, e.name)]
              : [],
    );

test('everyKeywordListReachesARowAndNoRowInventsItsOwn', () => {
    const sources = walk(here('./').pathname).map((p) => readFileSync(p, 'utf8'));
    for (const id of Object.keys(KEYWORDS)) {
        const uses = sources.filter((s) => s.includes(`keywords: KEYWORDS.${id},`)).length;
        assert.equal(uses, 1, `KEYWORDS.${id} is the keywords of exactly one row (found ${uses})`);
    }
    for (const source of sources) {
        assert.doesNotMatch(source, /keywords:\s*\[/, 'keyword lists live in settings-keywords.ts');
    }
});

test('theSectionAndTheOptionUseTheSearchModuleAndTitlesAreLabels', () => {
    const section = read('./settings-section.tsx');
    assert.match(section, /sectionRows\(/);
    assert.match(section, /extraShown\(/);
    assert.match(section, /sectionDrawn\(/);
    assert.match(
        section,
        /const drawn = sectionDrawn\(keyword, values\.length, showExtra\);/,
        'drawn comes from the tested function',
    );
    assert.match(section, /if \(!drawn\) return null;/, 'an undrawn section renders nothing');
    assert.doesNotMatch(section, /title\.toLocaleLowerCase\(\)\.includes/);
    const option = read('./settings-option.tsx');
    assert.match(option, /component="label"/);
    assert.match(option, /htmlFor=/);
});

test('searchReplacesTheTabsWithOneResultsListAcrossAllOfThem', () => {
    const content = read('./settings-content.tsx');
    assert.match(content, /search !== ''/);
    assert.match(content, /SearchResults/);
    const results = read('./settings-search-results.tsx');
    assert.match(results, /tabsFor\(/);
    for (const tab of [
        'ServerTab',
        'PlaybackTab',
        'AppearanceTab',
        'GeneralTab',
        'HotkeysTab',
        'WindowTab',
        'AdvancedTab',
    ]) {
        assert.match(results, new RegExp(`<${tab}`), `${tab} is searched`);
    }
    const css = read('./settings-search-results.module.css');
    assert.match(css, /:not\(:has\(\[data-settings-section\]\)\)/);
});
