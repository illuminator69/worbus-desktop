import assert from 'node:assert/strict';
import test from 'node:test';

import { navDirection, PAGE_MS, PAGE_SLIDE_PX, pageOffsetPx } from './nav-direction.ts';

/**
 * F5:  node --test src/shared/components/animations/nav-direction.harness.ts
 *
 * Which way a page arrives: a push slides in from the right, a back from the left, anything else only fades.
 */

test('pushIsForwardOnceThereIsAPreviousIndex', () => {
    assert.equal(navDirection('PUSH', 3, 4), 'forward');
    assert.equal(navDirection('PUSH', null, 0), 'none');
    assert.equal(navDirection('REPLACE', 3, 3), 'none');
});

test('popReadsTheHistoryIndex', () => {
    assert.equal(navDirection('POP', 5, 4), 'back');
    assert.equal(navDirection('POP', 4, 5), 'forward');
    assert.equal(navDirection('POP', 4, 4), 'none');
    assert.equal(navDirection('POP', null, 4), 'none');
    assert.equal(navDirection('POP', 4, null), 'none');
});

test('offsets', () => {
    assert.equal(PAGE_SLIDE_PX, 18);
    assert.equal(PAGE_MS, 220);
    assert.equal(pageOffsetPx('forward'), 18);
    assert.equal(pageOffsetPx('back'), -18);
    assert.equal(pageOffsetPx('none'), 0);
});
