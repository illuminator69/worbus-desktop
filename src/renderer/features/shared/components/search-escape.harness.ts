import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/**
 * B-214 (the R6 VM walk, 2026-10-28):
 *   node --test src/renderer/features/shared/components/search-escape.harness.ts
 *
 * Escape in the queue overlay's search box closed the whole overlay. The box takes its Escape (it
 * clears and leaves the field) but did not say so, and the overlay's document listener, which
 * leaves alone only an Escape whose default was prevented (`right-sidebar.tsx`
 * `useOverlayDismiss`), closed the overlay with it. The box now prevents the default of the Escape
 * it takes; the next Escape, from outside the box, closes the overlay.
 */

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

test('the_search_box_keeps_its_escape', () => {
    const src = read('./search-input.tsx');
    const at = src.indexOf('const handleEscape');
    const body = src.slice(at, src.indexOf('\n    };', at));
    assert.match(body, /e\.preventDefault\(\)/, 'the Escape it takes reaches the overlay too');
});

test('the_overlay_leaves_a_taken_escape_alone', () => {
    const src = read('../../../layouts/default-layout/right-sidebar.tsx');
    assert.match(src, /event\.key !== 'Escape' \|\| event\.defaultPrevented/);
});

/**
 * The stage 2 review's n2: the box took every Escape, so on an empty box the first Escape cleared
 * nothing and only blurred, and a second one closed the overlay. An empty box leaves its Escape to
 * the overlay (one Escape closes it); a box with text still takes the first one to clear itself.
 */
test('an_empty_search_box_leaves_its_escape_to_the_overlay', () => {
    const src = read('./search-input.tsx');
    const at = src.indexOf('const handleEscape');
    const body = src.slice(at, src.indexOf('\n    };', at));
    assert.doesNotMatch(body, /^\s*e\.preventDefault\(\);/m, 'an empty box takes the Escape too');
    assert.match(body, /if \(e\.currentTarget\.value\) e\.preventDefault\(\);/);
});
