import assert from 'node:assert/strict';
import test from 'node:test';

import { migrateSidebarWidths } from './sidebar-widths.ts';

/**
 * F3:  node --test src/renderer/store/sidebar-widths.harness.ts
 *
 * The store_app step to version 6: only the old default widths move to the slim ones.
 */

test('theOldDefaultsMove', () => {
    assert.deepEqual(migrateSidebarWidths({ leftWidth: '400px', rightWidth: '600px' }), {
        leftWidth: '232px',
        rightWidth: '360px',
    });
});

test('aChosenWidthIsKept', () => {
    assert.deepEqual(migrateSidebarWidths({ leftWidth: '300px', rightWidth: '480px' }), {
        leftWidth: '300px',
        rightWidth: '480px',
    });
});

test('oneOldAndOneChosen', () => {
    assert.deepEqual(migrateSidebarWidths({ leftWidth: '400px', rightWidth: '480px' }), {
        leftWidth: '232px',
        rightWidth: '480px',
    });
    assert.deepEqual(migrateSidebarWidths({ leftWidth: '260px', rightWidth: '600px' }), {
        leftWidth: '260px',
        rightWidth: '360px',
    });
});
