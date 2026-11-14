import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { compactSampleRate, compactSize } from '../../../utils/compact-number.ts';

/**
 * B-274 (the owner, 2026-11-14: compact values, "44.1k" and "156 KiB"):
 *   node --test src/renderer/components/item-list/item-table-list/compact-numbers.harness.ts
 *
 * At a column's 40 px floor a 44.1 kHz Sample rate drew "44100" (43.6 px) as "441..." and a size of
 * 100 KiB or more "156.41 KiB" (46.5 px) as "156.... / KiB", on every row of the library. Both cells
 * now show three significant digits: the rate in thousands with a "k", the size with its unit.
 */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('sample_rates_read_in_thousands', () => {
    assert.equal(compactSampleRate(44100), '44.1k');
    assert.equal(compactSampleRate(48000), '48k');
    assert.equal(compactSampleRate(88200), '88.2k');
    assert.equal(compactSampleRate(96000), '96k');
    assert.equal(compactSampleRate(176400), '176k');
    assert.equal(compactSampleRate(192000), '192k');
    assert.equal(compactSampleRate(22050), '22.1k');
    assert.equal(compactSampleRate(8000), '8k');
    assert.equal(compactSampleRate(500), '500');
});

test('sizes_keep_three_significant_digits', () => {
    assert.equal(compactSize(160_164), '156 KiB');
    assert.equal(compactSize(1_604_321), '1.53 MiB');
    assert.equal(compactSize(16_043_210), '15.3 MiB');
    assert.equal(compactSize(41_943_040), '40 MiB');
    assert.equal(compactSize(1023), '1023 B');
    assert.equal(compactSize(0), '0 B');
    // 1023.9 KiB rounds to 1024: it reads as the next unit, never "1.02e+3".
    assert.equal(compactSize(1_048_500), '1 MiB');
});

test('the_table_cells_use_them', () => {
    assert.match(read('./columns/size-column.tsx'), /compactSize\(/);
    const cell = read('./item-table-list-column.tsx');
    const at = cell.indexOf('case TableColumn.SAMPLE_RATE:');
    assert.ok(at > 0);
    assert.match(
        cell.slice(at, at + 200),
        /SampleRateColumn/,
        'the rate is drawn as a bare number',
    );
});
