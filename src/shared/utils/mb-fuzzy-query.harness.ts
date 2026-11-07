import assert from 'node:assert/strict';
import test from 'node:test';

import { mbFuzzyQuery } from './mb-fuzzy-query.ts';

/**
 * F6:  node --test src/shared/utils/mb-fuzzy-query.harness.ts
 *
 * What the Library field sends lb-bot's MusicBrainz artist lookup, ported from Worbus for Android's
 * `MusicBrainzQuery.kt`: a word of four or more Latin letters or digits gets "~1" (one edit), a word
 * with a symbol is escaped and left exact, text that already reads as Lucene is sent as typed.
 */

test('fuzzesWordsOfFourOrMore', () => {
    assert.equal(mbFuzzyQuery('radioheed'), 'radioheed~1');
    assert.equal(mbFuzzyQuery('kendrik lamar'), 'kendrik~1 lamar~1');
    assert.equal(mbFuzzyQuery('boygenuis'), 'boygenuis~1');
    assert.equal(mbFuzzyQuery('the strokes'), 'the strokes~1');
    assert.equal(mbFuzzyQuery('mgmt'), 'mgmt~1');
    assert.equal(mbFuzzyQuery('daft pnk'), 'daft~1 pnk');
});

test('shortWordsStayPlain', () => {
    assert.equal(mbFuzzyQuery('boy genius'), 'boy genius~1');
    assert.equal(mbFuzzyQuery('abc'), 'abc');
});

test('symbolsAreEscapedNotFuzzed', () => {
    assert.equal(mbFuzzyQuery('AC/DC'), 'AC\\/DC');
    assert.equal(mbFuzzyQuery('p!nk'), 'p\\!nk');
    assert.equal(mbFuzzyQuery('sunn (o)'), 'sunn~1 \\(o\\)');
});

test('aBareOperatorIsLowerCased', () => {
    assert.equal(mbFuzzyQuery('Simon AND Garfunkel'), 'Simon~1 and Garfunkel~1');
});

test('nonLatinIsUnchanged', () => {
    assert.equal(mbFuzzyQuery('米津玄師'), '米津玄師');
    assert.equal(mbFuzzyQuery('björk'), 'björk~1');
});

test('blankIsEmpty', () => {
    assert.equal(mbFuzzyQuery(''), '');
    assert.equal(mbFuzzyQuery('   \t '), '');
});

test('luceneIsLeftAlone', () => {
    assert.equal(mbFuzzyQuery('artist:"Daft Punk"'), 'artist:"Daft Punk"');
    assert.equal(mbFuzzyQuery('radiohead~2'), 'radiohead~2');
    assert.equal(mbFuzzyQuery('"pale kiosk"'), '"pale kiosk"');
});

test('collapsesWhitespace', () => {
    assert.equal(mbFuzzyQuery('  pale   kiosk '), 'pale~1 kiosk~1');
});
