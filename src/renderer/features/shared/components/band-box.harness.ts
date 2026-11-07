import assert from 'node:assert/strict';
import test from 'node:test';

import { bandBox } from './band-box.ts';

/**
 * R13 ruling M9: a page hero's band ends with the hero, however short the hero is. The overlay kept
 * upstream's 200 px floor, so the discography page's 142 px hero had its band run 58 px on, across
 * the search and chips row.
 *
 *     node --test src/renderer/features/shared/components/band-box.harness.ts
 */

test('a hero band ends with the hero, even under 200 px', () => {
    assert.deepEqual(bandBox({ height: 142, tail: 0 }), { height: '142px', minHeight: 0 });
    assert.deepEqual(bandBox({ height: 272, tail: 0 }), { height: '272px', minHeight: 0 });
});

test("the bar's band keeps its tail and the floor; an unmeasured band keeps the floor", () => {
    assert.deepEqual(bandBox({ height: 65, tail: 64 }), { height: '129px', minHeight: undefined });
    assert.deepEqual(bandBox({ height: 0, tail: 0 }), { height: undefined, minHeight: undefined });
});
