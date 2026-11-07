import assert from 'node:assert/strict';
import test from 'node:test';

import { migrateBuiltInFont } from './font-migration.ts';

/**
 * F3:  node --test src/renderer/store/font-migration.harness.ts
 *
 * The store_settings step to version 37: only Inter on the built-in type moves to Figtree.
 */

test('interOnTheBuiltInTypeBecomesFigtree', () => {
    assert.deepEqual(
        migrateBuiltInFont({ builtIn: 'Inter', custom: null, system: null, type: 'builtIn' }),
        { builtIn: 'Figtree', custom: null, system: null, type: 'builtIn' },
    );
});

test('poppinsIsKept', () => {
    const font = { builtIn: 'Poppins', custom: null, system: null, type: 'builtIn' };
    assert.deepEqual(migrateBuiltInFont(font), font);
});

test('aCustomFontIsKept', () => {
    const font = { builtIn: 'Inter', custom: '/fonts/mine.ttf', system: null, type: 'custom' };
    assert.deepEqual(migrateBuiltInFont(font), font);
});

test('aSystemFontIsKept', () => {
    const font = { builtIn: 'Inter', custom: null, system: 'Ubuntu', type: 'system' };
    assert.deepEqual(migrateBuiltInFont(font), font);
});
