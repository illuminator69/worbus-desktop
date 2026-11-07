import assert from 'node:assert/strict';
import test from 'node:test';

import { buildFuzzyIndex, fuzzyScore, fuzzyTier, normalizeForSearch } from './fuzzy-match.ts';

/**
 * F6:  node --test src/shared/utils/fuzzy-match.harness.ts
 *
 * The Library field's typo-tolerant matching, ported rule for rule from Worbus for Android's Find
 * (`FuzzyMatch.kt`, its plan's Task 1), so both clients find the same artist for the same typo.
 */

test('normalizeFoldsCaseAccentsAndSymbols', () => {
    assert.equal(normalizeForSearch('Björk'), 'bjork');
    assert.equal(normalizeForSearch('Beyoncé & Jay-Z'), 'beyonce and jay z');
    assert.equal(normalizeForSearch('  Pale    Kiosk  '), 'pale kiosk');
    assert.equal(normalizeForSearch('PALE KIOSK'), 'pale kiosk');
    assert.equal(normalizeForSearch("Guns N' Roses"), 'guns n roses');
    assert.equal(normalizeForSearch('米津玄師'), '米津玄師');
});

test('scoresDecreaseFromExactToTypo', () => {
    const exact = fuzzyScore('kiosk', 'Kiosk');
    const prefix = fuzzyScore('kiosk', 'Kiosk Hours');
    const word = fuzzyScore('kiosk', 'Low Kiosk');
    const typo = fuzzyScore('kiosc', 'Kiosk');
    assert.equal(exact, 1000);
    assert.equal(prefix, 900);
    assert.ok(
        exact > prefix && prefix > word && word > typo && typo > 0,
        `${[exact, prefix, word, typo]}`,
    );
    assert.ok(word >= 800 && word <= 899, String(word));
    assert.ok(typo < 800, String(typo));
});

test('tiers', () => {
    assert.equal(fuzzyTier(fuzzyScore('kiosc', 'Kiosk')), 'typo');
    assert.equal(fuzzyTier(fuzzyScore('low', 'Low Kiosk')), 'prefix');
    assert.equal(fuzzyTier(fuzzyScore('kiosk', 'Kiosk')), 'exact');
    assert.equal(fuzzyTier(fuzzyScore('kiosk', 'Low Kiosk')), 'word');
    // Every word found as typed or as a start is not a typo.
    assert.equal(fuzzyTier(fuzzyScore('kio pale', 'Pale Kiosk')), 'word');
    assert.equal(fuzzyTier(0), null);
});

test('typosThatMustMatch', () => {
    for (const [q, c] of [
        ['pale kiosc', 'Pale Kiosk'],
        ['radioheed', 'Radiohead'],
        ['beetles', 'The Beatles'],
        ['kendrik lamar', 'Kendrick Lamar'],
        ['boygenuis', 'boygenius'],
        ['bjork', 'Björk'],
        ['kiosk pale', 'Pale Kiosk'],
    ]) {
        assert.ok(fuzzyScore(q, c) > 0, `${q} -> ${c}`);
    }
});

test('shortWordsAllowNoEdits', () => {
    assert.equal(fuzzyScore('boy', 'Bob Dylan'), 0);
    assert.equal(fuzzyScore('daft pnk', 'Daft Punk'), 0);
    assert.ok(fuzzyScore('pale kio', 'Pale Kiosk') > 0);
});

test('theAllowanceGrowsWithTheWord', () => {
    // Four to six letters: one edit.
    assert.ok(fuzzyScore('kiosc', 'Kiosk') > 0);
    assert.equal(fuzzyScore('kiozc', 'Kiosk'), 0);
    // Seven or more: two.
    assert.ok(fuzzyScore('radiohaed', 'Radiohead') > 0);
    assert.ok(fuzzyScore('raddiohaed', 'Radiohead') > 0);
    assert.equal(fuzzyScore('rabbiohaed', 'Radiohead'), 0);
    // A transposition is one edit.
    assert.ok(fuzzyScore('kisok', 'Kiosk') > 0);
});

test('noMatch', () => {
    assert.equal(fuzzyScore('zzqvx', 'Pale Kiosk'), 0);
    assert.equal(fuzzyScore('pale', 'Kiosk Hours'), 0);
    assert.equal(fuzzyScore('', 'Kiosk'), 0);
    assert.equal(fuzzyScore('kiosk', ''), 0);
});

test('oneLetterMatchesOnlyAStart', () => {
    assert.ok(fuzzyScore('a', 'Abba') > 0);
    assert.equal(fuzzyScore('a', 'Pale Kiosk'), 0);
    assert.equal(fuzzyScore('k', 'Pale Kiosk'), 0);
});

test('theLastWordMayBeUnfinished', () => {
    assert.ok(fuzzyScore('pale kio', 'Pale Kiosk') > 0);
    assert.ok(fuzzyScore('pale kioz', 'Pale Kiosk') > 0);
});

test('nonLatinIsExactOrASubstring', () => {
    assert.ok(fuzzyScore('米津', '米津玄師') > 0);
    assert.equal(fuzzyScore('米津玄師', '米津玄司'), 0);
});

test('symbolsInNames', () => {
    assert.equal(fuzzyScore('ac/dc', 'AC/DC'), 1000);
    assert.equal(fuzzyScore('p!nk', 'P!nk'), 1000);
});

test('wordsRunTogetherOnOneSide', () => {
    assert.ok(fuzzyScore('boy genius', 'boygenius') > 0);
    assert.ok(fuzzyScore('boygenius', 'Boy Genius') > 0);
});

test('theIndexIsBestFirstTiesInInputOrder', () => {
    const index = buildFuzzyIndex(
        ['Pale Kiosk', 'Kiosk', 'Moth Season', 'Kiosk Hours', 'Low Kiosk', 'Kiosk'].map(
            (text, n) => ({ text, value: n }),
        ),
    );
    const hits = index.search('kiosk', 10);
    // "Pale Kiosk" and "Low Kiosk" score the same: input order.
    assert.deepEqual(
        hits.map((h) => h.value),
        [1, 5, 3, 0, 4],
    );
    assert.ok(hits.every((h, n) => n === 0 || hits[n - 1].score >= h.score));
    assert.deepEqual(
        index.search('kiosk', 2).map((h) => h.value),
        [1, 5],
    );
    assert.deepEqual(index.search('   ', 10), []);
    assert.deepEqual(index.search('kiosk', 0), []);
    assert.deepEqual(index.values, [0, 1, 2, 3, 4, 5]);
});
