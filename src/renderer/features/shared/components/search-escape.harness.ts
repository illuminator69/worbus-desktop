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
