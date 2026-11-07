import assert from 'node:assert/strict';
import test from 'node:test';

import { dataIndexOfRow, dataRowIndex } from './group-row-index.ts';

/**
 * node --test --test-reporter=tap src/renderer/components/item-list/item-table-list/utils/group-row-index.harness.ts
 *
 * A table with group headers has one header row above each group, so a data row sits lower
 * than its data index by the headers at or before it. These convert both ways; the column
 * header, when the table has one, is the caller's offset.
 */

const counts = [1, 1, 2, 3]; // rows: H d0 H d1 H d2 d3 H d4 d5 d6

test('dataRowIndexAddsTheHeadersAtOrBeforeIt', () => {
    assert.equal(dataRowIndex(counts, 0), 1);
    assert.equal(dataRowIndex(counts, 1), 3);
    assert.equal(dataRowIndex(counts, 3), 6);
    assert.equal(dataRowIndex(counts, 6), 10);
});

test('dataRowIndexWithNoGroupsIsTheDataIndex', () => {
    for (const i of [0, 1, 7, 500]) {
        assert.equal(dataRowIndex([], i), i);
        assert.equal(dataIndexOfRow([], i), i);
    }
});

test('aGroupOfOneStillAddsItsHeader', () => {
    assert.equal(dataRowIndex([1], 0), 1);
    assert.equal(dataRowIndex([1, 1, 1], 2), 5);
});

test('dataIndexOfRowIsNullOnAHeader', () => {
    for (const row of [0, 2, 4, 7]) assert.equal(dataIndexOfRow(counts, row), null, `row ${row}`);
});

test('dataIndexOfRowInvertsDataRowIndex', () => {
    for (let i = 0; i < 7; i++) assert.equal(dataIndexOfRow(counts, dataRowIndex(counts, i)), i);
    assert.deepEqual(
        [...Array(11).keys()].map((row) => dataIndexOfRow(counts, row)),
        [null, 0, null, 1, null, 2, 3, null, 4, 5, 6],
    );
});
