import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { FOLD_EASING, GROW_MS, GROW_MS_TALL, GROW_TALL_PX, growMs, growTarget } from './grow.ts';

/**
 * F7: the request box follows its content's height in 300 ms, 450 ms when tall.
 *
 *     node --test src/renderer/features/motion/grow.harness.ts
 */

test('the duration follows the height', () => {
    assert.equal(GROW_MS, 300);
    assert.equal(GROW_MS_TALL, 450);
    assert.equal(GROW_TALL_PX, 240);
    assert.equal(growMs(120), 300);
    assert.equal(growMs(240), 300);
    assert.equal(growMs(241), 450);
});

test('when the box animates', () => {
    assert.deepEqual(growTarget(100, 100, false), { animate: false, ms: 0 });
    assert.deepEqual(growTarget(0, 180, false), { animate: false, ms: 0 });
    assert.deepEqual(growTarget(120, 180, true), { animate: false, ms: 0 });
    assert.deepEqual(growTarget(120, 180, false), { animate: true, ms: 300 });
    assert.deepEqual(growTarget(120, 300, false), { animate: true, ms: 450 });
    assert.deepEqual(growTarget(300, 120, false), { animate: true, ms: 450 });
});

test('the WAAPI copies are the fold tokens global.css sets (R13 review M7)', () => {
    // The About fold and the gaps box animate through the Web Animations API, which cannot read a
    // CSS variable, so these constants are copies: a token change must move them too.
    const css = readFileSync(new URL('../../../shared/styles/global.css', import.meta.url), 'utf8');
    assert.ok(css.includes(`--fold-ease: ${FOLD_EASING};`), FOLD_EASING);
    assert.ok(css.includes(`--fold-ms: ${GROW_MS}ms;`));
    assert.ok(css.includes(`--fold-ms-tall: ${GROW_MS_TALL}ms;`));
});
