import assert from 'node:assert/strict';
import test from 'node:test';

import { migrateSongColumns } from './song-columns-migration.ts';

/**
 * F6:  node --test src/renderer/store/song-columns-migration.harness.ts
 *
 * Settings version 39: the Tracks table gains Rating and Bitrate. A stored list replaces the defaults
 * wholesale, so a new default column reaches an existing profile only through this. It enables the two
 * where they exist and appends them where they do not; it never removes, reorders or resizes anything.
 */

type Column = {
    align: string;
    autoSize: boolean;
    extra?: string;
    id: string;
    isEnabled: boolean;
    pinned: null | string;
    width: number;
};

const col = (id: string, isEnabled: boolean, patch: Partial<Column> = {}): Column => ({
    align: 'start',
    autoSize: false,
    id,
    isEnabled,
    pinned: null,
    width: 120,
    ...patch,
});

test('enablesTheTwoWhereTheyExist', () => {
    const stored = [
        col('rowIndex', true, { width: 40 }),
        col('bitRate', false, { align: 'end', width: 77 }),
        col('titleCombined', true, { autoSize: true, extra: 'kept', pinned: 'left' }),
        col('userRating', false, { width: 131 }),
        col('duration', false),
    ];
    const out = migrateSongColumns(stored)!;
    assert.deepEqual(
        out,
        stored.map((c) =>
            c.id === 'bitRate' || c.id === 'userRating' ? { ...c, isEnabled: true } : c,
        ),
    );
    // The input is not changed.
    assert.equal(stored[1].isEnabled, false);
});

test('appendsAMissingColumnAtTheEnd', () => {
    const stored = [col('titleCombined', true), col('userRating', false), col('duration', true)];
    const out = migrateSongColumns(stored)!;
    assert.deepEqual(out.slice(0, 3), [stored[0], { ...stored[1], isEnabled: true }, stored[2]]);
    assert.deepEqual(out[3], {
        align: 'center',
        autoSize: false,
        id: 'bitRate',
        isEnabled: true,
        pinned: null,
        width: 100,
    });
    assert.equal(out.length, 4);
});

test('bothAlreadyEnabledIsUnchanged', () => {
    const stored = [col('bitRate', true), col('name', true), col('userRating', true)];
    assert.deepEqual(migrateSongColumns(stored), stored);
});

test('undefinedAndEmpty', () => {
    assert.equal(migrateSongColumns(undefined), undefined);
    assert.deepEqual(migrateSongColumns([]), [
        {
            align: 'center',
            autoSize: false,
            id: 'bitRate',
            isEnabled: true,
            pinned: null,
            width: 100,
        },
        {
            align: 'center',
            autoSize: false,
            id: 'userRating',
            isEnabled: true,
            pinned: null,
            width: 100,
        },
    ]);
});
